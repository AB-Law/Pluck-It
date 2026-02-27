using System.Text.Json;
using Azure;
using Azure.AI.OpenAI;
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
var cosmosEndpoint = builder.Configuration["Cosmos:Endpoint"];
var cosmosKey = builder.Configuration["Cosmos:Key"];
var cosmosDatabase = builder.Configuration["Cosmos:Database"] ?? "PluckIt";
var cosmosContainer = builder.Configuration["Cosmos:Container"] ?? "Wardrobe";

if (!string.IsNullOrWhiteSpace(cosmosEndpoint) && !string.IsNullOrWhiteSpace(cosmosKey))
{
  builder.Services.AddSingleton(_ => new CosmosClient(cosmosEndpoint, cosmosKey));
  builder.Services.AddSingleton<IWardrobeRepository>(sp =>
    new WardrobeRepository(
      sp.GetRequiredService<CosmosClient>(),
      cosmosDatabase,
      cosmosContainer));
}

// OpenAI / GPT-4.1-mini
var aiEndpoint = builder.Configuration["AI:Endpoint"];
var aiKey = builder.Configuration["AI:ApiKey"];
var aiDeployment = builder.Configuration["AI:Deployment"] ?? "gpt-4.1-mini";

if (!string.IsNullOrWhiteSpace(aiEndpoint) && !string.IsNullOrWhiteSpace(aiKey))
{
  builder.Services.AddSingleton(sp =>
  {
    var endpoint = new Uri(aiEndpoint);
    return new OpenAIClient(endpoint, new AzureKeyCredential(aiKey));
  });

  builder.Services.AddSingleton<IStylistService>(sp =>
    new StylistService(
      sp.GetRequiredService<OpenAIClient>(),
      aiDeployment));
}

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

app.UseCors();

if (app.Environment.IsDevelopment())
{
  app.UseSwagger();
  app.UseSwaggerUI();
}

app.MapGet("/api/wardrobe", async (
  [FromServices] IWardrobeRepository repo,
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

  return Results.Ok(items);
});

app.MapGet("/api/wardrobe/{id}", async (
  [FromServices] IWardrobeRepository repo,
  string id,
  CancellationToken cancellationToken) =>
{
  var item = await repo.GetByIdAsync(id, cancellationToken);
  return item is null ? Results.NotFound() : Results.Ok(item);
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

  var recommendations = await stylist.GetRecommendationsAsync(
    wardrobe,
    request,
    cancellationToken);

  return Results.Ok(recommendations);
});

app.Run();

