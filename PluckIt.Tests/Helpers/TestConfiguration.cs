using Microsoft.Extensions.Configuration;

namespace PluckIt.Tests.Helpers;

/// <summary>
/// Convenience factory for <see cref="IConfiguration"/> instances used in tests.
/// </summary>
public static class TestConfiguration
{
    /// <summary>
    /// Returns a configuration with <c>Local:DevUserId</c> set so that functions
    /// bypass Google token validation entirely.
    /// Also provides a stub <c>GoogleAuth:ClientId</c> so <see cref="PluckIt.Functions.Auth.GoogleTokenValidator"/>
    /// can be constructed without throwing.
    /// </summary>
    public static IConfiguration WithDevUser(
        string userId = "test-user-001",
        Dictionary<string, string?>? extra = null)
    {
        var dict = new Dictionary<string, string?>
        {
            ["Local:DevUserId"]    = userId,
            ["GoogleAuth:ClientId"] = "test-google-client-id",
            ["GoogleAuth:JwksUrl"] = "https://www.googleapis.com/oauth2/v3/certs"
        };
        if (extra is not null)
            foreach (var (k, v) in extra)
                dict[k] = v;

        return new ConfigurationBuilder()
            .AddInMemoryCollection(dict)
            .Build();
    }

    /// <summary>Returns a configuration with no <c>Local:DevUserId</c> — simulates unauthenticated.</summary>
    public static IConfiguration Unauthenticated()
        => new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["GoogleAuth:ClientId"] = "test-google-client-id",
                ["GoogleAuth:JwksUrl"] = "https://www.googleapis.com/oauth2/v3/certs"
            })
            .Build();
}
