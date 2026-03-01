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
    private readonly string _clientId;
    private readonly IHttpClientFactory _httpClientFactory;

    private JsonWebKeySet? _cachedKeySet;
    private DateTime _keySetExpiresAt = DateTime.MinValue;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public GoogleTokenValidator(IConfiguration configuration, IHttpClientFactory httpClientFactory)
    {
        _clientId = configuration["GoogleAuth:ClientId"]
            ?? throw new InvalidOperationException(
                "Required configuration key 'GoogleAuth__ClientId' is not set.");
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
                ValidIssuers = ["accounts.google.com", "https://accounts.google.com"],
                ValidAudience = _clientId,
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
            var json = await client.GetStringAsync("https://www.googleapis.com/oauth2/v3/certs");
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
