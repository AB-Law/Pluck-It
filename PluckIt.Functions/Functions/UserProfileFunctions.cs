using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Configuration;
using PluckIt.Core;
using PluckIt.Functions.Auth;
using PluckIt.Functions.Serialization;

namespace PluckIt.Functions.Functions;

public class UserProfileFunctions(
    IUserProfileRepository profileRepo,
    IConfiguration config,
    GoogleTokenValidator tokenValidator,
    RefreshSessionStore? refreshSessionStore = null)
{
    // ── GET /api/profile ───────────────────────────────────────────────────

    [Function(nameof(GetProfile))]
    public async Task<HttpResponseData> GetProfile(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "profile")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed)
            return req.CreateResponse(HttpStatusCode.Unauthorized);

        var profile = await profileRepo.GetAsync(userId!, cancellationToken);
        if (profile is null)
        {
            // Return a default profile — no document written until the user saves
            profile = new UserProfile { Id = userId! };
        }

        var response = req.CreateResponse(HttpStatusCode.OK);
        response.Headers.Add("Content-Type", "application/json; charset=utf-8");
        await response.WriteStringAsync(
            JsonSerializer.Serialize(profile, PluckItJsonContext.Default.UserProfile));
        return response;
    }

    // ── PUT /api/profile ───────────────────────────────────────────────────

    [Function(nameof(UpdateProfile))]
    public async Task<HttpResponseData> UpdateProfile(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = "profile")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed)
            return req.CreateResponse(HttpStatusCode.Unauthorized);

        UserProfile? profile;
        try
        {
            profile = await JsonSerializer.DeserializeAsync(
                req.Body, PluckItJsonContext.Default.UserProfile, cancellationToken);
        }
        catch
        {
            var bad = req.CreateResponse(HttpStatusCode.BadRequest);
            bad.Headers.Add("Content-Type", "application/json; charset=utf-8");
            await bad.WriteStringAsync(
                JsonSerializer.Serialize(new ErrorResponse("Invalid request body."),
                    PluckItJsonContext.Default.ErrorResponse));
            return bad;
        }

        if (profile is null)
        {
            var bad = req.CreateResponse(HttpStatusCode.BadRequest);
            bad.Headers.Add("Content-Type", "application/json; charset=utf-8");
            await bad.WriteStringAsync(
                JsonSerializer.Serialize(new ErrorResponse("Request body is required."),
                    PluckItJsonContext.Default.ErrorResponse));
            return bad;
        }

        // Always force Id to the authenticated user — never trust the body
        profile.Id = userId!;
        await profileRepo.UpsertAsync(profile, cancellationToken);
        return req.CreateResponse(HttpStatusCode.NoContent);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

    private async Task<(bool Authed, string? UserId)> TryGetUserIdAsync(
        HttpRequestData req,
        CancellationToken cancellationToken = default)
    {
        if (TryGetBearerToken(req, out var token))
        {
            var sub = await tokenValidator.ValidateAsync(token);
            if (sub is not null) return (true, sub);

            var sessionUserId = await ResolveUserIdFromSessionTokenAsync(token, cancellationToken);
            if (!string.IsNullOrWhiteSpace(sessionUserId))
                return (true, sessionUserId);
        }

        var devId = config["Local:DevUserId"];
        if (!string.IsNullOrEmpty(devId)) return (true, devId);

        return (false, null);
    }

    private static bool TryGetBearerToken(HttpRequestData req, out string token)
    {
        token = string.Empty;
        if (!req.Headers.TryGetValues("Authorization", out var authHeaders))
            return false;

        var header = authHeaders.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(header) || !header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return false;

        token = header["Bearer ".Length..].Trim();
        return !string.IsNullOrWhiteSpace(token);
    }

    private async Task<string?> ResolveUserIdFromSessionTokenAsync(string token, CancellationToken cancellationToken)
    {
        if (refreshSessionStore is null)
            return null;

        try
        {
            return await refreshSessionStore.ResolveUserIdFromAccessTokenAsync(token, cancellationToken);
        }
        catch
        {
            return null;
        }
    }
}
