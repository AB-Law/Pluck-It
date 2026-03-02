using PluckIt.Core;

namespace PluckIt.Tests.Fakes;

/// <summary>In-memory <see cref="IUserProfileRepository"/> for unit tests.</summary>
public sealed class InMemoryUserProfileRepository : IUserProfileRepository
{
    private readonly Dictionary<string, UserProfile> _store = [];

    public InMemoryUserProfileRepository WithProfile(UserProfile profile)
    {
        _store[profile.Id] = profile;
        return this;
    }

    public Task<UserProfile?> GetAsync(string userId, CancellationToken cancellationToken = default)
    {
        _store.TryGetValue(userId, out var profile);
        return Task.FromResult(profile);
    }

    public Task UpsertAsync(UserProfile profile, CancellationToken cancellationToken = default)
    {
        _store[profile.Id] = profile;
        return Task.CompletedTask;
    }

    public IReadOnlyDictionary<string, UserProfile> All => _store;
}
