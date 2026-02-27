using System.Net.Http.Json;
using System.Text.Json;
using Azure;
using Azure.AI.OpenAI;
using OpenAI.Chat;
using Microsoft.Azure.Cosmos;
using Microsoft.AspNetCore.Mvc;
using PluckIt.Core;
using PluckIt.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

// CORS
var allowedOrigins = builder.Configuration
  .GetSection("Cors:AllowedOrigins")
  .Get<string[]>() ?? Array.Empty<string>();

builder.Services.AddCors(options =>
{
  options.AddDefaultPolicy(policy =>
  {
    policy.WithOrigins(allowedOrigins)
      .AllowAnyHeader()
      .AllowAnyMethod();
  });
});

// Cosmos
var cosmosEndpoint = builder.Configuration["Cosmos:Endpoint"]
  ?? throw new InvalidOperationException("Required config 'Cosmos:Endpoint' (env: Cosmos__Endpoint) is not set.");
var cosmosKey = builder.Configuration["Cosmos:Key"]
  ?? throw new InvalidOperationException("Required config 'Cosmos:Key' (env: Cosmos__Key) is not set.");
var cosmosDatabase = builder.Configuration["Cosmos:Database"] ?? "PluckIt";
var cosmosContainer = builder.Configuration["Cosmos:Container"] ?? "Wardrobe";

builder.Services.AddSingleton(_ => new CosmosClient(cosmosEndpoint, cosmosKey, new CosmosClientOptions
{
  SerializerOptions = new CosmosSerializationOptions
  {
    PropertyNamingPolicy = CosmosPropertyNamingPolicy.CamelCase
  }
}));
builder.Services.AddSingleton<IWardrobeRepository>(sp =>
  new WardrobeRepository(
    sp.GetRequiredService<CosmosClient>(),
    cosmosDatabase,
    cosmosContainer));

// OpenAI / GPT-4.1-mini
var aiEndpoint = builder.Configuration["AI:Endpoint"]
  ?? throw new InvalidOperationException("Required config 'AI:Endpoint' (env: AI__Endpoint) is not set.");
var aiKey = builder.Configuration["AI:ApiKey"]
  ?? throw new InvalidOperationException("Required config 'AI:ApiKey' (env: AI__ApiKey) is not set.");
var aiDeployment = builder.Configuration["AI:Deployment"] ?? "gpt-4.1-mini";

builder.Services.AddSingleton(sp =>
  new AzureOpenAIClient(new Uri(aiEndpoint), new AzureKeyCredential(aiKey)));

builder.Services.AddSingleton<IStylistService>(sp =>
  new StylistService(
    sp.GetRequiredService<AzureOpenAIClient>(),
    aiDeployment));

// Vision / metadata service (uses same OpenAI client; optionally a different deployment)
var visionDeployment = builder.Configuration["AI:VisionDeployment"] ?? aiDeployment;
builder.Services.AddSingleton<IClothingMetadataService>(sp =>
  new ClothingMetadataService(
    sp.GetRequiredService<AzureOpenAIClient>(),
    visionDeployment));

// HttpClient for forwarding uploads to the Python Function App
var processorBaseUrl = builder.Configuration["Processor:BaseUrl"];
if (string.IsNullOrWhiteSpace(processorBaseUrl))
  processorBaseUrl = "http://localhost:7071";
builder.Services.AddHttpClient("processor", client =>
  client.BaseAddress = new Uri(processorBaseUrl));

// SAS URL generator for private archive blobs
var blobAccountName = builder.Configuration["BlobStorage:AccountName"] ?? "";
var blobAccountKey = builder.Configuration["BlobStorage:AccountKey"] ?? "";
var blobArchiveContainer = builder.Configuration["BlobStorage:ArchiveContainer"] ?? "archive";
builder.Services.AddSingleton<IBlobSasService>(
  new BlobSasService(blobAccountName, blobAccountKey, blobArchiveContainer));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

app.UseCors();

if (app.Environment.IsDevelopment())
{
  app.UseSwagger();
  app.UseSwaggerUI();
}

// Health-check / root probe so Azure "always on" pings return 200
app.MapGet("/", () => Results.Ok(new { status = "healthy", service = "PluckIt API" }));

app.MapGet("/api/wardrobe", async (
  [FromServices] IWardrobeRepository repo,
  [FromServices] IBlobSasService sasService,
  [FromQuery] string? category,
  [FromQuery] string[]? tags,
  [FromQuery] int page,
  [FromQuery] int pageSize,
  CancellationToken cancellationToken) =>
{
  var normalizedPage = page < 0 ? 0 : page;
  var normalizedSize = pageSize <= 0 ? 24 : Math.Min(pageSize, 100);

  var items = await repo.GetAllAsync(
    category,
    tags,
    normalizedPage,
    normalizedSize,
    cancellationToken);

  var result = items.Select(i => { i.ImageUrl = sasService.GenerateSasUrl(i.ImageUrl); return i; }).ToList();
  return Results.Ok(result);
});

app.MapGet("/api/wardrobe/{id}", async (
  [FromServices] IWardrobeRepository repo,
  [FromServices] IBlobSasService sasService,
  string id,
  CancellationToken cancellationToken) =>
{
  var item = await repo.GetByIdAsync(id, cancellationToken);
  if (item is null) return Results.NotFound();
  item.ImageUrl = sasService.GenerateSasUrl(item.ImageUrl);
  return Results.Ok(item);
});

app.MapPut("/api/wardrobe/{id}", async (
  [FromServices] IWardrobeRepository repo,
  string id,
  [FromBody] ClothingItem updated,
  CancellationToken cancellationToken) =>
{
  if (!string.Equals(id, updated.Id, StringComparison.OrdinalIgnoreCase))
  {
    return Results.BadRequest("ID in path and body must match.");
  }

  await repo.UpsertAsync(updated, cancellationToken);
  return Results.NoContent();
});

app.MapPost("/api/stylist/recommendations", async (
  [FromServices] IWardrobeRepository repo,
  [FromServices] IStylistService stylist,
  [FromBody] StylistRequest request,
  CancellationToken cancellationToken) =>
{
  var wardrobe = await repo.GetAllAsync(
    category: null,
    tags: null,
    page: 0,
    pageSize: 200,
    cancellationToken);

  if (!wardrobe.Any())
    return Results.BadRequest(new { error = "Your wardrobe is empty. Add some clothing items first." });

  var recommendations = await stylist.GetRecommendationsAsync(
    wardrobe,
    request,
    cancellationToken);

  return Results.Ok(recommendations);
});

// Upload an image → background removal (Function App) → AI metadata extraction → return draft (not yet saved)
app.MapPost("/api/wardrobe/upload", async (
  IFormFile image,
  [FromServices] IHttpClientFactory httpClientFactory,
  [FromServices] IClothingMetadataService metadataService,
  [FromServices] IBlobSasService sasService,
  CancellationToken cancellationToken) =>
{
  if (image is null || image.Length == 0)
    return Results.BadRequest(new { error = "No image provided." });

  // Read image bytes once — reused for both the processor call and AI metadata
  var mediaType = image.ContentType ?? "image/png";
  byte[] imageBytes;
  using (var ms = new System.IO.MemoryStream())
  {
    await image.CopyToAsync(ms, cancellationToken);
    imageBytes = ms.ToArray();
  }

  // Forward to the Function App for background removal + blob upload
  using var form = new MultipartFormDataContent();
  var streamContent = new StreamContent(new System.IO.MemoryStream(imageBytes));
  streamContent.Headers.ContentType =
    new System.Net.Http.Headers.MediaTypeHeaderValue(mediaType);
  form.Add(streamContent, "image", image.FileName ?? "upload.png");

  var processorClient = httpClientFactory.CreateClient("processor");
  var processorResponse = await processorClient.PostAsync("/api/process-image", form, cancellationToken);

  if (!processorResponse.IsSuccessStatusCode)
  {
    var err = await processorResponse.Content.ReadAsStringAsync(cancellationToken);
    return Results.Problem($"Image processor returned {(int)processorResponse.StatusCode}: {err}");
  }

  var processed = await processorResponse.Content
    .ReadFromJsonAsync<ProcessorResult>(cancellationToken: cancellationToken);

  if (processed is null || string.IsNullOrEmpty(processed.ImageUrl))
    return Results.Problem("Image processor returned an unexpected response.");

  // Extract AI metadata using the original image bytes (blob URL is private)
  var imageData = BinaryData.FromBytes(imageBytes);
  var metadata = await metadataService.ExtractMetadataAsync(imageData, mediaType, cancellationToken);

  // Return draft — NOT saved to Cosmos yet; client must confirm via POST /api/wardrobe
  var draft = new ClothingItem
  {
    Id = processed.Id,
    ImageUrl = sasService.GenerateSasUrl(processed.ImageUrl),
    Brand = metadata.Brand,
    Category = metadata.Category,
    Tags = metadata.Tags,
    Colours = metadata.Colours,
  };

  return Results.Ok(draft);
}).DisableAntiforgery();

// Save a confirmed (user-reviewed) clothing item to Cosmos
app.MapPost("/api/wardrobe", async (
  [FromServices] IWardrobeRepository repo,
  [FromBody] ClothingItem item,
  CancellationToken cancellationToken) =>
{
  if (string.IsNullOrWhiteSpace(item.Id))
    item.Id = Guid.NewGuid().ToString("N");

  if (item.DateAdded == null)
    item.DateAdded = DateTimeOffset.UtcNow;

  await repo.UpsertAsync(item, cancellationToken);
  return Results.Created($"/api/wardrobe/{item.Id}", item);
});

app.Run();

record ProcessorResult(string Id, string ImageUrl);
