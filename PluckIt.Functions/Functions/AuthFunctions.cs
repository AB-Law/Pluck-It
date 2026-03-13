using System.Net;
using System.Text.Json;
using System.Threading;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using PluckIt.Functions.Auth;

namespace PluckIt.Functions.Functions;

/// <summary>
/// Authentication exchange endpoints used by mobile clients.
/// </summary>
public class AuthFunctions(WardrobeFunctionsAuthContext authContext)
{
    private const string JsonContentType = "application/json; charset=utf-8";

    /// <summary>
    /// Exchanges a Google ID token for an app session token.
    /// Contract examples:
    /// {
    ///   "id_token": "...",
    ///   "token": "..."
    /// }
    /// </summary>
    [Function(nameof(MobileTokenExchange))]
    public async Task<HttpResponseData> MobileTokenExchange(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "auth/mobile-token")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        JsonDocument bodyDoc;
        try
        {
            bodyDoc = await JsonDocument.ParseAsync(req.Body, cancellationToken: cancellationToken);
        }
        catch
        {
            var bad = req.CreateResponse(HttpStatusCode.BadRequest);
            bad.Headers.Add("Content-Type", JsonContentType);
            await bad.WriteStringAsync(
                JsonSerializer.Serialize(new { error = "Request body must be JSON." }));
            return bad;
        }
        using (bodyDoc)
        {
            var root = bodyDoc.RootElement;
            var idToken = ResolveIdToken(root);

            if (string.IsNullOrWhiteSpace(idToken))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                bad.Headers.Add("Content-Type", JsonContentType);
                await bad.WriteStringAsync(
                    JsonSerializer.Serialize(new { error = "Missing required field: id_token." }));
                return bad;
            }

            var googleUserId = await authContext.TokenValidator.ValidateAsync(idToken!);
            if (googleUserId is null)
            {
                var unauthorized = req.CreateResponse(HttpStatusCode.Unauthorized);
                unauthorized.Headers.Add("Content-Type", JsonContentType);
                await unauthorized.WriteStringAsync(
                    JsonSerializer.Serialize(new { error = "Invalid or expired Google ID token." }));
                return unauthorized;
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add("Content-Type", JsonContentType);
            await response.WriteStringAsync(
                JsonSerializer.Serialize(new
                {
                    access_token = idToken,
                    token = idToken,
                    session_token = idToken,
                    app_token = idToken,
                    id_token = idToken,
                    user_id = googleUserId,
                    userId = googleUserId,
                }));
            return response;
        }
    }

    private static string? ResolveIdToken(JsonElement root)
    {
        var candidates = new[] { "id_token", "idToken", "token", "idTokenValue" };
        foreach (var candidate in candidates)
        {
            if (root.TryGetProperty(candidate, out var tokenElement) &&
                tokenElement.ValueKind == JsonValueKind.String)
            {
                var token = tokenElement.GetString();
                if (!string.IsNullOrWhiteSpace(token))
                    return token;
            }
        }

        return null;
    }
}

