using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using PluckIt.Core;
using PluckIt.Functions.Auth;
using PluckIt.Functions.Serialization;

namespace PluckIt.Functions.Functions;

public class WardrobeFunctions(
    IWardrobeRepository repo,
    IBlobSasService sasService,
    IClothingMetadataService metadataService,
    IHttpClientFactory httpClientFactory,
    IConfiguration config,
    GoogleTokenValidator tokenValidator,
    ILogger<WardrobeFunctions> logger)
{
    // ── GET /api/wardrobe ───────────────────────────────────────────────────

    [Function(nameof(GetWardrobe))]
    public async Task<HttpResponseData> GetWardrobe(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "wardrobe")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        var (authed0, userId) = await TryGetUserIdAsync(req);
        if (!authed0)
            return req.CreateResponse(System.Net.HttpStatusCode.Unauthorized);

        var qs       = ParseQueryString(req.Url);
        var pageSize = int.TryParse(qs.GetValueOrDefault("pageSize"), out var s) ? Math.Clamp(s, 1, 100) : 24;

        // ── Parse condition (string enum) ───────────────────────────────────
        ItemCondition? condition = null;
        if (qs.TryGetValue("condition", out var condStr) &&
            Enum.TryParse<ItemCondition>(condStr, ignoreCase: true, out var condParsed))
            condition = condParsed;

        // ── Parse numeric filters ───────────────────────────────────────────
        decimal? priceMin = decimal.TryParse(qs.GetValueOrDefault("priceMin"), out var pmin) ? pmin : null;
        decimal? priceMax = decimal.TryParse(qs.GetValueOrDefault("priceMax"), out var pmax) ? pmax : null;
        int?     minWears = int.TryParse(qs.GetValueOrDefault("minWears"), out var mw) ? mw : null;
        int?     maxWears = int.TryParse(qs.GetValueOrDefault("maxWears"), out var xw) ? xw : null;

        // ── Parse sort ──────────────────────────────────────────────────────
        var sortField = qs.GetValueOrDefault("sortField") is string sf &&
                        WardrobeSortField.Allowlist.Contains(sf, StringComparer.OrdinalIgnoreCase)
                        ? sf : WardrobeSortField.DateAdded;
        var sortDir   = qs.GetValueOrDefault("sortDir") is string sd &&
                        string.Equals(sd, "asc", StringComparison.OrdinalIgnoreCase)
                        ? "asc" : "desc";

        var wardrobeQuery = new WardrobeQuery
        {
            Category          = qs.GetValueOrDefault("category"),
            Brand             = qs.GetValueOrDefault("brand"),
            Condition         = condition,
            Tags              = qs.TryGetValue("tags", out var t)
                                  ? t.Split(',', StringSplitOptions.RemoveEmptyEntries) : null,
            AestheticTags     = qs.TryGetValue("aestheticTags", out var at)
                                  ? at.Split(',', StringSplitOptions.RemoveEmptyEntries) : null,
            PriceMin          = priceMin,
            PriceMax          = priceMax,
            MinWears          = minWears,
            MaxWears          = maxWears,
            SortField         = sortField,
            SortDir           = sortDir,
            PageSize          = pageSize,
            ContinuationToken = qs.GetValueOrDefault("continuationToken"),
        };

        var paged  = await repo.GetAllAsync(userId!, wardrobeQuery, cancellationToken);
        // Enrich each item's image URL with a short-lived SAS token
        foreach (var item in paged.Items)
            item.ImageUrl = sasService.GenerateSasUrl(item.ImageUrl);

        return await JsonOk(req, paged, PluckItJsonContext.Default.WardrobePagedResult);
    }

    // ── GET /api/wardrobe/{id} ──────────────────────────────────────────────

    [Function(nameof(GetWardrobeItem))]
    public async Task<HttpResponseData> GetWardrobeItem(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "wardrobe/{id}")] HttpRequestData req,
        string id,
        CancellationToken cancellationToken)
    {
        var (authed1, userId) = await TryGetUserIdAsync(req);
        if (!authed1)
            return req.CreateResponse(System.Net.HttpStatusCode.Unauthorized);

        var item = await repo.GetByIdAsync(id, userId!, cancellationToken);
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
        var (authed2, userId) = await TryGetUserIdAsync(req);
        if (!authed2)
            return req.CreateResponse(System.Net.HttpStatusCode.Unauthorized);

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

        updated.UserId = userId!;
        await repo.UpsertAsync(updated, cancellationToken);
        return req.CreateResponse(HttpStatusCode.NoContent);
    }

    // ── DELETE /api/wardrobe/{id} ───────────────────────────────────────────

    [Function(nameof(DeleteWardrobeItem))]
    public async Task<HttpResponseData> DeleteWardrobeItem(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "wardrobe/{id}")] HttpRequestData req,
        string id,
        CancellationToken cancellationToken)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed)
            return req.CreateResponse(System.Net.HttpStatusCode.Unauthorized);

        // Fetch first so we can delete the associated blob
        var existing = await repo.GetByIdAsync(id, userId!, cancellationToken);
        if (existing is null)
            return req.CreateResponse(HttpStatusCode.NotFound);

        await repo.DeleteAsync(id, userId!, cancellationToken);

        // Best-effort blob delete — orphan cleanup Function will catch any misses
        if (!string.IsNullOrEmpty(existing.ImageUrl))
            await sasService.DeleteBlobAsync(existing.ImageUrl, cancellationToken);

        return req.CreateResponse(HttpStatusCode.NoContent);
    }

    // ── PATCH /api/wardrobe/{id}/wear ────────────────────────────────────────
    // Atomically increments WearCount by 1. Returns the updated item.

    [Function(nameof(LogWear))]
    public async Task<HttpResponseData> LogWear(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "wardrobe/{id}/wear")] HttpRequestData req,
        string id,
        CancellationToken cancellationToken)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed)
            return req.CreateResponse(HttpStatusCode.Unauthorized);

        var item = await repo.GetByIdAsync(id, userId!, cancellationToken);
        if (item is null) return req.CreateResponse(HttpStatusCode.NotFound);

        item.WearCount += 1;
        await repo.UpsertAsync(item, cancellationToken);

        return await JsonOk(req, item, PluckItJsonContext.Default.ClothingItem);
    }

    // ── POST /api/wardrobe/upload ────────────────────────────────────────────

    [Function(nameof(UploadItem))]
    public async Task<HttpResponseData> UploadItem(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "wardrobe/upload")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        var (authed3, userId) = await TryGetUserIdAsync(req);
        if (!authed3)
            return req.CreateResponse(System.Net.HttpStatusCode.Unauthorized);

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

        // Always use the processed PNG for AI metadata extraction.
        // The original upload may be HEIC or another format unsupported by OpenAI Vision,
        // but the processor guarantees output is a valid PNG.
        // We generate a short-lived SAS URL and download the PNG bytes via HttpClient.
        BinaryData imageData;
        string metaMediaType;
        try
        {
            var pngSasUrl = sasService.GenerateSasUrl(processed.ImageUrl, validForMinutes: 5);
            using var sasClient = httpClientFactory.CreateClient();
            var pngBytes = await sasClient.GetByteArrayAsync(pngSasUrl, cancellationToken);
            imageData = BinaryData.FromBytes(pngBytes);
            metaMediaType = "image/png";
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not download processed PNG for metadata extraction; falling back to original bytes.");
            imageData = BinaryData.FromBytes(imageBytes);
            metaMediaType = mediaType;
        }

        var metadata = await metadataService.ExtractMetadataAsync(imageData, metaMediaType, cancellationToken);

        var draft = new ClothingItem
        {
            Id = processed.Id,
            UserId = userId!,
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
        var (authed4, userId) = await TryGetUserIdAsync(req);
        if (!authed4)
            return req.CreateResponse(System.Net.HttpStatusCode.Unauthorized);

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
        item.UserId = userId!;
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

    /// <summary>
    /// Resolves the authenticated user ID.
    /// In production, validates the Google ID token from the Authorization: Bearer header.
    /// In local development, falls back to Local:DevUserId in configuration.
    /// </summary>
    private async Task<(bool Authed, string? UserId)> TryGetUserIdAsync(HttpRequestData req)
    {
        if (req.Headers.TryGetValues("Authorization", out var authHeaders))
        {
            var header = authHeaders.FirstOrDefault();
            if (header?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true)
            {
                var token = header["Bearer ".Length..];
                var sub = await tokenValidator.ValidateAsync(token);
                if (sub is not null) return (true, sub);
            }
        }

        var devId = config["Local:DevUserId"];
        if (!string.IsNullOrEmpty(devId)) return (true, devId);

        return (false, null);
    }

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
