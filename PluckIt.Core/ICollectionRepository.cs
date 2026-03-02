using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace PluckIt.Core;

/// <summary>
/// Data-access contract for <see cref="Collection"/> entities stored in Cosmos DB.
/// All methods are userId-scoped for security — the infrastructure implementation
/// enforces ownership rules at the Cosmos query level.
/// </summary>
public interface ICollectionRepository
{
    /// <summary>Get all collections owned by <paramref name="ownerId"/>.</summary>
    Task<IReadOnlyList<Collection>> GetByOwnerAsync(string ownerId, CancellationToken ct = default);

    /// <summary>Get all collections that <paramref name="userId"/> has joined (but does not own).</summary>
    Task<IReadOnlyList<Collection>> GetJoinedByUserAsync(string userId, CancellationToken ct = default);

    /// <summary>Point-read a single collection.  Returns null if not found.</summary>
    Task<Collection?> GetByIdAsync(string id, string ownerId, CancellationToken ct = default);

    /// <summary>
    /// Cross-partition query to find any collection by its ID regardless of owner.
    /// Used when the caller does not know the owning partition (e.g., share-link join flow).
    /// </summary>
    Task<Collection?> FindByIdAsync(string id, CancellationToken ct = default);

    /// <summary>Create or fully replace a collection.  Caller must set Id and OwnerId.</summary>
    Task<Collection> UpsertAsync(Collection collection, CancellationToken ct = default);

    /// <summary>Hard-delete a collection (owner only).  No-op if not found.</summary>
    Task DeleteAsync(string id, string ownerId, CancellationToken ct = default);

    /// <summary>Add <paramref name="userId"/> to the MemberUserIds list.</summary>
    Task AddMemberAsync(string collectionId, string ownerId, string userId, CancellationToken ct = default);

    /// <summary>Remove <paramref name="userId"/> from the MemberUserIds list.</summary>
    Task RemoveMemberAsync(string collectionId, string ownerId, string userId, CancellationToken ct = default);

    /// <summary>Append a clothing item ID to the collection.</summary>
    Task AddItemAsync(string collectionId, string ownerId, string itemId, CancellationToken ct = default);

    /// <summary>Remove a clothing item ID from the collection.</summary>
    Task RemoveItemAsync(string collectionId, string ownerId, string itemId, CancellationToken ct = default);
}
