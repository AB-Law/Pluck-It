using System.Net;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;
using PluckIt.Core;
using PluckIt.Functions.Auth;
using PluckIt.Functions.Models;
using PluckIt.Functions.Queue;
using PluckIt.Functions.Serialization;

namespace PluckIt.Functions.Functions;

public sealed class WardrobeFunctionsAuthContext(string? localDevUserId, GoogleTokenValidator tokenValidator)
{
    public string? LocalDevUserId { get; } = localDevUserId;
    public GoogleTokenValidator TokenValidator { get; } = tokenValidator;
}

public sealed class WardrobeFunctionsMutationDependencies(
    IWearHistoryRepository wearHistoryRepository,
    IStylingActivityRepository stylingActivityRepository,
    IUserProfileRepository userProfileRepository)
{
    public IWearHistoryRepository WearHistoryRepository { get; } = wearHistoryRepository;
    public IStylingActivityRepository StylingActivityRepository { get; } = stylingActivityRepository;
    public IUserProfileRepository UserProfileRepository { get; } = userProfileRepository;
}

public class WardrobeFunctions(
    IWardrobeRepository repo,
    IBlobSasService sasService,
    IImageJobQueue jobQueue,
    WardrobeFunctionsMutationDependencies mutationDependencies,
    WardrobeFunctionsAuthContext authContext,
    ILogger<WardrobeFunctions> logger)
{
    private readonly IWearHistoryRepository wearHistoryRepo = mutationDependencies.WearHistoryRepository;
    private readonly IStylingActivityRepository stylingActivityRepo = mutationDependencies.StylingActivityRepository;
    private readonly IUserProfileRepository userProfileRepo = mutationDependencies.UserProfileRepository;

    private const string ContentTypeHeader = "Content-Type";
    private const string JsonContentType = "application/json; charset=utf-8";
    private const string OctetStream = "application/octet-stream";
    private const string InvalidRequestBodyMessage = "Invalid request body.";
    private const string NoImageProvidedMessage = "No image provided.";
    private const string RetryDraftConflictMessage = "Only Failed drafts can be retried.";
    private const string ContentTypeErrorMessage = "Could not store image. Please try again.";
    // ── GET /api/wardrobe ───────────────────────────────────────────────────

    [Function(nameof(GetWardrobe))]
    public async Task<HttpResponseData> GetWardrobe(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "wardrobe")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        var (authed0, userId) = await TryGetUserIdAsync(req);
        if (!authed0)
            return req.CreateResponse(System.Net.HttpStatusCode.Unauthorized);

        if (!TryBuildWardrobeQuery(req.Url, out var wardrobeQuery, out var wardrobeQueryValidationMessage))
            return await JsonError(req, HttpStatusCode.BadRequest, wardrobeQueryValidationMessage);

        var paged = await repo.GetAllAsync(userId!, wardrobeQuery, cancellationToken);
        // Enrich each item's image URL with a short-lived SAS token
        foreach (var item in paged.Items)
            item.ImageUrl = sasService.GenerateSasUrl(item.ImageUrl);

        return await JsonOk(req, paged, PluckItJsonContext.Default.WardrobePagedResult);
    }

    private static bool TryBuildWardrobeQuery(
        Uri uri,
        out WardrobeQuery query,
        out string message)
    {
        message = string.Empty;
        var qs = ParseQueryString(uri);

        var pageSize = ParseOptionalInt(qs.GetValueOrDefault("pageSize"), 24, 1, 100);
        var priceMin = ParseOptionalDecimal(qs.GetValueOrDefault("priceMin"));
        var priceMax = ParseOptionalDecimal(qs.GetValueOrDefault("priceMax"));
        var minWears = ParseOptionalIntOrNull(qs.GetValueOrDefault("minWears"));
        var maxWears = ParseOptionalIntOrNull(qs.GetValueOrDefault("maxWears"));

        if (priceMin.HasValue && priceMax.HasValue && priceMin.Value > priceMax.Value)
        {
            message = "priceMin must not exceed priceMax.";
            query = default!;
            return false;
        }

        if (minWears.HasValue && maxWears.HasValue && minWears.Value > maxWears.Value)
        {
            message = "minWears must not exceed maxWears.";
            query = default!;
            return false;
        }

        query = new WardrobeQuery
        {
            Category          = qs.GetValueOrDefault("category"),
            Brand             = qs.GetValueOrDefault("brand"),
            Condition         = ParseCondition(qs.GetValueOrDefault("condition")),
            Tags              = ParseCsv(qs, "tags"),
            AestheticTags     = ParseCsv(qs, "aestheticTags"),
            PriceMin          = priceMin,
            PriceMax          = priceMax,
            MinWears          = minWears,
            MaxWears          = maxWears,
            SortField         = ParseSortField(qs.GetValueOrDefault("sortField")),
            SortDir           = ParseSortDirection(qs.GetValueOrDefault("sortDir")),
            PageSize          = pageSize,
            ContinuationToken = qs.GetValueOrDefault("continuationToken"),
        };

        return true;
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
                return await JsonError(req, HttpStatusCode.BadRequest, InvalidRequestBodyMessage);
        }

        if (updated is null || !string.Equals(id, updated.Id, StringComparison.OrdinalIgnoreCase))
            return await JsonError(req, HttpStatusCode.BadRequest, "ID in path and body must match.");

        updated.UserId = userId!;
        await repo.UpsertAsync(updated, cancellationToken);
        await RefreshWardrobeFingerprintAsync(userId!, cancellationToken);
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
        await RefreshWardrobeFingerprintAsync(userId!, cancellationToken);

        // Best-effort blob delete — orphan cleanup Function will catch any misses
        if (!string.IsNullOrEmpty(existing.ImageUrl))
            await sasService.DeleteBlobAsync(existing.ImageUrl, cancellationToken);
        // Also delete raw upload blob if this was a draft
        if (!string.IsNullOrEmpty(existing.RawImageBlobUrl))
            await sasService.DeleteBlobAsync(existing.RawImageBlobUrl, cancellationToken);

        return req.CreateResponse(HttpStatusCode.NoContent);
    }

    // ── PATCH /api/wardrobe/{id}/wear ────────────────────────────────────────
    // Records a wear event: increments WearCount, stamps LastWornAt, appends to
    // WearEvents (bounded at 30). Accepts an optional JSON body with Occasion
    // and WeatherSnapshot context.

    [Function(nameof(LogWear))]
    public async Task<HttpResponseData> LogWear(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "wardrobe/{id}/wear")] HttpRequestData req,
        string id,
        CancellationToken cancellationToken)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed)
            return req.CreateResponse(HttpStatusCode.Unauthorized);

        // Parse optional body — missing or empty body is always valid
        WearLogRequest? wearReq = null;
        using var ms = new MemoryStream();
        await req.Body.CopyToAsync(ms, cancellationToken);
        if (ms.Length > 0)
        {
            ms.Seek(0, SeekOrigin.Begin);
            try
            {
                wearReq = await JsonSerializer.DeserializeAsync(
                    ms, PluckItJsonContext.Default.WearLogRequest, cancellationToken);
            }
            catch
            {
            return await JsonError(req, HttpStatusCode.BadRequest, InvalidRequestBodyMessage);
            }
        }

        var existing = await repo.GetByIdAsync(id, userId!, cancellationToken);
        if (existing is null)
            return req.CreateResponse(HttpStatusCode.NotFound);

        if (!string.IsNullOrWhiteSpace(wearReq?.ClientEventId) &&
            string.Equals(existing.LastWearActionId, wearReq.ClientEventId, StringComparison.Ordinal))
        {
            existing.ImageUrl = sasService.GenerateSasUrl(existing.ImageUrl);
            return await JsonOk(req, existing, PluckItJsonContext.Default.ClothingItem);
        }

        var occurredAt = wearReq?.OccurredAt ?? DateTimeOffset.UtcNow;
        var source = string.IsNullOrWhiteSpace(wearReq?.Source)
            ? WearLogSources.Unknown
            : wearReq!.Source!.Trim();

        var ev = new WearEvent(
            OccurredAt: occurredAt,
            Occasion: wearReq?.Occasion,
            WeatherSnapshot: wearReq?.WeatherSnapshot);

        var updated = await repo.AppendWearEventAsync(
            id,
            userId!,
            ev,
            wearReq?.ClientEventId,
            maxEvents: 30,
            cancellationToken);
        if (updated is null)
            return req.CreateResponse(HttpStatusCode.NotFound);

        try
        {
            var wearHistoryId = $"wear-{id}-{Guid.NewGuid():N}";
            await wearHistoryRepo.AddAsync(new WearHistoryRecord
            {
                Id = wearHistoryId,
                UserId = userId!,
                ItemId = id,
                OccurredAt = occurredAt,
                Source = source,
                Occasion = wearReq?.Occasion,
                WeatherSnapshot = wearReq?.WeatherSnapshot,
                StylingActivityId = wearReq?.StylingActivityId,
                CreatedAt = DateTimeOffset.UtcNow,
            }, cancellationToken);

            if (!string.IsNullOrWhiteSpace(wearReq?.StylingActivityId))
            {
                await stylingActivityRepo.UpdateSuggestionStatusAsync(
                    wearReq.StylingActivityId,
                    userId!,
                    WearSuggestionStatus.Accepted,
                    linkedWearEventId: wearHistoryId,
                    cancellationToken: cancellationToken);
            }
        }
        catch
        {
            // Swallow secondary write failures to avoid duplicate wear increments on client retry.
        }

        await RefreshWardrobeFingerprintAsync(userId!, cancellationToken);

        updated.ImageUrl = sasService.GenerateSasUrl(updated.ImageUrl);
        return await JsonOk(req, updated, PluckItJsonContext.Default.ClothingItem);
    }

    // ── GET /api/wardrobe/{id}/wear-history ─────────────────────────────────

    [Function(nameof(GetWearHistory))]
    public async Task<HttpResponseData> GetWearHistory(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "wardrobe/{id}/wear-history")] HttpRequestData req,
        string id,
        CancellationToken cancellationToken)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed)
            return req.CreateResponse(HttpStatusCode.Unauthorized);

        var item = await repo.GetByIdAsync(id, userId!, cancellationToken);
        if (item is null)
            return req.CreateResponse(HttpStatusCode.NotFound);

        var qs = ParseQueryString(req.Url);
        DateTimeOffset? from = TryParseDateParam(qs.GetValueOrDefault("from"));
        DateTimeOffset? to = TryParseDateParam(qs.GetValueOrDefault("to"), endOfDay: true);

        var eventsInRange = await wearHistoryRepo.GetByItemAsync(
            id,
            userId!,
            from,
            to,
            maxResults: 1000,
            cancellationToken: cancellationToken);

        var allTracked = await wearHistoryRepo.GetByItemAsync(
            id,
            userId!,
            from: null,
            to: null,
            maxResults: 5000,
            cancellationToken: cancellationToken);

        var trackedFrom = allTracked.Count > 0
            ? allTracked.Min(e => e.OccurredAt)
            : (DateTimeOffset?)null;
        var legacyUntrackedCount = Math.Max(item.WearCount - allTracked.Count, 0);

        var response = new WearHistoryResponse
        {
            ItemId = id,
            Events = eventsInRange,
            Summary = new WearHistorySummary
            {
                TotalInRange = eventsInRange.Count,
                TrackedFrom = trackedFrom,
                LegacyUntrackedCount = legacyUntrackedCount,
            },
        };

        return await JsonOk(req, response, PluckItJsonContext.Default.WearHistoryResponse);
    }

    // ── POST /api/wardrobe/styling-activity ─────────────────────────────────

    [Function(nameof(RecordStylingActivity))]
    public async Task<HttpResponseData> RecordStylingActivity(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "wardrobe/styling-activity")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed)
            return req.CreateResponse(HttpStatusCode.Unauthorized);

        StylingActivityRequest? body;
        try
        {
            body = await JsonSerializer.DeserializeAsync(
                req.Body, PluckItJsonContext.Default.StylingActivityRequest, cancellationToken);
        }
        catch
        {
                return await JsonError(req, HttpStatusCode.BadRequest, InvalidRequestBodyMessage);
        }

        if (body is null || string.IsNullOrWhiteSpace(body.ItemId))
            return await JsonError(req, HttpStatusCode.BadRequest, "itemId is required.");

        var item = await repo.GetByIdAsync(body.ItemId, userId!, cancellationToken);
        if (item is null)
            return req.CreateResponse(HttpStatusCode.NotFound);

        if (!string.IsNullOrWhiteSpace(body.ClientEventId))
        {
            var existing = await stylingActivityRepo.GetByClientEventIdAsync(
                userId!,
                body.ClientEventId,
                cancellationToken);
            if (existing is not null)
            {
                return await JsonOk(
                    req,
                    new StylingActivityResponse("recorded", existing.Id),
                    PluckItJsonContext.Default.StylingActivityResponse);
            }
        }

        var occurredAt = body.OccurredAt ?? DateTimeOffset.UtcNow;
        var record = new StylingActivityRecord
        {
            Id = string.IsNullOrWhiteSpace(body.ClientEventId)
                ? $"sty-{Guid.NewGuid():N}"
                : body.ClientEventId!,
            UserId = userId!,
            ItemId = body.ItemId,
            ClientEventId = body.ClientEventId,
            ActivityType = body.ActivityType,
            Source = body.Source,
            OccurredAt = occurredAt,
            Status = WearSuggestionStatus.Pending,
            SuggestionMessage = "You added this to styling yesterday — mark as worn?",
            ExpiresAt = occurredAt.AddDays(3),
            LastUpdatedAt = DateTimeOffset.UtcNow,
        };

        var saved = await stylingActivityRepo.UpsertAsync(record, cancellationToken);
        return await JsonOk(
            req,
            new StylingActivityResponse("recorded", saved.Id),
            PluckItJsonContext.Default.StylingActivityResponse);
    }

    // ── GET /api/wardrobe/wear-suggestions ──────────────────────────────────

    [Function(nameof(GetWearSuggestions))]
    public async Task<HttpResponseData> GetWearSuggestions(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "wardrobe/suggestions/wear")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed)
            return req.CreateResponse(HttpStatusCode.Unauthorized);

        var pending = await stylingActivityRepo.GetPendingSuggestionsAsync(
            userId!,
            DateTimeOffset.UtcNow,
            maxResults: 20,
            cancellationToken: cancellationToken);

        var suggestions = new List<WearSuggestionItem>();
        foreach (var activity in pending)
        {
            var item = await repo.GetByIdAsync(activity.ItemId, userId!, cancellationToken);
            if (item is null)
                continue;

            if (item.LastWornAt.HasValue && item.LastWornAt.Value >= activity.OccurredAt)
            {
                await stylingActivityRepo.UpdateSuggestionStatusAsync(
                    activity.Id,
                    userId!,
                    WearSuggestionStatus.Expired,
                    cancellationToken: cancellationToken);
                continue;
            }

            suggestions.Add(new WearSuggestionItem
            {
                SuggestionId = activity.Id,
                ItemId = activity.ItemId,
                Message = string.IsNullOrWhiteSpace(activity.SuggestionMessage)
                    ? "You added this item to styling recently — mark as worn?"
                    : activity.SuggestionMessage!,
                ActivityAt = activity.OccurredAt,
                ExpiresAt = activity.ExpiresAt,
                ImageUrl = sasService.GenerateSasUrl(item.ImageUrl),
            });
        }

        return await JsonOk(
            req,
            new WearSuggestionsResponse { Suggestions = suggestions },
            PluckItJsonContext.Default.WearSuggestionsResponse);
    }

    // ── PATCH /api/wardrobe/wear-suggestions/{suggestionId} ─────────────────

    [Function(nameof(UpdateWearSuggestionStatus))]
    public async Task<HttpResponseData> UpdateWearSuggestionStatus(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "wardrobe/suggestions/wear/{suggestionId}")]
        HttpRequestData req,
        string suggestionId,
        CancellationToken cancellationToken)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed)
            return req.CreateResponse(HttpStatusCode.Unauthorized);

        UpdateWearSuggestionStatusRequest? body;
        try
        {
            body = await JsonSerializer.DeserializeAsync(
                req.Body, PluckItJsonContext.Default.UpdateWearSuggestionStatusRequest, cancellationToken);
        }
        catch
        {
                return await JsonError(req, HttpStatusCode.BadRequest, InvalidRequestBodyMessage);
        }

        if (body is null)
            return await JsonError(req, HttpStatusCode.BadRequest, "Request body is required.");

        var updated = await stylingActivityRepo.UpdateSuggestionStatusAsync(
            suggestionId,
            userId!,
            body.Status,
            cancellationToken: cancellationToken);
        if (updated is null)
            return req.CreateResponse(HttpStatusCode.NotFound);

        return await JsonOk(
            req,
            new UpdateWearSuggestionStatusResponse("updated"),
            PluckItJsonContext.Default.UpdateWearSuggestionStatusResponse);
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
        var contentType = req.Headers.TryGetValues(ContentTypeHeader, out var cts)
            ? cts.FirstOrDefault() ?? OctetStream
            : OctetStream;

        byte[] imageBytes;
        string mediaType;

        if (contentType.Contains("multipart/form-data", StringComparison.OrdinalIgnoreCase))
        {
            (imageBytes, mediaType) = await MultipartReader.ReadFirstFileAsync(req.Body, contentType);
            if (imageBytes.Length == 0)
                return await JsonError(req, HttpStatusCode.BadRequest, NoImageProvidedMessage);
        }
        else
        {
            using var ms = new MemoryStream();
            await req.Body.CopyToAsync(ms, cancellationToken);
            imageBytes = ms.ToArray();
            mediaType = contentType.Split(';')[0].Trim();
            if (imageBytes.Length == 0)
                return await JsonError(req, HttpStatusCode.BadRequest, NoImageProvidedMessage);
        }

        var itemId = $"upload-{Guid.NewGuid():N}";
        var now = DateTimeOffset.UtcNow;

        // Upload raw bytes to blob for retry capability
        string rawBlobUrl;
        try
        {
            rawBlobUrl = await sasService.UploadRawAsync($"{userId}/{itemId}", imageBytes, mediaType, cancellationToken);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to upload raw image to blob storage.");
            return await JsonError(req, HttpStatusCode.ServiceUnavailable, ContentTypeErrorMessage);
        }

        // Write Processing draft atomically — CancellationToken.None so a client disconnect
        // cannot orphan the blob without a tracking document.
        var draftDoc = new ClothingItem
        {
            Id = itemId,
            UserId = userId!,
            RawImageBlobUrl = rawBlobUrl,
            DraftStatus = DraftStatus.Processing,
            DraftCreatedAt = now,
            DraftUpdatedAt = now,
        };
        await repo.UpsertAsync(draftDoc, CancellationToken.None);
        await RefreshWardrobeFingerprintAsync(userId!, CancellationToken.None);
        if (logger.IsEnabled(LogLevel.Information))
            logger.LogInformation("Draft {ItemId} created for user {UserId}, status Processing.", itemId, userId);

        // Enqueue the processing job — the queue worker handles the full pipeline
        // asynchronously, so this request returns immediately with 202 Accepted.
        await jobQueue.EnqueueAsync(
            new ImageProcessingMessage(
                ItemId: itemId,
                UserId: userId!,
                RawImageBlobUrl: rawBlobUrl,
                Attempt: 1,
                EnqueuedAt: now),
            CancellationToken.None);
        if (logger.IsEnabled(LogLevel.Information))
            logger.LogInformation("Draft {ItemId} enqueued for async processing.", itemId);

        // Return 202 Accepted with the Processing draft for immediate UI feedback.
        var response = req.CreateResponse(HttpStatusCode.Accepted);
        response.Headers.Add(ContentTypeHeader, JsonContentType);
        await response.WriteStringAsync(
            JsonSerializer.Serialize(draftDoc, PluckItJsonContext.Default.ClothingItem));
        return response;
    }

    // ── GET /api/wardrobe/drafts ─────────────────────────────────────────────

    [Function(nameof(GetDraftItems))]
    public async Task<HttpResponseData> GetDraftItems(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "wardrobe/drafts")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed)
            return req.CreateResponse(HttpStatusCode.Unauthorized);

        var qs = ParseQueryString(req.Url);
        var pageSize = int.TryParse(qs.GetValueOrDefault("pageSize"), out var s) ? Math.Clamp(s, 1, 50) : 50;
        var continuationToken = qs.GetValueOrDefault("continuationToken");

        var result = await repo.GetDraftsAsync(userId!, pageSize, continuationToken, cancellationToken);

        // Enrich Ready drafts with SAS image URLs for preview
        foreach (var item in result.Items.Where(item => !string.IsNullOrEmpty(item.ImageUrl)))
            item.ImageUrl = sasService.GenerateSasUrl(item.ImageUrl);

        return await JsonOk(req, result, PluckItJsonContext.Default.WardrobeDraftsResult);
    }

    // ── PATCH /api/wardrobe/drafts/{id}/accept ───────────────────────────────

    [Function(nameof(AcceptDraft))]
    public async Task<HttpResponseData> AcceptDraft(
        [HttpTrigger(AuthorizationLevel.Anonymous, "patch", Route = "wardrobe/drafts/{id}/accept")] HttpRequestData req,
        string id,
        CancellationToken cancellationToken)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed)
            return req.CreateResponse(HttpStatusCode.Unauthorized);

        // Read item first to capture rawImageBlobUrl before AcceptDraftAsync removes it
        var existing = await repo.GetByIdAsync(id, userId!, cancellationToken);
        if (existing is null)
            return req.CreateResponse(HttpStatusCode.NotFound);

        var rawUrl = existing.RawImageBlobUrl;
        var accepted = await repo.AcceptDraftAsync(id, userId!, DateTimeOffset.UtcNow, cancellationToken);
        if (accepted is null)
            return await JsonError(req, HttpStatusCode.Conflict,
                "Draft is not in Ready state. It may have already been accepted or is still processing.");

        // Best-effort: delete raw upload blob — no longer needed after acceptance
        if (!string.IsNullOrEmpty(rawUrl))
            await sasService.DeleteBlobAsync(rawUrl, CancellationToken.None);

        await RefreshWardrobeFingerprintAsync(userId!, cancellationToken);

        accepted.ImageUrl = sasService.GenerateSasUrl(accepted.ImageUrl);
        return await JsonOk(req, accepted, PluckItJsonContext.Default.ClothingItem);
    }

    // ── POST /api/wardrobe/drafts/{id}/retry ─────────────────────────────────

    [Function(nameof(RetryDraft))]
    public async Task<HttpResponseData> RetryDraft(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "wardrobe/drafts/{id}/retry")] HttpRequestData req,
        string id,
        CancellationToken cancellationToken)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed)
            return req.CreateResponse(HttpStatusCode.Unauthorized);

        var item = await repo.GetByIdAsync(id, userId!, cancellationToken);
        if (item is null)
            return req.CreateResponse(HttpStatusCode.NotFound);

        if (item.DraftStatus != DraftStatus.Failed)
            return await JsonError(req, HttpStatusCode.Conflict, RetryDraftConflictMessage);

        if (string.IsNullOrEmpty(item.RawImageBlobUrl))
            return await JsonError(req, HttpStatusCode.Gone, "Raw image no longer available for retry.");

        // Transition back to Processing via full upsert (guarded by the Failed check above)
        var now = DateTimeOffset.UtcNow;
        item.DraftStatus = DraftStatus.Processing;
        item.DraftUpdatedAt = now;
        item.DraftError = null;
        await repo.UpsertAsync(item, CancellationToken.None);
        await RefreshWardrobeFingerprintAsync(userId!, CancellationToken.None);
        if (logger.IsEnabled(LogLevel.Information))
            logger.LogInformation("Retrying failed draft {ItemId} for user {UserId}.", id, userId);

        // Enqueue for async processing — worker will handle the full pipeline
        await jobQueue.EnqueueAsync(
            new ImageProcessingMessage(
                ItemId: id,
                UserId: userId!,
                RawImageBlobUrl: item.RawImageBlobUrl!,
                Attempt: 1,
                EnqueuedAt: now),
            CancellationToken.None);

        // Return 202 Accepted with the current (Processing) draft
        var response = req.CreateResponse(HttpStatusCode.Accepted);
        response.Headers.Add(ContentTypeHeader, JsonContentType);
        await response.WriteStringAsync(
            JsonSerializer.Serialize(item, PluckItJsonContext.Default.ClothingItem));
        return response;
    }

    // ── Timer: clean up abandoned / stale drafts (03:00 UTC daily) ───────────

    [Function("CleanupAbandonedDrafts")]
    public async Task CleanupAbandonedDrafts(
        [TimerTrigger("0 0 3 * * *")] TimerInfo timer,
        CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        if (logger.IsEnabled(LogLevel.Information))
            logger.LogInformation("CleanupAbandonedDrafts starting at {Now}.", now);

        // Pass 1: Processing drafts stuck > 2 hours → Failed
        var cutoff2h = now.AddHours(-2);
        var abandoned = await repo.GetByDraftStatusAsync(
            DraftStatus.Processing, cutoff2h, maxItems: 200, cancellationToken);
        foreach (var item in abandoned)
        {
            await repo.SetDraftTerminalAsync(
                item.Id, item.UserId, DraftStatus.Failed,
                null, null, "Timed out during processing.",
                CancellationToken.None);
        }

        // Pass 2: Failed drafts older than 7 days → delete doc + blobs
        var cutoff7d = now.AddDays(-7);
        var stale = await repo.GetByDraftStatusAsync(
            DraftStatus.Failed, cutoff7d, maxItems: 200, cancellationToken);
        foreach (var item in stale)
        {
            await repo.DeleteAsync(item.Id, item.UserId, CancellationToken.None);
            if (!string.IsNullOrEmpty(item.RawImageBlobUrl))
                await sasService.DeleteBlobAsync(item.RawImageBlobUrl, CancellationToken.None);
            if (!string.IsNullOrEmpty(item.ImageUrl))
                await sasService.DeleteBlobAsync(item.ImageUrl, CancellationToken.None);
        }

        if (logger.IsEnabled(LogLevel.Information))
            logger.LogInformation("CleanupAbandonedDrafts: transitioned {A}, purged {S}.",
            abandoned.Count, stale.Count);
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
            return await JsonError(req, HttpStatusCode.BadRequest, InvalidRequestBodyMessage);
        }

        if (item is null)
            return await JsonError(req, HttpStatusCode.BadRequest, "Request body is required.");

        if (string.IsNullOrWhiteSpace(item.Id))
            item.Id = Guid.NewGuid().ToString("N");
        item.UserId = userId!;
        if (item.DateAdded is null)
            item.DateAdded = DateTimeOffset.UtcNow;

        await repo.UpsertAsync(item, cancellationToken);
        await RefreshWardrobeFingerprintAsync(userId!, cancellationToken);

        var response = req.CreateResponse(HttpStatusCode.Created);
        response.Headers.Add("Location", $"/api/wardrobe/{item.Id}");
        response.Headers.Add(ContentTypeHeader, JsonContentType);
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
                var sub = await authContext.TokenValidator.ValidateAsync(token);
                if (sub is not null) return (true, sub);
            }
        }

        var devId = authContext.LocalDevUserId;
        if (!string.IsNullOrEmpty(devId)) return (true, devId);

        return (false, null);
    }

    private async Task RefreshWardrobeFingerprintAsync(string userId, CancellationToken cancellationToken)
    {
        try
        {
            var allItemIds = new List<string>();
            string? continuationToken = null;
            do
            {
                var page = await repo.GetAllAsync(
                    userId,
                    new WardrobeQuery
                    {
                        PageSize = 100,
                        ContinuationToken = continuationToken,
                    },
                    cancellationToken);

                foreach (var item in page.Items)
                    allItemIds.Add(item.Id);

                continuationToken = page.NextContinuationToken;
            }
            while (!string.IsNullOrEmpty(continuationToken));

            var profile = await userProfileRepo.GetAsync(userId, cancellationToken);
            if (profile is null)
                profile = new UserProfile { Id = userId };

            profile.WardrobeFingerprint = ComputeWardrobeFingerprint(allItemIds);
            await userProfileRepo.UpsertAsync(profile, cancellationToken);
        }
        catch (Exception exc)
        {
            logger.LogWarning(exc, "Failed to refresh wardrobe fingerprint for user {UserId}.", userId);
        }
    }

    private static string ComputeWardrobeFingerprint(IEnumerable<string> itemIds)
    {
        var ordered = itemIds
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id.Trim())
            .OrderBy(id => id, StringComparer.Ordinal)
            .ToArray();
        var canonical = string.Join(",", ordered);

        using var sha = SHA256.Create();
        var bytes = Encoding.UTF8.GetBytes(canonical);
        var hash = sha.ComputeHash(bytes);
        return Convert.ToHexString(hash).Substring(0, 16).ToLowerInvariant();
    }

    private static async Task<HttpResponseData> JsonOk<T>(
        HttpRequestData req, T body, System.Text.Json.Serialization.Metadata.JsonTypeInfo<T> typeInfo)
    {
        var response = req.CreateResponse(HttpStatusCode.OK);
        response.Headers.Add(ContentTypeHeader, JsonContentType);
        await response.WriteStringAsync(JsonSerializer.Serialize(body, typeInfo));
        return response;
    }

    private static async Task<HttpResponseData> JsonError(
        HttpRequestData req, HttpStatusCode status, string message)
    {
        var response = req.CreateResponse(status);
        response.Headers.Add(ContentTypeHeader, JsonContentType);
        await response.WriteStringAsync(
            JsonSerializer.Serialize(new ErrorResponse(message), PluckItJsonContext.Default.ErrorResponse));
        return response;
    }

    private static DateTimeOffset? TryParseDateParam(string? value, bool endOfDay = false)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AllowWhiteSpaces, out var dto))
            return dto;

        if (DateOnly.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
        {
            var dt = endOfDay
                ? date.ToDateTime(TimeOnly.MaxValue, DateTimeKind.Utc)
                : date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
            return new DateTimeOffset(dt);
        }

        return null;
    }

    private static ItemCondition? ParseCondition(string? raw)
    {
        if (!Enum.TryParse<ItemCondition>(raw, ignoreCase: true, out var value))
            return null;
        return value;
    }

    private static decimal? ParseOptionalDecimal(string? raw)
        => decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out var value) ? value : null;

    private static int ParseOptionalInt(string? raw, int defaultValue, int min, int max)
        => int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value)
            ? Math.Clamp(value, min, max)
            : defaultValue;

    private static int? ParseOptionalIntOrNull(string? raw)
    {
        if (!int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var value))
            return null;
        return value;
    }

    private static string ParseSortField(string? raw)
        => raw is string sortField &&
           WardrobeSortField.Allowlist.Contains(sortField, StringComparer.OrdinalIgnoreCase)
                ? sortField
                : WardrobeSortField.DateAdded;

    private static string ParseSortDirection(string? raw)
        => string.Equals(raw, "asc", StringComparison.OrdinalIgnoreCase) ? "asc" : "desc";

    private static string[]? ParseCsv(Dictionary<string, string> query, string key)
        => query.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value)
            ? value.Split(',', StringSplitOptions.RemoveEmptyEntries)
            : null;

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
    private const string OctetStream = "application/octet-stream";

    internal static async Task<(byte[] Bytes, string MediaType)> ReadFirstFileAsync(Stream body, string contentType)
    {
        var boundary = ExtractBoundary(contentType);
        if (boundary is null) return ([], OctetStream);

        using var ms = new MemoryStream();
        await body.CopyToAsync(ms);
        var data = ms.ToArray();

        var delimiter = Encoding.UTF8.GetBytes("--" + boundary);
        var crlfcrlf = "\r\n\r\n"u8.ToArray();

        // Find first boundary line
        var start = IndexOf(data, delimiter, 0);
        if (start < 0) return ([], OctetStream);

        // Skip past boundary + CRLF to reach part headers
        var headerStart = start + delimiter.Length + 2;

        // Find the blank line separating headers from content
        var contentStart = IndexOf(data, crlfcrlf, headerStart);
        if (contentStart < 0) return ([], OctetStream);
        contentStart += 4; // skip \r\n\r\n

        // Parse Content-Type from part headers
        var headersText = Encoding.UTF8.GetString(data, headerStart, contentStart - headerStart - 4);
        var mediaType = OctetStream;
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
