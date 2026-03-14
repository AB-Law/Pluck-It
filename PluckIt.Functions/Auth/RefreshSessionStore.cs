using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Azure.Cosmos;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace PluckIt.Functions.Auth;

/// <summary>
/// Persists and rotates auth session tokens in Cosmos DB.
/// </summary>
public sealed class RefreshSessionStore(CosmosClient cosmosClient, IConfiguration configuration, ILogger<RefreshSessionStore> logger)
{
    private const string AccessTokenPrefix = "at-";
    private const string RefreshTokenPrefix = "rt-";
    private const string RefreshTokensContainerDefault = "RefreshTokens";

    public const string TokenType = "Bearer";
    public const string RefreshTokenRotation = "single-use";
    public const bool RefreshTokenRevokeOnLogout = true;
    private static readonly TimeSpan AccessTokenLifetime = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan RefreshTokenLifetime = TimeSpan.FromDays(30);

    public static long AccessTokenLifetimeSeconds => (long)AccessTokenLifetime.TotalSeconds;
    public static long RefreshTokenLifetimeSeconds => (long)RefreshTokenLifetime.TotalSeconds;

    private readonly Container _container =
        cosmosClient.GetContainer(
            configuration["Cosmos:Database"] ?? "PluckIt",
            configuration["Cosmos:RefreshTokensContainer"] ?? RefreshTokensContainerDefault);
    private readonly ILogger<RefreshSessionStore> _logger = logger;

    public sealed record SessionTokens(
        string AccessToken,
        string RefreshToken,
        DateTimeOffset AccessTokenExpiresAt,
        DateTimeOffset RefreshTokenExpiresAt,
        string UserId);

    public async Task<SessionTokens?> CreateSessionAsync(string userId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(userId))
            return null;

        var issuedAt = DateTimeOffset.UtcNow;
        var accessToken = GenerateAccessToken();
        var refreshToken = GenerateRefreshToken();
        var accessTokenExpiresAt = issuedAt + AccessTokenLifetime;
        var refreshTokenExpiresAt = issuedAt + RefreshTokenLifetime;

        var session = BuildSessionRecord(
            userId,
            accessToken,
            refreshToken,
            issuedAt,
            accessTokenExpiresAt,
            refreshTokenExpiresAt);
        await PersistSessionAsync(session, cancellationToken);

        return new SessionTokens(accessToken, refreshToken, accessTokenExpiresAt, refreshTokenExpiresAt, userId);
    }

    public async Task<SessionTokens?> RotateRefreshSessionAsync(string refreshToken, CancellationToken cancellationToken)
    {
        var existing = await GetSessionByRefreshTokenAsync(refreshToken, cancellationToken);
        if (existing is null)
            return null;
        if (string.IsNullOrWhiteSpace(existing.UserId))
            return null;

        var now = DateTimeOffset.UtcNow;
        if (existing.Revoked || existing.RefreshTokenExpiresAt <= now)
        {
            if (!existing.Revoked)
            {
                existing.Revoked = true;
                await PersistSessionAsync(existing, cancellationToken);
            }
            return null;
        }

        var newAccessToken = GenerateAccessToken();
        var newRefreshToken = GenerateRefreshToken();
        var newSession = BuildSessionRecord(
            existing.UserId,
            newAccessToken,
            newRefreshToken,
            now,
            now + AccessTokenLifetime,
            now + RefreshTokenLifetime,
            previousRefreshTokenHash: HashToken(refreshToken));
        existing.Revoked = true;
        existing.ReplacedByRefreshTokenHash = newSession.RefreshTokenHash;

        await PersistSessionAsync(existing, cancellationToken);
        await PersistSessionAsync(newSession, cancellationToken);

        return new SessionTokens(newAccessToken, newRefreshToken, newSession.AccessTokenExpiresAt, newSession.RefreshTokenExpiresAt, existing.UserId);
    }

    public async Task<string?> ResolveUserIdFromAccessTokenAsync(string accessToken, CancellationToken cancellationToken)
    {
        var session = await GetSessionByAccessTokenAsync(accessToken, cancellationToken);
        if (session is null)
            return null;

        if (session.Revoked || session.AccessTokenExpiresAt <= DateTimeOffset.UtcNow)
        {
            if (!session.Revoked)
            {
                session.Revoked = true;
                await PersistSessionAsync(session, cancellationToken);
            }
            return null;
        }

        return session.UserId;
    }

    public async Task<bool> RevokeByRefreshTokenAsync(string refreshToken, CancellationToken cancellationToken)
    {
        var session = await GetSessionByRefreshTokenAsync(refreshToken, cancellationToken);
        if (session is null || string.IsNullOrWhiteSpace(session.UserId))
            return false;

        return await RevokeAllByUserIdAsync(session.UserId, cancellationToken) > 0;
    }

    public async Task<int> RevokeAllByUserIdAsync(string userId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(userId))
            return 0;

        var sessions = await GetSessionsByUserIdAsync(userId, cancellationToken);
        if (sessions.Count == 0)
            return 0;

        var revokedAt = DateTimeOffset.UtcNow;
        var revokedCount = 0;
        foreach (var session in sessions)
        {
            if (session.Revoked)
                continue;

            session.Revoked = true;
            session.RevokedAt = revokedAt;
            await PersistSessionAsync(session, cancellationToken);
            revokedCount++;
        }

        return revokedCount;
    }

    private static string GenerateAccessToken()
    {
        return $"{AccessTokenPrefix}{Guid.NewGuid():N}";
    }

    private static string GenerateRefreshToken()
    {
        return $"{RefreshTokenPrefix}{Guid.NewGuid():N}";
    }

    private static string HashToken(string rawToken)
    {
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawToken))).ToLowerInvariant();
    }

    private RefreshSessionRecord BuildSessionRecord(
        string userId,
        string accessToken,
        string refreshToken,
        DateTimeOffset issuedAt,
        DateTimeOffset accessTokenExpiresAt,
        DateTimeOffset refreshTokenExpiresAt,
        string? previousRefreshTokenHash = null)
    {
        return new RefreshSessionRecord
        {
            Id = Guid.NewGuid().ToString("N"),
            UserId = userId,
            AccessToken = accessToken,
            AccessTokenHash = HashToken(accessToken),
            AccessTokenExpiresAt = accessTokenExpiresAt,
            RefreshToken = refreshToken,
            RefreshTokenHash = HashToken(refreshToken),
            RefreshTokenExpiresAt = refreshTokenExpiresAt,
            IssuedAt = issuedAt,
            PreviousRefreshTokenHash = previousRefreshTokenHash,
            Revoked = false,
            RevokedOnLogout = RefreshTokenRevokeOnLogout,
            TokenRotation = RefreshTokenRotation,
        };
    }

    private async Task<RefreshSessionRecord?> GetSessionByAccessTokenAsync(string accessToken, CancellationToken cancellationToken)
    {
        return await GetSessionByHashAsync(HashToken(accessToken), "accessTokenHash", cancellationToken);
    }

    private async Task<RefreshSessionRecord?> GetSessionByRefreshTokenAsync(string refreshToken, CancellationToken cancellationToken)
    {
        return await GetSessionByHashAsync(HashToken(refreshToken), "refreshTokenHash", cancellationToken);
    }

    private async Task<RefreshSessionRecord?> GetSessionByHashAsync(string tokenHash, string hashField, CancellationToken cancellationToken)
    {
        var queryDefinition = new QueryDefinition($"SELECT * FROM c WHERE c.{hashField} = @tokenHash")
            .WithParameter("@tokenHash", tokenHash);
        var iterator = _container.GetItemQueryIterator<RefreshSessionRecord>(queryDefinition);

        while (iterator.HasMoreResults)
        {
            var response = await iterator.ReadNextAsync(cancellationToken);
            var found = response.FirstOrDefault();
            if (found is not null)
                return found;
        }

        return null;
    }

    private async Task<List<RefreshSessionRecord>> GetSessionsByUserIdAsync(string userId, CancellationToken cancellationToken)
    {
        var queryDefinition = new QueryDefinition(
            "SELECT * FROM c WHERE c.userId = @userId AND (NOT IS_DEFINED(c.revoked) OR c.revoked = false)"
        ).WithParameter("@userId", userId);

        var iterator = _container.GetItemQueryIterator<RefreshSessionRecord>(
            queryDefinition);

        var results = new List<RefreshSessionRecord>();
        while (iterator.HasMoreResults)
        {
            var response = await iterator.ReadNextAsync(cancellationToken);
            results.AddRange(response);
        }

        return results;
    }

    private async Task PersistSessionAsync(RefreshSessionRecord session, CancellationToken cancellationToken)
    {
        try
        {
            _ = await _container.UpsertItemAsync(session, new PartitionKey(session.UserId), cancellationToken: cancellationToken);
            _logger.LogDebug(
                "Persisted refresh session: userId={UserId} accessTokenPrefix={AccessPrefix} refreshTokenPrefix={RefreshPrefix}",
                session.UserId,
                $"{AccessTokenPrefix}***",
                $"{RefreshTokenPrefix}***");
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException(
                $"Failed to persist refresh session document for userId={session.UserId}, sessionId={session.Id}. Token values were redacted.",
                ex);
        }
    }

    private sealed class RefreshSessionRecord
    {
        public string Id { get; set; } = string.Empty;
        public string UserId { get; set; } = string.Empty;
        public string AccessToken { get; set; } = string.Empty;
        public string AccessTokenHash { get; set; } = string.Empty;
        public DateTimeOffset AccessTokenExpiresAt { get; set; }
        public string RefreshToken { get; set; } = string.Empty;
        public string RefreshTokenHash { get; set; } = string.Empty;
        public DateTimeOffset RefreshTokenExpiresAt { get; set; }
        public DateTimeOffset IssuedAt { get; set; }
        public bool Revoked { get; set; }
        public DateTimeOffset? RevokedAt { get; set; }
        public string? PreviousRefreshTokenHash { get; set; }
        public string? ReplacedByRefreshTokenHash { get; set; }
        public bool RevokedOnLogout { get; set; }
        public string TokenRotation { get; set; } = RefreshTokenRotation;
    }
}
