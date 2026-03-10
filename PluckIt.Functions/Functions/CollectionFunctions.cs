using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using PluckIt.Core;
using PluckIt.Functions.Auth;
using PluckIt.Functions.Serialization;

namespace PluckIt.Functions.Functions;

/// <summary>
/// HTTP-triggered Azure Functions for wardrobe collection management.
/// Route prefix: /api/collections
/// Auth: Google Bearer token (same as WardrobeFunctions)
/// </summary>
public class CollectionFunctions(
    ICollectionRepository repo,
    GoogleTokenValidator tokenValidator,
    IConfiguration config,
    ILogger<CollectionFunctions> logger)
{
    // suppress "unused parameter" — logger reserved for future structured logging
    private readonly ILogger<CollectionFunctions> _logger = logger;
    // ── GET /api/collections ─────────────────────────────────────────────────
    // Returns owned collections + joined collections merged.

    [Function(nameof(GetCollections))]
    public async Task<HttpResponseData> GetCollections(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "collections")] HttpRequestData req,
        CancellationToken ct)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed) return req.CreateResponse(HttpStatusCode.Unauthorized);

        var owned  = await repo.GetByOwnerAsync(userId!, ct);
        var joined = await repo.GetJoinedByUserAsync(userId!, ct);

        // Deduplicate (owner won't be in joined, but guard anyway)
        var all = owned.Concat(joined.Where(j => j.OwnerId != userId)).ToList();
        return await JsonOk(req, all, PluckItJsonContext.Default.ListCollection);
    }

    // ── POST /api/collections ────────────────────────────────────────────────

    [Function(nameof(CreateCollection))]
    public async Task<HttpResponseData> CreateCollection(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "collections")] HttpRequestData req,
        CancellationToken ct)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed) return req.CreateResponse(HttpStatusCode.Unauthorized);

        Collection? body;
        try
        {
            body = await JsonSerializer.DeserializeAsync(req.Body, PluckItJsonContext.Default.Collection, ct);
        }
        catch { return await JsonError(req, HttpStatusCode.BadRequest, "Invalid request body."); }

        if (body is null || string.IsNullOrWhiteSpace(body.Name))
            return await JsonError(req, HttpStatusCode.BadRequest, "Name is required.");

        var collection = new Collection
        {
            Id       = Guid.NewGuid().ToString(),
            OwnerId  = userId!,
            Name     = body.Name,
            Description    = body.Description,
            IsPublic = body.IsPublic,
            CreatedAt = DateTimeOffset.UtcNow,
            ClothingItemIds = body.ClothingItemIds,
            MemberUserIds   = Array.Empty<string>(),
        };

        var saved = await repo.UpsertAsync(collection, ct);

        var response = req.CreateResponse(HttpStatusCode.Created);
        response.Headers.Add("Content-Type", "application/json; charset=utf-8");
        await response.WriteStringAsync(JsonSerializer.Serialize(saved, PluckItJsonContext.Default.Collection));
        return response;
    }

    // ── GET /api/collections/{id} ────────────────────────────────────────────

    [Function(nameof(GetCollection))]
    public async Task<HttpResponseData> GetCollection(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "collections/{id}")] HttpRequestData req,
        string id, CancellationToken ct)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed) return req.CreateResponse(HttpStatusCode.Unauthorized);

        // Try owned first; fall back to joined (any ownerId cross-partition)
        var owned = await repo.GetByOwnerAsync(userId!, ct);
        var collection = owned.FirstOrDefault(c => c.Id == id);

        if (collection is null)
        {
            // May be another user's public collection
            var joined = await repo.GetJoinedByUserAsync(userId!, ct);
            collection = joined.FirstOrDefault(c => c.Id == id);
        }

        if (collection is null) return req.CreateResponse(HttpStatusCode.NotFound);
        return await JsonOk(req, collection, PluckItJsonContext.Default.Collection);
    }

    // ── PUT /api/collections/{id} ────────────────────────────────────────────
    // Owner-only: update name, description, isPublic.

    [Function(nameof(UpdateCollection))]
    public async Task<HttpResponseData> UpdateCollection(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "collections/{id}")] HttpRequestData req,
        string id, CancellationToken ct)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed) return req.CreateResponse(HttpStatusCode.Unauthorized);

        var existing = await repo.GetByIdAsync(id, userId!, ct);
        if (existing is null) return req.CreateResponse(HttpStatusCode.NotFound);

        try
        {
            using var doc = await JsonDocument.ParseAsync(req.Body, cancellationToken: ct);
            var root = doc.RootElement;

            if (TryGetProperty(root, "name", out var nameEl) &&
                nameEl.ValueKind != JsonValueKind.Null)
            {
                var name = nameEl.GetString();
                if (!string.IsNullOrWhiteSpace(name))
                    existing.Name = name;
            }

            if (TryGetProperty(root, "description", out var descEl))
            {
                existing.Description = descEl.ValueKind == JsonValueKind.Null
                    ? existing.Description
                    : descEl.GetString() ?? existing.Description;
            }

            if (TryGetProperty(root, "isPublic", out var publicEl) &&
                (publicEl.ValueKind == JsonValueKind.True || publicEl.ValueKind == JsonValueKind.False))
            {
                existing.IsPublic = publicEl.GetBoolean();
            }
        }
        catch { return await JsonError(req, HttpStatusCode.BadRequest, "Invalid request body."); }

        await repo.UpsertAsync(existing, ct);
        return req.CreateResponse(HttpStatusCode.NoContent);
    }

    // ── DELETE /api/collections/{id} ─────────────────────────────────────────

    [Function(nameof(DeleteCollection))]
    public async Task<HttpResponseData> DeleteCollection(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "collections/{id}")] HttpRequestData req,
        string id, CancellationToken ct)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed) return req.CreateResponse(HttpStatusCode.Unauthorized);

        await repo.DeleteAsync(id, userId!, ct);
        return req.CreateResponse(HttpStatusCode.NoContent);
    }

    // ── POST /api/collections/{id}/join ──────────────────────────────────────
    // Calling user joins a public collection (ownerId discovered cross-partition).

    [Function(nameof(JoinCollection))]
    public async Task<HttpResponseData> JoinCollection(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "collections/{id}/join")] HttpRequestData req,
        string id, CancellationToken ct)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed) return req.CreateResponse(HttpStatusCode.Unauthorized);

        var collection = await repo.FindByIdAsync(id, ct);
        if (collection is null)
            return await JsonError(req, HttpStatusCode.NotFound, "Collection not found.");

        if (!collection.IsPublic && collection.OwnerId != userId)
            return await JsonError(req, HttpStatusCode.Forbidden, "This collection is private.");

        // Owner is already the creator — joining their own collection is a no-op
        if (collection.OwnerId == userId)
            return req.CreateResponse(HttpStatusCode.NoContent);

        await repo.AddMemberAsync(id, collection.OwnerId, userId!, ct);
        return req.CreateResponse(HttpStatusCode.NoContent);
    }

    // ── DELETE /api/collections/{id}/leave ───────────────────────────────────

    [Function(nameof(LeaveCollection))]
    public async Task<HttpResponseData> LeaveCollection(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "collections/{id}/leave")] HttpRequestData req,
        string id, CancellationToken ct)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed) return req.CreateResponse(HttpStatusCode.Unauthorized);

        var collection = await repo.FindByIdAsync(id, ct);
        if (collection is null) return req.CreateResponse(HttpStatusCode.NoContent); // already left

        await repo.RemoveMemberAsync(id, collection.OwnerId, userId!, ct);
        return req.CreateResponse(HttpStatusCode.NoContent);
    }

    // ── POST /api/collections/{id}/items ─────────────────────────────────────

    [Function(nameof(AddItemToCollection))]
    public async Task<HttpResponseData> AddItemToCollection(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "collections/{id}/items")] HttpRequestData req,
        string id, CancellationToken ct)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed) return req.CreateResponse(HttpStatusCode.Unauthorized);

        string? itemId;
        try
        {
            using var doc = await System.Text.Json.JsonDocument.ParseAsync(req.Body, cancellationToken: ct);
            itemId = doc.RootElement.TryGetProperty("itemId", out var p) ? p.GetString() : null;
        }
        catch { return await JsonError(req, HttpStatusCode.BadRequest, "Invalid request body."); }

        if (string.IsNullOrWhiteSpace(itemId))
            return await JsonError(req, HttpStatusCode.BadRequest, "itemId is required.");

        try
        {
            await repo.AddItemAsync(id, userId!, itemId, ct);
        }
        catch (InvalidOperationException ex)
        {
            return await JsonError(req, HttpStatusCode.NotFound, ex.Message);
        }

        return req.CreateResponse(HttpStatusCode.NoContent);
    }

    // ── DELETE /api/collections/{id}/items/{itemId} ───────────────────────────

    [Function(nameof(RemoveItemFromCollection))]
    public async Task<HttpResponseData> RemoveItemFromCollection(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = "collections/{id}/items/{itemId}")] HttpRequestData req,
        string id, string itemId, CancellationToken ct)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed) return req.CreateResponse(HttpStatusCode.Unauthorized);

        await repo.RemoveItemAsync(id, userId!, itemId, ct);
        return req.CreateResponse(HttpStatusCode.NoContent);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task<(bool authed, string? userId)> TryGetUserIdAsync(HttpRequestData req)
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

    private static async Task<HttpResponseData> JsonError(HttpRequestData req, HttpStatusCode status, string message)
    {
        var response = req.CreateResponse(status);
        response.Headers.Add("Content-Type", "application/json; charset=utf-8");
        await response.WriteStringAsync(
            JsonSerializer.Serialize(new ErrorResponse(message), PluckItJsonContext.Default.ErrorResponse));
        return response;
    }

    private static bool TryGetProperty(JsonElement root, string propertyName, out JsonElement value)
    {
        if (root.TryGetProperty(propertyName, out value))
            return true;

        // Support PascalCase payloads from non-web clients.
        if (propertyName.Length > 0)
        {
            var pascal = char.ToUpperInvariant(propertyName[0]) + propertyName[1..];
            if (root.TryGetProperty(pascal, out value))
                return true;
        }

        value = default;
        return false;
    }
}
