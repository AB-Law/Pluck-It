using System.Net;
using System.Text.Json;
using FluentAssertions;
using PluckIt.Core;
using PluckIt.Functions.Functions;
using PluckIt.Functions.Serialization;
using PluckIt.Tests.Fakes;
using PluckIt.Tests.Helpers;
using Xunit;

namespace PluckIt.Tests.Unit.Functions;

/// <summary>Unit tests for <see cref="UserProfileFunctions"/>.</summary>
[Trait("Category", "Unit")]
public sealed class UserProfileFunctionsTests
{
    private const string UserId = "test-user-001";

    private UserProfileFunctions CreateSut(InMemoryUserProfileRepository? repo = null)
    {
        var cfg = TestConfiguration.WithDevUser(UserId);
        return new UserProfileFunctions(
            repo ?? new InMemoryUserProfileRepository(),
            cfg,
            TestFactory.CreateTokenValidator(cfg));
    }

    // ── GetProfile ───────────────────────────────────────────────────────────

    [Fact]
    public async Task GetProfile_ReturnsStoredProfile()
    {
        var profile = new UserProfile { Id = UserId, CurrencyCode = "GBP" };
        var repo    = new InMemoryUserProfileRepository().WithProfile(profile);
        var sut     = CreateSut(repo);

        var result = await sut.GetProfile(
            TestRequest.Get("http://localhost/api/profile"), CancellationToken.None)
            as TestHttpResponseData;

        result!.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = JsonSerializer.Deserialize<UserProfile>(result.ReadBodyAsString(),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        body!.CurrencyCode.Should().Be("GBP");
    }

    [Fact]
    public async Task GetProfile_ReturnsDefaultProfileWhenNotFound()
    {
        // No profile seeded — should return a default, not 404
        var result = await CreateSut().GetProfile(
            TestRequest.Get("http://localhost/api/profile"), CancellationToken.None)
            as TestHttpResponseData;

        result!.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = JsonSerializer.Deserialize<UserProfile>(result.ReadBodyAsString(),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        body!.Id.Should().Be(UserId);
        body.CurrencyCode.Should().Be("USD"); // default value
    }

    [Fact]
    public async Task GetProfile_Returns401WhenUnauthenticated()
    {
        var cfg = TestConfiguration.Unauthenticated();
        var sut = new UserProfileFunctions(
            new InMemoryUserProfileRepository(),
            cfg,
            TestFactory.CreateTokenValidator(cfg));

        var result = await sut.GetProfile(
            TestRequest.Get("http://localhost/api/profile"), CancellationToken.None);

        result.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ── UpdateProfile ────────────────────────────────────────────────────────

    [Fact]
    public async Task UpdateProfile_UpsertWithForcedUserId()
    {
        var repo    = new InMemoryUserProfileRepository();
        var sut     = CreateSut(repo);
        var profile = new UserProfile
        {
            Id           = "attacker-id", // should be overridden
            CurrencyCode = "EUR",
            StylePreferences = ["minimalist"]
        };
        var json = JsonSerializer.Serialize(profile, PluckItJsonContext.Default.UserProfile);

        var result = await sut.UpdateProfile(
            TestRequest.Put("http://localhost/api/profile", json), CancellationToken.None)
            as TestHttpResponseData;

        result!.StatusCode.Should().Be(HttpStatusCode.NoContent);
        repo.All[UserId].Id.Should().Be(UserId);
        repo.All[UserId].CurrencyCode.Should().Be("EUR");
    }

    [Fact]
    public async Task UpdateProfile_Returns400ForInvalidBody()
    {
        var result = await CreateSut().UpdateProfile(
            TestRequest.Put("http://localhost/api/profile", "not-json"), CancellationToken.None);

        result.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }
}
