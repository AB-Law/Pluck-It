using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using PluckIt.Core;
using PluckIt.Functions.Serialization;

namespace PluckIt.Functions.Functions;

public class WardrobeFunctions(
    IWardrobeRepository repo,
    IBlobSasService sasService,
    IClothingMetadataService metadataService,
    IHttpClientFactory httpClientFactory,
    ILogger<WardrobeFunctions> logger)
{
    // ── GET /api/wardrobe ───────────────────────────────────────────────────

    [Function(nameof(GetWardrobe))]
    public async Task<HttpResponseData> GetWardrobe(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "wardrobe")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        var query = ParseQueryString(req.Url);
        var category = query.GetValueOrDefault("category");
        var tags = query.TryGetValue("tags", out var t) ? t.Split(',', StringSplitOptions.RemoveEmptyEntries) : null;
        var page = int.TryParse(query.GetValueOrDefault("page"), out var p) ? Math.Max(p, 0) : 0;
        var pageSize = int.TryParse(query.GetValueOrDefault("pageSize"), out var s) ? Math.Clamp(s, 1, 100) : 24;

        var items = await repo.GetAllAsync(category, tags, page, pageSize, cancellationToken);
        var result = items.Select(i => { i.ImageUrl = sasService.GenerateSasUrl(i.ImageUrl); return i; }).ToList();

        return await JsonOk(req, result, PluckItJsonContext.Default.ListClothingItem);
    }

    // ── GET /api/wardrobe/{id} ──────────────────────────────────────────────

    [Function(nameof(GetWardrobeItem))]
    public async Task<HttpResponseData> GetWardrobeItem(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "wardrobe/{id}")] HttpRequestData req,
        string id,
        CancellationToken cancellationToken)
    {
        var item = await repo.GetByIdAsync(id, cancellationToken);
        if (item is null) return req.CreateResponse(HttpStatusCode.NotFound);

        item.ImageUrl = sasService.GenerateSasUrl(item.ImageUrl);
        return await JsonOk(req, item, PluckItJsonContext.Default.ClothingItem);
    }

    // ── PUT /api/wardrobe/{id} ──────────────────────────────────────────────

    [Function(nameof(UpdateWardrobeItem))]
    public async Task<HttpResponseData> UpdateWardrobeItem(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "wardrobe/{id}")] HttpRequestData req,
        string id,
        CancellationToken cancellationToken)
    {
        ClothingItem? updated;
        try
        {
            updated = await JsonSerializer.DeserializeAsync(
                req.Body, PluckItJsonContext.Default.ClothingItem, cancellationToken);
        }
        catch
        {
            return await JsonError(req, HttpStatusCode.BadRequest, "Invalid request body.");
        }

        if (updated is null || !string.Equals(id, updated.Id, StringComparison.OrdinalIgnoreCase))
            return await JsonError(req, HttpStatusCode.BadRequest, "ID in path and body must match.");

        await repo.UpsertAsync(updated, cancellationToken);
        return req.CreateResponse(HttpStatusCode.NoContent);
    }

    // ── POST /api/wardrobe/upload ────────────────────────────────────────────

    [Function(nameof(UploadItem))]
    public async Task<HttpResponseData> UploadItem(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "wardrobe/upload")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        // Extract image bytes from multipart/form-data or raw body
        var contentType = req.Headers.TryGetValues("Content-Type", out var cts)
            ? cts.FirstOrDefault() ?? "application/octet-stream"
            : "application/octet-stream";

        byte[] imageBytes;
        string mediaType;

        if (contentType.Contains("multipart/form-data", StringComparison.OrdinalIgnoreCase))
        {
            (imageBytes, mediaType) = await MultipartReader.ReadFirstFileAsync(req.Body, contentType);
            if (imageBytes.Length == 0)
                return await JsonError(req, HttpStatusCode.BadRequest, "No image provided.");
        }
        else
        {
            // Accept raw octet-stream
            using var ms = new MemoryStream();
            await req.Body.CopyToAsync(ms, cancellationToken);
            imageBytes = ms.ToArray();
            mediaType = contentType.Split(';')[0].Trim();
            if (imageBytes.Length == 0)
                return await JsonError(req, HttpStatusCode.BadRequest, "No image provided.");
        }

        // Forward to Python processor for background removal + blob upload
        using var form = new MultipartFormDataContent();
        var streamContent = new StreamContent(new MemoryStream(imageBytes));
        streamContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(mediaType);
        form.Add(streamContent, "image", "upload.png");

        var processorClient = httpClientFactory.CreateClient("processor");
        HttpResponseMessage processorResponse;
        try
        {
            processorResponse = await processorClient.PostAsync("/api/process-image", form, cancellationToken);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to reach image processor.");
            return await JsonError(req, HttpStatusCode.ServiceUnavailable, "Image processor is unavailable.");
        }

        if (!processorResponse.IsSuccessStatusCode)
        {
            var err = await processorResponse.Content.ReadAsStringAsync(cancellationToken);
            logger.LogError("Processor returned {Status}: {Body}", (int)processorResponse.StatusCode, err);
            return await JsonError(req, HttpStatusCode.BadGateway,
                $"Image processor returned {(int)processorResponse.StatusCode}.");
        }

        var processed = await processorResponse.Content
            .ReadFromJsonAsync(PluckItJsonContext.Default.ProcessorResult, cancellationToken);

        if (processed is null || string.IsNullOrEmpty(processed.ImageUrl))
            return await JsonError(req, HttpStatusCode.BadGateway, "Image processor returned an unexpected response.");

        // Extract AI metadata from original image bytes
        var imageData = BinaryData.FromBytes(imageBytes);
        var metadata = await metadataService.ExtractMetadataAsync(imageData, mediaType, cancellationToken);

        var draft = new ClothingItem
        {
            Id = processed.Id,
            ImageUrl = sasService.GenerateSasUrl(processed.ImageUrl),
            Brand = metadata.Brand,
            Category = metadata.Category,
            Tags = metadata.Tags,
            Colours = metadata.Colours,
        };

        return await JsonOk(req, draft, PluckItJsonContext.Default.ClothingItem);
    }

    // ── POST /api/wardrobe ──────────────────────────────────────────────────

    [Function(nameof(SaveItem))]
    public async Task<HttpResponseData> SaveItem(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "wardrobe")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        ClothingItem? item;
        try
        {
            item = await JsonSerializer.DeserializeAsync(
                req.Body, PluckItJsonContext.Default.ClothingItem, cancellationToken);
        }
        catch
        {
            return await JsonError(req, HttpStatusCode.BadRequest, "Invalid request body.");
        }

        if (item is null)
            return await JsonError(req, HttpStatusCode.BadRequest, "Request body is required.");

        if (string.IsNullOrWhiteSpace(item.Id))
            item.Id = Guid.NewGuid().ToString("N");
        if (item.DateAdded is null)
            item.DateAdded = DateTimeOffset.UtcNow;

        await repo.UpsertAsync(item, cancellationToken);

        var response = req.CreateResponse(HttpStatusCode.Created);
        response.Headers.Add("Location", $"/api/wardrobe/{item.Id}");
        response.Headers.Add("Content-Type", "application/json; charset=utf-8");
        await response.WriteStringAsync(
            JsonSerializer.Serialize(item, PluckItJsonContext.Default.ClothingItem));
        return response;
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private static async Task<HttpResponseData> JsonOk<T>(
        HttpRequestData req, T body, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo)
    {
        var response = req.CreateResponse(HttpStatusCode.OK);
        response.Headers.Add("Content-Type", "application/json; charset=utf-8");
        await response.WriteStringAsync(JsonSerializer.Serialize(body, typeInfo));
        return response;
    }

    private static async Task<HttpResponseData> JsonError(
        HttpRequestData req, HttpStatusCode status, string message)
    {
        var response = req.CreateResponse(status);
        response.Headers.Add("Content-Type", "application/json; charset=utf-8");
        await response.WriteStringAsync(
            JsonSerializer.Serialize(new ErrorResponse(message), PluckItJsonContext.Default.ErrorResponse));
        return response;
    }

    /// <summary>Parses a URL query string into a dictionary without System.Web dependency.</summary>
    private static Dictionary<string, string> ParseQueryString(Uri uri)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var query = uri.Query.TrimStart('?');
        if (string.IsNullOrEmpty(query)) return result;

        foreach (var pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var idx = pair.IndexOf('=');
            var key = idx >= 0 ? Uri.UnescapeDataString(pair[..idx]) : pair;
            var value = idx >= 0 ? Uri.UnescapeDataString(pair[(idx + 1)..]) : string.Empty;
            result.TryAdd(key, value);
        }
        return result;
    }
}

/// <summary>
/// AOT-safe multipart/form-data reader. Extracts the first file field's bytes
/// without using System.Web or ASP.NET Core reflection-based parsers.
/// </summary>
internal static class MultipartReader
{
    internal static async Task<(byte[] Bytes, string MediaType)> ReadFirstFileAsync(Stream body, string contentType)
    {
        var boundary = ExtractBoundary(contentType);
        if (boundary is null) return ([], "application/octet-stream");

        using var ms = new MemoryStream();
        await body.CopyToAsync(ms);
        var data = ms.ToArray();

        var delimiter = Encoding.UTF8.GetBytes("--" + boundary);
        var crlfcrlf = "\r\n\r\n"u8.ToArray();

        // Find first boundary line
        var start = IndexOf(data, delimiter, 0);
        if (start < 0) return ([], "application/octet-stream");

        // Skip past boundary + CRLF to reach part headers
        var headerStart = start + delimiter.Length + 2;

        // Find the blank line separating headers from content
        var contentStart = IndexOf(data, crlfcrlf, headerStart);
        if (contentStart < 0) return ([], "application/octet-stream");
        contentStart += 4; // skip \r\n\r\n

        // Parse Content-Type from part headers
        var headersText = Encoding.UTF8.GetString(data, headerStart, contentStart - headerStart - 4);
        var mediaType = "application/octet-stream";
        foreach (var line in headersText.Split('\n'))
        {
            var trimmed = line.Trim();
            if (trimmed.StartsWith("Content-Type:", StringComparison.OrdinalIgnoreCase))
            {
                mediaType = trimmed[13..].Trim();
                break;
            }
        }

        // Find the closing boundary (content ends \r\n before the next delimiter)
        var closingDelimiter = Encoding.UTF8.GetBytes("\r\n--" + boundary);
        var contentEnd = IndexOf(data, closingDelimiter, contentStart);
        if (contentEnd < 0) contentEnd = data.Length;

        return (data[contentStart..contentEnd], mediaType);
    }

    private static string? ExtractBoundary(string contentType)
    {
        // "multipart/form-data; boundary=----WebKitFormBoundaryXXX"
        var idx = contentType.IndexOf("boundary=", StringComparison.OrdinalIgnoreCase);
        if (idx < 0) return null;
        var boundary = contentType[(idx + 9)..].Trim().Trim('"');
        // Remove optional trailing params (e.g. "; charset=...")
        var semi = boundary.IndexOf(';');
        return semi >= 0 ? boundary[..semi].Trim() : boundary;
    }

    private static int IndexOf(byte[] haystack, byte[] needle, int start)
    {
        var limit = haystack.Length - needle.Length;
        for (var i = start; i <= limit; i++)
        {
            var match = true;
            for (var j = 0; j < needle.Length; j++)
            {
                if (haystack[i + j] != needle[j]) { match = false; break; }
            }
            if (match) return i;
        }
        return -1;
    }
}
