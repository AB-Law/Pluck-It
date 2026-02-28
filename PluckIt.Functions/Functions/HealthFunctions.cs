using System.Net;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using PluckIt.Functions.Serialization;

namespace PluckIt.Functions.Functions;

public class HealthFunctions
{
    [Function(nameof(Health))]
    public async Task<HttpResponseData> Health(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "health")] HttpRequestData req)
    {
        var response = req.CreateResponse(HttpStatusCode.OK);
        response.Headers.Add("Content-Type", "application/json; charset=utf-8");
        await response.WriteStringAsync(
            JsonSerializer.Serialize(
                new HealthResponse("healthy", "PluckIt Functions API"),
                PluckItJsonContext.Default.HealthResponse));
        return response;
    }
}
