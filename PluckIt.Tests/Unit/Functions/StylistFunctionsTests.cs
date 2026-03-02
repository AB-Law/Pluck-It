using System.Net;
using FluentAssertions;
using PluckIt.Core;
using PluckIt.Functions.Functions;
using PluckIt.Tests.Fakes;
using PluckIt.Tests.Helpers;
using Xunit;

namespace PluckIt.Tests.Unit.Functions;

/// <summary>Unit tests for <see cref="StylistFunctions"/>.</summary>
[Trait("Category", "Unit")]
public sealed class StylistFunctionsTests
{
    private const string UserId = "test-user-001";

    private static ClothingItem MakeItem(string id) => new()
    {
        Id       = id,
        UserId   = UserId,
        ImageUrl = $"https://blob.example.com/{id}.png",
        Category = "Tops",
        Tags     = ["casual"]
    };

    private StylistFunctions CreateSut(
        InMemoryWardrobeRepository? repo    = null,
        FakeStylistService?         stylist = null)
    {
        var cfg = TestConfiguration.WithDevUser(UserId);
        return new StylistFunctions(
            repo    ?? new InMemoryWardrobeRepository(),
            stylist ?? new FakeStylistService(),
            cfg,
            TestFactory.CreateTokenValidator(cfg),
            TestFactory.NullLogger<StylistFunctions>());
    }

    [Fact]
    public async Task GetRecommendations_ReturnsRecommendations()
    {
        var repo = new InMemoryWardrobeRepository()
            .WithItems(MakeItem("a"), MakeItem("b"));
        var sut  = CreateSut(repo);

        var result = await sut.GetRecommendations(
            TestRequest.Post("http://localhost/api/stylist/recommendations", "{}"),
            CancellationToken.None) as TestHttpResponseData;

        result!.StatusCode.Should().Be(HttpStatusCode.OK);
        result.ReadBodyAsString().Should().Contain("Casual Monday");
    }

    [Fact]
    public async Task GetRecommendations_Returns400WhenWardrobeIsEmpty()
    {
        // Empty wardrobe — stylist call should be blocked before calling the LLM
        var result = await CreateSut().GetRecommendations(
            TestRequest.Post("http://localhost/api/stylist/recommendations", "{}"),
            CancellationToken.None);

        result.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task GetRecommendations_Returns401WhenUnauthenticated()
    {
        var cfg = TestConfiguration.Unauthenticated();
        var sut = new StylistFunctions(
            new InMemoryWardrobeRepository(),
            new FakeStylistService(),
            cfg,
            TestFactory.CreateTokenValidator(cfg),
            TestFactory.NullLogger<StylistFunctions>());

        var result = await sut.GetRecommendations(
            TestRequest.Post("http://localhost/api/stylist/recommendations", "{}"),
            CancellationToken.None);

        result.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetRecommendations_CallsStylistOnce()
    {
        var repo    = new InMemoryWardrobeRepository().WithItems(MakeItem("x"));
        var stylist = new FakeStylistService();
        var sut     = CreateSut(repo, stylist);

        await sut.GetRecommendations(
            TestRequest.Post("http://localhost/api/stylist/recommendations", "{}"),
            CancellationToken.None);

        stylist.CallCount.Should().Be(1);
    }
}
