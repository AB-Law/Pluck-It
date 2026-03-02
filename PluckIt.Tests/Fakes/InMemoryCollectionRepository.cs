using PluckIt.Core;

namespace PluckIt.Tests.Fakes;

/// <summary>
/// In-memory <see cref="ICollectionRepository"/> for unit tests.
/// </summary>
public sealed class InMemoryCollectionRepository : ICollectionRepository
{
    private readonly List<Collection> _store = [];

    public InMemoryCollectionRepository WithCollections(params Collection[] collections)
    {
        _store.AddRange(collections);
        return this;
    }

    public Task<IReadOnlyList<Collection>> GetByOwnerAsync(string ownerId, CancellationToken ct = default)
    {
        IReadOnlyList<Collection> result = _store
            .Where(c => c.OwnerId == ownerId)
            .ToList();
        return Task.FromResult(result);
    }

    public Task<IReadOnlyList<Collection>> GetJoinedByUserAsync(string userId, CancellationToken ct = default)
    {
        IReadOnlyList<Collection> result = _store
            .Where(c => c.MemberUserIds.Contains(userId))
            .ToList();
        return Task.FromResult(result);
    }

    public Task<Collection?> GetByIdAsync(string id, string ownerId, CancellationToken ct = default)
    {
        var col = _store.FirstOrDefault(c =>
            c.Id == id && c.OwnerId == ownerId);
        return Task.FromResult(col);
    }

    public Task<Collection?> FindByIdAsync(string id, CancellationToken ct = default)
    {
        var col = _store.FirstOrDefault(c => c.Id == id);
        return Task.FromResult(col);
    }

    public Task<Collection> UpsertAsync(Collection collection, CancellationToken ct = default)
    {
        var idx = _store.FindIndex(c => c.Id == collection.Id);
        if (idx >= 0) _store[idx] = collection;
        else          _store.Add(collection);
        return Task.FromResult(collection);
    }

    public Task DeleteAsync(string id, string ownerId, CancellationToken ct = default)
    {
        _store.RemoveAll(c => c.Id == id && c.OwnerId == ownerId);
        return Task.CompletedTask;
    }

    public Task AddMemberAsync(string collectionId, string ownerId, string userId, CancellationToken ct = default)
    {
        var col = _store.First(c => c.Id == collectionId && c.OwnerId == ownerId);
        if (!col.MemberUserIds.Contains(userId))
            col.MemberUserIds = col.MemberUserIds.Append(userId).ToArray();
        return Task.CompletedTask;
    }

    public Task RemoveMemberAsync(string collectionId, string ownerId, string userId, CancellationToken ct = default)
    {
        var col = _store.First(c => c.Id == collectionId && c.OwnerId == ownerId);
        col.MemberUserIds = col.MemberUserIds.Where(m => m != userId).ToArray();
        return Task.CompletedTask;
    }

    public Task AddItemAsync(string collectionId, string ownerId, string itemId, CancellationToken ct = default)
    {
        var col = _store.First(c => c.Id == collectionId && c.OwnerId == ownerId);
        if (!col.ClothingItemIds.Contains(itemId))
            col.ClothingItemIds = col.ClothingItemIds.Append(itemId).ToArray();
        return Task.CompletedTask;
    }

    public Task RemoveItemAsync(string collectionId, string ownerId, string itemId, CancellationToken ct = default)
    {
        var col = _store.First(c => c.Id == collectionId && c.OwnerId == ownerId);
        col.ClothingItemIds = col.ClothingItemIds.Where(i => i != itemId).ToArray();
        return Task.CompletedTask;
    }

    public IReadOnlyList<Collection> AllCollections => _store.AsReadOnly();
}
