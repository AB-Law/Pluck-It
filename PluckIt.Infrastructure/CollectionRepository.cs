using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.Cosmos;
using PluckIt.Core;

namespace PluckIt.Infrastructure;

public class CollectionRepository : ICollectionRepository
{
    private readonly CosmosClient _client;
    private readonly string _databaseName;
    private readonly string _containerName;

    public CollectionRepository(CosmosClient client, string databaseName, string containerName)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
        _databaseName = databaseName ?? throw new ArgumentNullException(nameof(databaseName));
        _containerName = containerName ?? throw new ArgumentNullException(nameof(containerName));
    }

    private Container Container => _client.GetContainer(_databaseName, _containerName);

    public async Task<IReadOnlyList<Collection>> GetByOwnerAsync(string ownerId, CancellationToken ct = default)
    {
        var query = new QueryDefinition("SELECT * FROM c WHERE c.ownerId = @ownerId ORDER BY c.createdAt DESC")
            .WithParameter("@ownerId", ownerId);

        var iterator = Container.GetItemQueryIterator<Collection>(
            query,
            requestOptions: new QueryRequestOptions { PartitionKey = new PartitionKey(ownerId) });

        var results = new List<Collection>();
        while (iterator.HasMoreResults)
        {
            var page = await iterator.ReadNextAsync(ct);
            results.AddRange(page);
        }
        return results;
    }

    public async Task<IReadOnlyList<Collection>> GetJoinedByUserAsync(string userId, CancellationToken ct = default)
    {
        // Cross-partition query: find public collections where userId is in memberUserIds
        var query = new QueryDefinition(
                "SELECT * FROM c WHERE ARRAY_CONTAINS(c.memberUserIds, @userId) ORDER BY c.createdAt DESC")
            .WithParameter("@userId", userId);

        var iterator = Container.GetItemQueryIterator<Collection>(
            query,
            requestOptions: new QueryRequestOptions { MaxItemCount = 50 });

        var results = new List<Collection>();
        while (iterator.HasMoreResults)
        {
            var page = await iterator.ReadNextAsync(ct);
            results.AddRange(page);
        }
        return results;
    }

    public async Task<Collection?> GetByIdAsync(string id, string ownerId, CancellationToken ct = default)
    {
        try
        {
            var response = await Container.ReadItemAsync<Collection>(
                id,
                new PartitionKey(ownerId),
                cancellationToken: ct);
            return response.Resource;
        }
        catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    /// <summary>Cross-partition point-query — used when ownerId is unknown (share-link join flow).</summary>
    public async Task<Collection?> FindByIdAsync(string id, CancellationToken ct = default)
    {
        var query = new QueryDefinition("SELECT * FROM c WHERE c.id = @id")
            .WithParameter("@id", id);

        var iterator = Container.GetItemQueryIterator<Collection>(query);
        while (iterator.HasMoreResults)
        {
            var page = await iterator.ReadNextAsync(ct);
            var item = page.FirstOrDefault();
            if (item is not null) return item;
        }
        return null;
    }

    public async Task<Collection> UpsertAsync(Collection collection, CancellationToken ct = default)
    {
        var response = await Container.UpsertItemAsync(
            collection,
            new PartitionKey(collection.OwnerId),
            cancellationToken: ct);
        return response.Resource;
    }

    public async Task DeleteAsync(string id, string ownerId, CancellationToken ct = default)
    {
        try
        {
            await Container.DeleteItemAsync<Collection>(id, new PartitionKey(ownerId), cancellationToken: ct);
        }
        catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
        {
            // Idempotent — treat not-found as success
        }
    }

    public async Task AddMemberAsync(string collectionId, string ownerId, string userId, CancellationToken ct = default)
    {
        var existing = await GetByIdAsync(collectionId, ownerId, ct)
            ?? throw new InvalidOperationException($"Collection {collectionId} not found.");

        if (existing.MemberUserIds.Contains(userId)) return;

        existing.MemberUserIds = existing.MemberUserIds.Append(userId).ToArray();
        await UpsertAsync(existing, ct);
    }

    public async Task RemoveMemberAsync(string collectionId, string ownerId, string userId, CancellationToken ct = default)
    {
        var existing = await GetByIdAsync(collectionId, ownerId, ct);
        if (existing is null) return;

        existing.MemberUserIds = existing.MemberUserIds.Where(m => m != userId).ToArray();
        await UpsertAsync(existing, ct);
    }

    public async Task AddItemAsync(string collectionId, string ownerId, string itemId, CancellationToken ct = default)
    {
        var existing = await GetByIdAsync(collectionId, ownerId, ct)
            ?? throw new InvalidOperationException($"Collection {collectionId} not found.");

        if (existing.ClothingItemIds.Contains(itemId)) return;

        existing.ClothingItemIds = existing.ClothingItemIds.Append(itemId).ToArray();
        await UpsertAsync(existing, ct);
    }

    public async Task RemoveItemAsync(string collectionId, string ownerId, string itemId, CancellationToken ct = default)
    {
        var existing = await GetByIdAsync(collectionId, ownerId, ct);
        if (existing is null) return;

        existing.ClothingItemIds = existing.ClothingItemIds.Where(i => i != itemId).ToArray();
        await UpsertAsync(existing, ct);
    }
}
