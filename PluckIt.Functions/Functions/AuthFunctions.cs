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
public class AuthFunctions(
    WardrobeFunctionsAuthContext authContext,
    RefreshSessionStore refreshSessionStore,
    ITokenResolver tokenResolver)
{
    private const string ContentTypeHeader = "Content-Type";
    private const string JsonContentType = "application/json; charset=utf-8";

    /// <summary>
    /// Access token contract for mobile clients:
    /// <list type="bullet">
    /// <item><description><c>access_token</c> — short-lived token for API calls</description></item>
    /// <item><description><c>expires_in</c> — seconds from issuance</description></item>
    /// <item><description><c>access_token_expires_at</c> — UTC ISO-8601 expiry timestamp</description></item>
    /// <item><description><c>token_type</c> — currently fixed to "Bearer"</description></item>
    /// </list>
    /// Refresh token contract:
    /// <list type="bullet">
    /// <item><description><c>refresh_token</c> — long-lived rotating token</description></item>
    /// <item><description><c>refresh_token_expires_in</c> — seconds until refresh token expiry</description></item>
    /// <item><description><c>refresh_token_expires_at</c> — UTC ISO-8601 refresh expiry timestamp</description></item>
    /// <item><description><c>refresh_token_rotation</c> — single-use token replacement policy</description></item>
    /// <item><description><c>refresh_token_revoke_on_logout</c> — true when revoke endpoint must delete server state</description></item>
    /// </list>
    /// </summary>

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
            bad.Headers.Add(ContentTypeHeader, JsonContentType);
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
                bad.Headers.Add(ContentTypeHeader, JsonContentType);
                await bad.WriteStringAsync(
                    JsonSerializer.Serialize(new { error = "Missing required field: id_token." }));
                return bad;
            }

            var googleUserId = await authContext.TokenValidator.ValidateAsync(idToken!);
            if (googleUserId is null)
            {
                var unauthorized = req.CreateResponse(HttpStatusCode.Unauthorized);
                unauthorized.Headers.Add(ContentTypeHeader, JsonContentType);
                await unauthorized.WriteStringAsync(
                    JsonSerializer.Serialize(new { error = "Invalid or expired Google ID token." }));
                return unauthorized;
            }

            var session = await refreshSessionStore.CreateSessionAsync(googleUserId, cancellationToken);
            if (session is null)
            {
                var serverError = req.CreateResponse(HttpStatusCode.InternalServerError);
                serverError.Headers.Add(ContentTypeHeader, JsonContentType);
                await serverError.WriteStringAsync(
                    JsonSerializer.Serialize(new { error = "Could not issue authentication session." }));
                return serverError;
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add(ContentTypeHeader, JsonContentType);
            await response.WriteStringAsync(
                JsonSerializer.Serialize(BuildSessionResponse(session, googleUserId)));
            return response;
        }
    }

    [Function(nameof(RefreshSession))]
    public async Task<HttpResponseData> RefreshSession(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "auth/refresh")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        JsonDocument bodyDoc;
        try
        {
            bodyDoc = await JsonDocument.ParseAsync(req.Body, cancellationToken: cancellationToken);
        }
        catch
        {
            return await BuildJsonErrorResponse(req, HttpStatusCode.BadRequest, "Request body must be JSON.");
        }

        using (bodyDoc)
        {
            var root = bodyDoc.RootElement;
            var refreshToken = ResolveRefreshToken(root);
            if (string.IsNullOrWhiteSpace(refreshToken))
            {
                return await BuildJsonErrorResponse(req, HttpStatusCode.BadRequest, "Missing required field: refresh_token.");
            }

            var session = await refreshSessionStore.RotateRefreshSessionAsync(refreshToken, cancellationToken);
            if (session is null)
            {
                return await BuildJsonErrorResponse(req, HttpStatusCode.Unauthorized, "Invalid or expired refresh token.");
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            response.Headers.Add(ContentTypeHeader, JsonContentType);
            await response.WriteStringAsync(
                JsonSerializer.Serialize(BuildSessionResponse(session, session.UserId)));
            return response;
        }
    }

    [Function(nameof(RevokeSession))]
    public async Task<HttpResponseData> RevokeSession(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "auth/revoke")] HttpRequestData req,
        CancellationToken cancellationToken)
    {
        JsonDocument bodyDoc;
        try
        {
            bodyDoc = await JsonDocument.ParseAsync(req.Body, cancellationToken: cancellationToken);
        }
        catch
        {
            return await BuildJsonErrorResponse(req, HttpStatusCode.BadRequest, "Request body must be JSON.");
        }

        using (bodyDoc)
        {
            var root = bodyDoc.RootElement;
            var refreshToken = ResolveRefreshToken(root);
            var userId = ResolveUserId(root);

            if (!string.IsNullOrWhiteSpace(refreshToken))
            {
                await refreshSessionStore.RevokeByRefreshTokenAsync(refreshToken, cancellationToken);
                var response = req.CreateResponse(HttpStatusCode.OK);
                response.Headers.Add(ContentTypeHeader, JsonContentType);
                await response.WriteStringAsync(
                    JsonSerializer.Serialize(new { message = "Refresh sessions revoked." }));
                return response;
            }

            if (!string.IsNullOrWhiteSpace(userId))
            {
                var authenticatedUserId = await tokenResolver.ResolveUserIdAsync(req, cancellationToken);
                if (!string.Equals(authenticatedUserId, userId, StringComparison.Ordinal))
                    return await BuildJsonErrorResponse(req, HttpStatusCode.Forbidden, "Forbidden.");

                await refreshSessionStore.RevokeAllByUserIdAsync(userId, cancellationToken);
                var response = req.CreateResponse(HttpStatusCode.OK);
                response.Headers.Add(ContentTypeHeader, JsonContentType);
                await response.WriteStringAsync(
                    JsonSerializer.Serialize(new { message = "Refresh sessions revoked." }));
                return response;
            }

            return await BuildJsonErrorResponse(req, HttpStatusCode.BadRequest, "Missing refresh_token or user_id.");
        }
    }

    private static object BuildSessionResponse(RefreshSessionStore.SessionTokens session, string userId)
    {
        return new
        {
            access_token = session.AccessToken,
            token_type = RefreshSessionStore.TokenType,
            expires_in = RefreshSessionStore.AccessTokenLifetimeSeconds,
            access_token_expires_at = session.AccessTokenExpiresAt.ToString("O"),
            refresh_token = session.RefreshToken,
            refresh_token_expires_in = RefreshSessionStore.RefreshTokenLifetimeSeconds,
            refresh_token_expires_at = session.RefreshTokenExpiresAt.ToString("O"),
            refresh_token_rotation = RefreshSessionStore.RefreshTokenRotation,
            refresh_token_revoke_on_logout = RefreshSessionStore.RefreshTokenRevokeOnLogout,
            token = session.AccessToken,
            session_token = session.AccessToken,
            app_token = session.AccessToken,
            id_token = session.AccessToken,
            user_id = userId,
            userId = userId,
        };
    }

    private static async Task<HttpResponseData> BuildJsonErrorResponse(
        HttpRequestData req,
        HttpStatusCode statusCode,
        string message)
    {
        var response = req.CreateResponse(statusCode);
        response.Headers.Add(ContentTypeHeader, JsonContentType);
        await response.WriteStringAsync(
            JsonSerializer.Serialize(new { error = message }));
        return response;
    }

    private static string? ResolveRefreshToken(JsonElement root)
    {
        var candidates = new[] { "refresh_token", "refreshToken", "token", "tokenValue" };
        foreach (var candidate in candidates)
        {
            if (root.TryGetProperty(candidate, out var tokenElement) &&
                tokenElement.ValueKind == JsonValueKind.String)
            {
                var value = tokenElement.GetString();
                if (!string.IsNullOrWhiteSpace(value))
                    return value;
            }
        }

        return null;
    }

    private static string? ResolveUserId(JsonElement root)
    {
        var candidates = new[] { "user_id", "userId" };
        foreach (var candidate in candidates)
        {
            if (root.TryGetProperty(candidate, out var tokenElement) &&
                tokenElement.ValueKind == JsonValueKind.String)
            {
                var value = tokenElement.GetString();
                if (!string.IsNullOrWhiteSpace(value))
                    return value;
            }
        }

        return null;
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

