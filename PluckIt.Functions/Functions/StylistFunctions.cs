using System.Net;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using PluckIt.Core;
using PluckIt.Functions.Serialization;

namespace PluckIt.Functions.Functions;

public class StylistFunctions(
    IWardrobeRepository repo,
    IStylistService stylist,
    IConfiguration config,
    ILogger<StylistFunctions> logger)
{
    [Function(nameof(GetRecommendations))]
    public async Task<HttpResponseData> GetRecommendations(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "stylist/recommendations")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(req, out var userId))
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

        var wardrobe = await repo.GetAllAsync(
            userId: userId!,
            category: null,
            tags: null,
            page: 0,
            pageSize: 200,
            cancellationToken);

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

    private bool TryGetUserId(HttpRequestData req, out string? userId)
    {
        if (req.Headers.TryGetValues("x-ms-client-principal-id", out var ids))
        {
            var id = ids.FirstOrDefault();
            if (!string.IsNullOrEmpty(id)) { userId = id; return true; }
        }

        var devId = config["Local:DevUserId"];
        if (!string.IsNullOrEmpty(devId)) { userId = devId; return true; }

        userId = null;
        return false;
    }
}
