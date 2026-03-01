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
    GoogleTokenValidator tokenValidator)
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

    private async Task<(bool Authed, string? UserId)> TryGetUserIdAsync(HttpRequestData req)
    {
        if (req.Headers.TryGetValues("Authorization", out var authHeaders))
        {
            var header = authHeaders is System.Collections.Generic.IEnumerable<string> headers
                ? System.Linq.Enumerable.FirstOrDefault(headers)
                : null;
            if (header?.StartsWith("Bearer ", System.StringComparison.OrdinalIgnoreCase) == true)
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
}
