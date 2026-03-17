using Shouldly;
using PluckIt.Functions.Auth;
using PluckIt.Tests.Helpers;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace PluckIt.Tests.Unit.Auth;

/// <summary>Unit tests for <see cref="TokenResolver"/>.</summary>
[Trait("Category", "Unit")]
public sealed class TokenResolverTests
{
    [Fact]
    public async Task ResolveUserIdAsync_ReturnsLocalDevUser_WhenAuthorizationHeaderMissing()
    {
        var resolver = new TokenResolver(
            validateTokenAsync: _ => Task.FromResult<string?>(null),
            resolveSessionUserIdAsync: null,
            localDevUserId: "dev-user-1",
            NullLogger<TokenResolver>.Instance);

        var request = TestRequest.Get("http://localhost/api/test");

        var userId = await resolver.ResolveUserIdAsync(request, CancellationToken.None);

        userId.ShouldBe("dev-user-1");
    }

    [Fact]
    public async Task ResolveUserIdAsync_ReturnsGoogleUserId_WhenValidationSucceeds()
    {
        var resolver = new TokenResolver(
            validateTokenAsync: _ => Task.FromResult<string?>("google-user-1"),
            resolveSessionUserIdAsync: null,
            localDevUserId: "dev-user-1",
            NullLogger<TokenResolver>.Instance);

        var request = TestRequest.Get("http://localhost/api/test");
        request.Headers.Add("Authorization", "Bearer token-abc");

        var userId = await resolver.ResolveUserIdAsync(request, CancellationToken.None);

        userId.ShouldBe("google-user-1");
    }

    [Fact]
    public async Task ResolveUserIdAsync_FallsBackToSession_WhenValidationFails()
    {
        var resolver = new TokenResolver(
            validateTokenAsync: _ => Task.FromResult<string?>(null),
            resolveSessionUserIdAsync: (_, _ct) => Task.FromResult<string?>("session-user-1"),
            localDevUserId: "dev-user-1",
            NullLogger<TokenResolver>.Instance);

        var request = TestRequest.Get("http://localhost/api/test");
        request.Headers.Add("Authorization", "Bearer token-abc");

        var userId = await resolver.ResolveUserIdAsync(request, CancellationToken.None);

        userId.ShouldBe("session-user-1");
    }

    [Fact]
    public async Task ResolveUserIdAsync_ReturnsNull_WhenValidationAndSessionFail()
    {
        var resolver = new TokenResolver(
            validateTokenAsync: _ => Task.FromResult<string?>(null),
            resolveSessionUserIdAsync: (_, _ct) => Task.FromResult<string?>(null),
            localDevUserId: null,
            NullLogger<TokenResolver>.Instance);

        var request = TestRequest.Get("http://localhost/api/test");
        request.Headers.Add("Authorization", "Bearer token-abc");

        var userId = await resolver.ResolveUserIdAsync(request, CancellationToken.None);

        userId.ShouldBeNull();
    }
}
