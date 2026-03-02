using Microsoft.Extensions.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Logging;
using Moq;
using PluckIt.Functions.Auth;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace PluckIt.Tests.Helpers;

/// <summary>
/// Factory methods for building test dependencies that are concrete classes
/// (cannot be mocked directly).
/// </summary>
public static class TestFactory
{
    /// <summary>
    /// Creates a <see cref="GoogleTokenValidator"/> configured for tests.
    /// The validator is never called during tests because auth is bypassed via
    /// <c>Local:DevUserId</c>; this factory just satisfies the DI constructor.
    /// </summary>
    public static GoogleTokenValidator CreateTokenValidator(IConfiguration? config = null)
    {
        var cfg = config ?? TestConfiguration.WithDevUser();
        var httpFactory = new Mock<IHttpClientFactory>();
        httpFactory
            .Setup(f => f.CreateClient(It.IsAny<string>()))
            .Returns(new HttpClient());
        return new GoogleTokenValidator(cfg, httpFactory.Object);
    }

    /// <summary>
    /// Creates a minimal <see cref="IHttpClientFactory"/> mock that returns a
    /// pre-configured <see cref="HttpClient"/> with an optional <see cref="HttpMessageHandler"/>.
    /// </summary>
    public static IHttpClientFactory CreateHttpClientFactory(
        HttpMessageHandler? handler = null,
        string clientName = "")
    {
        var mock = new Mock<IHttpClientFactory>();
        var client = handler is not null
            ? new HttpClient(handler) { BaseAddress = new Uri("http://localhost") }
            : new HttpClient { BaseAddress = new Uri("http://localhost") };

        mock.Setup(f => f.CreateClient(It.IsAny<string>())).Returns(client);
        return mock.Object;
    }

    /// <summary>Creates a null-logger (discards all messages) for a given type.</summary>
    public static ILogger<T> NullLogger<T>()
        => Microsoft.Extensions.Logging.Abstractions.NullLogger<T>.Instance;
}
