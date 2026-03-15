using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Azure;
using Azure.Core;
using Moq;
using Moq.Protected;
using PluckIt.Infrastructure;
using PluckIt.Tests.Helpers;
using Shouldly;
using Xunit;

namespace PluckIt.Tests.Unit.Infrastructure;

[Trait("Category", "Unit")]
public sealed class PythonClothingMetadataServiceTests
{
    private static HttpMessageHandler CreateHandler(Func<HttpRequestMessage, HttpResponseMessage> handler)
    {
        var mockHandler = new Mock<HttpMessageHandler>();
        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync((HttpRequestMessage request, CancellationToken token) => handler(request));
        return mockHandler.Object;
    }

    [Fact]
    public async Task ExtractMetadataAsync_ReturnsParsedMetadataOnSuccess()
    {
        string? requestApiKey = null;
        string? requestAuthHeader = null;
        var payload = new
        {
            brand = "Acme",
            category = "Outerwear",
            tags = new[] { "cotton", "minimal" },
            colours = new[] { new { name = "Navy", hex = "#001122" } },
        };

        var handler = CreateHandler(request =>
        {
            requestApiKey = request.Headers.GetValues("X-API-Key").FirstOrDefault();
            requestAuthHeader = request.Headers.Authorization?.ToString();
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json")
            };
        });

        var factory = TestFactory.CreateHttpClientFactory(handler);
        var sut = new PythonClothingMetadataService(
            factory,
            "https://processor/api/extract-clothing-metadata",
            "api-key",
            apiKey: "test-key",
            logger: TestFactory.NullLogger<PythonClothingMetadataService>());

        var actual = await sut.ExtractMetadataAsync(BinaryData.FromString("bytes"), "image/jpeg");

        actual.Brand.ShouldBe("Acme");
        actual.Category.ShouldBe("Outerwear");
        actual.Tags.ShouldBe(["cotton", "minimal"]);
        actual.Colours.Single().Name.ShouldBe("Navy");
        actual.Colours.Single().Hex.ShouldBe("#001122");
        requestApiKey.ShouldBe("test-key");
        requestAuthHeader.ShouldBeNull();
    }

    [Fact]
    public async Task ExtractMetadataAsync_ReturnsEmptyOnHttpFailure()
    {
        var handler = CreateHandler(_ => new HttpResponseMessage(HttpStatusCode.InternalServerError));
        var sut = new PythonClothingMetadataService(
            TestFactory.CreateHttpClientFactory(handler),
            "https://processor/api/extract-clothing-metadata",
            "api-key",
            apiKey: "test-key",
            logger: TestFactory.NullLogger<PythonClothingMetadataService>());

        var actual = await sut.ExtractMetadataAsync(BinaryData.FromString("bytes"), "image/jpeg");

        actual.Brand.ShouldBeNull();
        actual.Category.ShouldBeNull();
        actual.Tags.ShouldBeEmpty();
        actual.Colours.ShouldBeEmpty();
    }

    [Fact]
    public async Task ExtractMetadataAsync_ReturnsEmptyOnInvalidPayload()
    {
        var handler = CreateHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("not-json", Encoding.UTF8, "application/json")
        });
        var sut = new PythonClothingMetadataService(
            TestFactory.CreateHttpClientFactory(handler),
            "https://processor/api/extract-clothing-metadata",
            "api-key",
            apiKey: "test-key",
            logger: TestFactory.NullLogger<PythonClothingMetadataService>());

        var actual = await sut.ExtractMetadataAsync(BinaryData.FromString("bytes"), "image/jpeg");

        actual.Brand.ShouldBeNull();
        actual.Category.ShouldBeNull();
        actual.Tags.ShouldBeEmpty();
        actual.Colours.ShouldBeEmpty();
    }

    [Fact]
    public async Task ExtractMetadataAsync_AddsAuthorizationHeaderForAzureAdMode()
    {
        string? authorization = null;
        var handler = CreateHandler(request =>
        {
            authorization = request.Headers.Authorization?.ToString();
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(new { brand = "A", category = (string?)null, tags = Array.Empty<string>(), colours = Array.Empty<object>() }),
                    Encoding.UTF8,
                    "application/json")
            };
        });

        var sut = new PythonClothingMetadataService(
            TestFactory.CreateHttpClientFactory(handler),
            "https://processor/api/extract-clothing-metadata",
            "azuread",
            apiKey: "ignored",
            azureAdScope: "api://metadata/.default",
            logger: TestFactory.NullLogger<PythonClothingMetadataService>(),
            tokenCredential: new StaticTokenCredential());

        await sut.ExtractMetadataAsync(BinaryData.FromString("bytes"), "image/jpeg");

        authorization.ShouldBe("Bearer mocked-metadata-token");
    }

    private sealed class StaticTokenCredential : TokenCredential
    {
        public override AccessToken GetToken(TokenRequestContext requestContext, CancellationToken cancellationToken) =>
            new("mocked-metadata-token", DateTimeOffset.UtcNow.AddMinutes(5));

        public override ValueTask<AccessToken> GetTokenAsync(
            TokenRequestContext requestContext,
            CancellationToken cancellationToken)
            => new(GetToken(requestContext, cancellationToken));
    }
}

