using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace PluckIt.Functions.Auth;

/// <summary>
/// Resolves a user identifier from an incoming request using bearer token credentials.
/// </summary>
public interface ITokenResolver
{
    /// <summary>
    /// Attempts to resolve the authenticated user id from the request's Authorization header.
    /// Returns <c>null</c> when no valid identity can be extracted.
    /// </summary>
    Task<string?> ResolveUserIdAsync(HttpRequestData request, CancellationToken cancellationToken);
}

/// <summary>
/// Default implementation for resolving user ids from Google bearer tokens and refresh sessions.
/// Falls back to <c>Local:DevUserId</c> when no Authorization header is present.
/// </summary>
public sealed class TokenResolver : ITokenResolver
{
    private const int TokenPrefixLength = 20;

    private readonly Func<string, Task<string?>> _validateToken;
    private readonly Func<string, CancellationToken, Task<string?>>? _resolveSessionUserId;
    private readonly string? _localDevUserId;
    private readonly ILogger<TokenResolver> _logger;

    /// <summary>
    /// Initializes a new token resolver from concrete runtime dependencies.
    /// </summary>
    public TokenResolver(
        GoogleTokenValidator tokenValidator,
        IConfiguration configuration,
        ILogger<TokenResolver> logger,
        RefreshSessionStore? refreshSessionStore = null)
        : this(
            tokenValidator.ValidateAsync,
            refreshSessionStore is null ? null : refreshSessionStore.ResolveUserIdFromAccessTokenAsync,
            configuration["Local:DevUserId"],
            logger)
    {
    }

    /// <summary>
    /// Test-oriented constructor that accepts delegates for deterministic validation and session resolution.
    /// </summary>
    public TokenResolver(
        Func<string, Task<string?>> validateTokenAsync,
        Func<string, CancellationToken, Task<string?>>? resolveSessionUserIdAsync,
        string? localDevUserId,
        ILogger<TokenResolver> logger)
    {
        _validateToken = validateTokenAsync ?? throw new ArgumentNullException(nameof(validateTokenAsync));
        _resolveSessionUserId = resolveSessionUserIdAsync;
        _localDevUserId = localDevUserId;
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    /// <summary>
    /// Resolves a user id from a bearer token in the Authorization header, with graceful fallback.
    /// </summary>
    public async Task<string?> ResolveUserIdAsync(HttpRequestData request, CancellationToken cancellationToken)
    {
        if (!TryGetBearerToken(request, out var token))
        {
            return _localDevUserId;
        }

        string? userId = null;
        try
        {
            userId = await _validateToken(token);
            if (!string.IsNullOrWhiteSpace(userId))
            {
                return userId;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "Failed to validate access token. tokenPrefix={TokenPrefix}",
                TruncateTokenPrefix(token));
        }

        if (_resolveSessionUserId is null)
            return null;

        try
        {
            return await _resolveSessionUserId(token, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "Failed to resolve user id from session token. tokenPrefix={TokenPrefix}",
                TruncateTokenPrefix(token));
            return null;
        }
    }

    private static bool TryGetBearerToken(HttpRequestData request, out string token)
    {
        token = string.Empty;
        if (!request.Headers.TryGetValues("Authorization", out var authHeaders))
            return false;

        var header = authHeaders.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(header) || !header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return false;

        token = header["Bearer ".Length..].Trim();
        return !string.IsNullOrWhiteSpace(token);
    }

    private static string TruncateTokenPrefix(string token)
    {
        if (string.IsNullOrEmpty(token))
            return "<empty>";
        return token.Length <= TokenPrefixLength
            ? token
            : $"{token[..TokenPrefixLength]}...";
    }
}
