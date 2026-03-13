using System.Collections.Generic;
using System.Linq;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace PluckIt.Functions.Auth;

/// <summary>
/// Validates Google ID tokens (JWTs) obtained from the GIS Sign In With Google flow.
/// Fetches and caches Google's public JWKS; verifies signature, issuer, audience, and expiry.
/// Registered as a singleton so the JWKS cache is shared across all function invocations.
/// </summary>
public sealed class GoogleTokenValidator
{
    private readonly HashSet<string> _allowedClientIds;
    private readonly Uri _jwksUri;
    private readonly string _googleIssuerHost;
    private readonly string _googleIssuerWithScheme;
    private readonly IHttpClientFactory _httpClientFactory;

    private JsonWebKeySet? _cachedKeySet;
    private DateTime _keySetExpiresAt = DateTime.MinValue;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public GoogleTokenValidator(IConfiguration configuration, IHttpClientFactory httpClientFactory)
    {
        var primaryClientId = configuration["GoogleAuth:ClientId"]
            ?? configuration["GoogleAuth__ClientId"]
            ?? configuration["GOOGLE_CLIENT_ID"]
            ?? string.Empty;
        var rawAllowedClientIds = configuration["GoogleAuth:AllowedClientIds"]
            ?? configuration["GoogleAuth__AllowedClientIds"]
            ?? configuration["GOOGLE_ALLOWED_CLIENT_IDS"];
        _allowedClientIds = ParseClientIds(rawAllowedClientIds);
        if (!string.IsNullOrWhiteSpace(primaryClientId))
        {
            _allowedClientIds.Add(primaryClientId);
        }

        if (_allowedClientIds.Count == 0)
        {
            throw new InvalidOperationException(
                "Required configuration for Google token validation is missing. Set one of: "
                + "'GoogleAuth:ClientId'/'GoogleAuth__ClientId'/'GOOGLE_CLIENT_ID' or "
                + "'GoogleAuth:AllowedClientIds'/'GoogleAuth__AllowedClientIds'/'GOOGLE_ALLOWED_CLIENT_IDS'.");
        }
        var jwksUrl = configuration["GoogleAuth:JwksUrl"]
            ?? configuration["GoogleAuth:JwksUri"]
            ?? configuration["GoogleAuth__JwksUrl"]
            ?? configuration["GoogleAuth__JwksUri"]
            ?? configuration["GOOGLE_AUTH_JWKS_URL"]
            ?? configuration["GOOGLE_AUTH_JWKSURI"]
            ?? "https://www.googleapis.com/oauth2/v3/certs";
        if (!Uri.TryCreate(jwksUrl, UriKind.Absolute, out var jwksUri))
            throw new InvalidOperationException(
                "Required configuration key 'GoogleAuth:JwksUrl' (or 'GoogleAuth:JwksUri') is not set or invalid.");
        _jwksUri = jwksUri;
        _googleIssuerHost = configuration["GoogleAuth:IssuerHost"] ??
            configuration["GoogleAuth:Issuer"] ??
            "accounts.google.com";
        var issuerScheme = configuration["GoogleAuth:IssuerScheme"] ?? Uri.UriSchemeHttps;
        _googleIssuerWithScheme = BuildIssuerWithScheme(_googleIssuerHost, issuerScheme);
        _httpClientFactory = httpClientFactory;
    }

    /// <summary>
    /// Validates the given Google ID token.
    /// Returns the <c>sub</c> claim (stable Google user ID) on success,
    /// or <c>null</c> if the token is invalid, expired, or issued for a different audience.
    /// </summary>
    public async Task<string?> ValidateAsync(string idToken)
    {
        try
        {
            var keySet = await GetSigningKeysAsync();
            var handler = new JsonWebTokenHandler();

            var result = await handler.ValidateTokenAsync(idToken, new TokenValidationParameters
            {
                ValidIssuers = [_googleIssuerHost, _googleIssuerWithScheme],
                ValidAudiences = _allowedClientIds,
                IssuerSigningKeys = keySet.Keys,
                ValidateLifetime = true,
                RequireExpirationTime = true,
            });

            if (!result.IsValid) return null;

            result.Claims.TryGetValue("sub", out var sub);
            return sub?.ToString();
        }
        catch
        {
            return null;
        }
    }

    private static string BuildIssuerWithScheme(string issuerHost, string issuerScheme)
    {
        if (Uri.TryCreate(issuerHost, UriKind.Absolute, out var issuerWithScheme))
            return issuerWithScheme.GetLeftPart(UriPartial.Authority).TrimEnd('/');

        if (string.IsNullOrWhiteSpace(issuerScheme))
            issuerScheme = Uri.UriSchemeHttps;

        return new UriBuilder(issuerScheme, issuerHost).Uri.GetLeftPart(UriPartial.Authority).TrimEnd('/');
    }

    private static HashSet<string> ParseClientIds(string? rawClientIds)
    {
        if (string.IsNullOrWhiteSpace(rawClientIds))
            return [];

        var parsed = rawClientIds
            .Split([',', ';'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(id => !string.IsNullOrWhiteSpace(id));

        return new HashSet<string>(parsed, StringComparer.Ordinal);
    }

    // ── JWKS caching ─────────────────────────────────────────────────────────

    private async Task<JsonWebKeySet> GetSigningKeysAsync()
    {
        // Fast path: cache hit (lock-free read)
        if (_cachedKeySet is not null && DateTime.UtcNow < _keySetExpiresAt)
            return _cachedKeySet;

        await _lock.WaitAsync();
        try
        {
            // Double-check inside the lock in case another call already refreshed
            if (_cachedKeySet is not null && DateTime.UtcNow < _keySetExpiresAt)
                return _cachedKeySet;

            var client = _httpClientFactory.CreateClient();
            var json = await client.GetStringAsync(_jwksUri);
            _cachedKeySet = new JsonWebKeySet(json);

            // Google rotates keys infrequently; 6 hours is a safe cache TTL
            _keySetExpiresAt = DateTime.UtcNow.AddHours(6);
            return _cachedKeySet;
        }
        finally
        {
            _lock.Release();
        }
    }
}
