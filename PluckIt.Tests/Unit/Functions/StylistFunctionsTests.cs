using System.Net;
using System;
using Shouldly;
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

    private static StylistFunctions CreateSut(
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

        result!.StatusCode.ShouldBe(HttpStatusCode.OK);
        result.ReadBodyAsString().ShouldContain("Casual Monday");
    }

    [Fact]
    public async Task GetRecommendations_Returns400WhenWardrobeIsEmpty()
    {
        // Empty wardrobe — stylist call should be blocked before calling the LLM
        var result = await CreateSut().GetRecommendations(
            TestRequest.Post("http://localhost/api/stylist/recommendations", "{}"),
            CancellationToken.None);

        result.StatusCode.ShouldBe(HttpStatusCode.BadRequest);
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

        result.StatusCode.ShouldBe(HttpStatusCode.Unauthorized);
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

        stylist.CallCount.ShouldBe(1);
    }

    [Fact]
    public async Task GetRecommendations_AppliesQueryKnobsFromRequest()
    {
        var keep = MakeItem("keep");
        keep.WearCount = 3;
        keep.DateAdded = DateTimeOffset.UtcNow;
        keep.Category = "Tops";
        var skip = MakeItem("skip");
        skip.WearCount = 1;
        skip.DateAdded = DateTimeOffset.UtcNow.AddDays(-2);
        skip.Category = "Tops";
        var bottom = MakeItem("bottom");
        bottom.WearCount = 5;
        bottom.DateAdded = DateTimeOffset.UtcNow.AddDays(-1);
        bottom.Category = "Bottoms";

        var repo = new InMemoryWardrobeRepository().WithItems(skip, keep, bottom);
        var stylist = new FakeStylistService();
        var sut = CreateSut(repo, stylist);
        var requestBody = """
            { "category":"Tops", "minWears":2, "maxWears":6, "pageSize":1 }
            """;

        var result = await sut.GetRecommendations(
            TestRequest.Post("http://localhost/api/stylist/recommendations", requestBody),
            CancellationToken.None) as TestHttpResponseData;

        result!.StatusCode.ShouldBe(HttpStatusCode.OK);
        stylist.CallCount.ShouldBe(1);
        stylist.LastRequest.ShouldNotBeNull();
        stylist.LastRequest!.PageSize.ShouldBe(1);
        stylist.LastRequest!.Category.ShouldBe("Tops");
        stylist.LastRequest!.MinWears.ShouldBe(2);
        stylist.LastRequest!.MaxWears.ShouldBe(6);
        stylist.LastWardrobe.ShouldNotBeNull();
        stylist.LastWardrobe!.Count.ShouldBe(1);
        stylist.LastWardrobe![0].Category.ShouldBe("Tops");
        stylist.LastWardrobe![0].WearCount.ShouldBeGreaterThanOrEqualTo(2);
    }
}
