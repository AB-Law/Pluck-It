using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.Extensions.Configuration;
using PluckIt.Functions.Auth;
using Shouldly;
using Xunit;

namespace PluckIt.Tests.Unit.Auth;

[Trait("Category", "Unit")]
public sealed class GoogleTokenValidatorTests
{
    private sealed class FakeHttpClientFactory(HttpClient client) : IHttpClientFactory
    {
        private readonly HttpClient _client = client;

        public HttpClient CreateClient(string name)
        {
            return _client;
        }

    }

    private sealed class CountingHttpMessageHandler : HttpMessageHandler
    {
        private readonly Func<HttpRequestMessage, HttpResponseMessage> _responseFactory;

        public int SendAsyncCalls { get; private set; }

        public CountingHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> responseFactory)
        {
            _responseFactory = responseFactory;
        }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, System.Threading.CancellationToken cancellationToken)
        {
            SendAsyncCalls++;
            return Task.FromResult(_responseFactory(request));
        }
    }

    private static IConfiguration CreateValidatorConfig(
        string? clientId = "test-google-client-id",
        string? jwksUrl = "https://www.googleapis.com/oauth2/v3/certs")
    {
        var dict = new Dictionary<string, string?>
        {
        };

        if (clientId is not null)
            dict["GoogleAuth:ClientId"] = clientId;
        if (jwksUrl is not null)
            dict["GoogleAuth:JwksUrl"] = jwksUrl;

        return new ConfigurationBuilder()
            .AddInMemoryCollection(dict)
            .Build();
    }

    private static GoogleTokenValidator CreateValidator(
        CountingHttpMessageHandler handler)
    {
        var httpClient = new HttpClient(handler);
        return new GoogleTokenValidator(
            CreateValidatorConfig(),
            new FakeHttpClientFactory(httpClient));
    }

    [Fact]
    public void Constructor_Throws_When_ClientId_Is_Missing()
    {
        var handler = new CountingHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK));
        Should.Throw<InvalidOperationException>(() =>
            new GoogleTokenValidator(
                CreateValidatorConfig(clientId: null),
                new FakeHttpClientFactory(new HttpClient(handler))));
    }

    [Fact]
    public void Constructor_Throws_When_JwksUrl_Is_Missing()
    {
        var handler = new CountingHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK));
        Should.Throw<InvalidOperationException>(() =>
            new GoogleTokenValidator(
                CreateValidatorConfig(jwksUrl: null),
                new FakeHttpClientFactory(new HttpClient(handler))));
    }

    [Fact]
    public async Task ValidateAsync_Returns_Null_For_InvalidToken()
    {
        var handler = new CountingHttpMessageHandler(_ =>
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"keys\":[]}")
            });
        var sut = CreateValidator(handler);

        var subject = await sut.ValidateAsync("not-a.jwt.token");

        subject.ShouldBeNull();
        handler.SendAsyncCalls.ShouldBe(1);
    }

    [Fact]
    public async Task ValidateAsync_UsesCachedJwks_For_SubsequentCalls()
    {
        var handler = new CountingHttpMessageHandler(_ =>
            new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("{\"keys\":[{\"kty\":\"RSA\",\"n\":\"AQAB\",\"e\":\"AQAB\",\"kid\":\"test\"}]}")
            });
        var sut = CreateValidator(handler);

        (await sut.ValidateAsync("not-a.jwt.token")).ShouldBeNull();
        (await sut.ValidateAsync("another.bad.token")).ShouldBeNull();

        handler.SendAsyncCalls.ShouldBe(1);
    }
}
