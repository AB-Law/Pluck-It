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

public class StylistFunctions(
    IWardrobeRepository repo,
    IStylistService stylist,
    IConfiguration config,
    GoogleTokenValidator tokenValidator,
    ILogger<StylistFunctions> logger)
{
    [Function(nameof(GetRecommendations))]
    public async Task<HttpResponseData> GetRecommendations(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "stylist/recommendations")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        var (authed, userId) = await TryGetUserIdAsync(req);
        if (!authed)
            return req.CreateResponse(System.Net.HttpStatusCode.Unauthorized);

        StylistRequest? request;
        try
        {
            request = await JsonSerializer.DeserializeAsync(
                req.Body, PluckItJsonContext.Default.StylistRequest, cancellationToken);
        }
        catch
        {
            return await JsonError(req, HttpStatusCode.BadRequest, "Invalid request body.");
        }

        request ??= new StylistRequest();

        var pageSize = Math.Clamp(request.PageSize ?? 100, 1, 100);

        var wardrobePaged = await repo.GetAllAsync(
            userId!,
            new WardrobeQuery
            {
                PageSize = pageSize,
                Category = request.Category,
                MinWears = request.MinWears,
                MaxWears = request.MaxWears,
            },
            cancellationToken);
        var wardrobe = wardrobePaged.Items;

        if (!wardrobe.Any())
        {
            return await JsonError(req, HttpStatusCode.BadRequest,
                "Your wardrobe is empty. Add some clothing items first.");
        }

        List<OutfitRecommendation> recommendations;
        try
        {
            recommendations = (await stylist.GetRecommendationsAsync(wardrobe, request, cancellationToken)).ToList();
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Stylist service failed to generate recommendations.");
            return await JsonError(req, HttpStatusCode.InternalServerError,
                "Failed to generate recommendations. Please try again.");
        }

        var response = req.CreateResponse(HttpStatusCode.OK);
        response.Headers.Add("Content-Type", "application/json; charset=utf-8");
        await response.WriteStringAsync(
            JsonSerializer.Serialize(recommendations, PluckItJsonContext.Default.ListOutfitRecommendation));
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

    private async Task<(bool Authed, string? UserId)> TryGetUserIdAsync(HttpRequestData req)
    {
        var path = req.Url.PathAndQuery;
        if (req.Headers.TryGetValues("Authorization", out var authHeaders))
        {
            var header = authHeaders.FirstOrDefault();
            if (header?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true)
            {
                var token = header["Bearer ".Length..];
                var tokenPrefix = TruncateTokenPrefix(token);
                var tokenAudience = ReadJwtAudience(token);
                logger.LogDebug(
                    "StylistFunctions auth attempt: path={Path} aud={Audience} tokenPrefix={TokenPrefix}",
                    path,
                    tokenAudience ?? "unknown",
                    tokenPrefix);

                var sub = await tokenValidator.ValidateAsync(token);
                if (sub is not null) return (true, sub);

                logger.LogWarning(
                    "StylistFunctions auth failed: path={Path} aud={Audience} tokenPrefix={TokenPrefix}",
                    path,
                    tokenAudience ?? "unknown",
                    tokenPrefix);
            }
        }

        var devId = config["Local:DevUserId"];
        if (!string.IsNullOrEmpty(devId)) return (true, devId);

        return (false, null);
    }

    private static string? ReadJwtAudience(string token)
    {
        var parts = token.Split('.');
        if (parts.Length < 2 || string.IsNullOrWhiteSpace(parts[1]))
            return null;

        try
        {
            var payload = Convert.FromBase64String(
                parts[1]
                    .Replace('-', '+')
                    .Replace('_', '/')
                    .PadRight(parts[1].Length + (4 - parts[1].Length % 4) % 4, '='));
            using var doc = JsonDocument.Parse(payload);
            if (!doc.RootElement.TryGetProperty("aud", out var aud))
                return null;

            return aud.ValueKind == JsonValueKind.String
                ? aud.GetString()
                : null;
        }
        catch
        {
            return null;
        }
    }

    private static string TruncateTokenPrefix(string token)
    {
        const int maxPrefixLength = 20;
        return string.IsNullOrEmpty(token)
            ? "<empty>"
            : token.Length <= maxPrefixLength
                ? token
                : $"{token[..maxPrefixLength]}...";
    }
}
