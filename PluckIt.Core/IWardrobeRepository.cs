using System;
using System.Threading;
using System.Threading.Tasks;

namespace PluckIt.Core;

public interface IWardrobeRepository
{
  /// <summary>
  /// Returns a single page of clothing items for a user, applying all filters,
  /// sort, and pagination specified in <paramref name="query"/>.
  /// Excludes draft items (draftStatus is non-null).
  /// </summary>
  Task<WardrobePagedResult> GetAllAsync(
    string userId,
    WardrobeQuery query,
    CancellationToken cancellationToken = default);

  Task<ClothingItem?> GetByIdAsync(
    string id,
    string userId,
    CancellationToken cancellationToken = default);

  Task UpsertAsync(
    ClothingItem item,
    CancellationToken cancellationToken = default);

  Task DeleteAsync(
    string id,
    string userId,
    CancellationToken cancellationToken = default);

  /// <summary>
  /// Returns upload drafts (items with a non-null draftStatus) for a user, newest first.
  /// </summary>
  Task<WardrobeDraftsResult> GetDraftsAsync(
    string userId,
    int pageSize = 50,
    string? continuationToken = null,
    CancellationToken cancellationToken = default);

  /// <summary>
  /// Atomically writes the terminal state (Ready or Failed) to a draft that is currently
  /// in Processing state. Guards with a Cosmos filter predicate so late / out-of-order
  /// writes from disconnected requests are silently discarded.
  /// Returns true if the write landed; false if the predicate missed (item already transitioned).
  /// </summary>
  Task<bool> SetDraftTerminalAsync(
    string itemId,
    string userId,
    DraftStatus terminalStatus,
    string? processedBlobUrl,
    ClothingMetadata? metadata,
    string? errorMessage,
    CancellationToken cancellationToken = default);

  /// <summary>
  /// Promotes a Ready draft to a finalized wardrobe item using Cosmos Patch with a filter
  /// predicate enforcing draftStatus == Ready. Sets dateAdded to <paramref name="finalizedAt"/>.
  /// Returns the updated item, or null if the predicate missed (item not Ready).
  /// </summary>
  Task<ClothingItem?> AcceptDraftAsync(
    string itemId,
    string userId,
    DateTimeOffset finalizedAt,
    CancellationToken cancellationToken = default);

  /// <summary>
  /// Atomically appends <paramref name="ev"/> to the item's WearEvents array,
  /// stamps LastWornAt, increments WearCount by 1, and trims WearEvents to
  /// the most recent <paramref name="maxEvents"/> entries.
  /// Returns the updated item, or null if the item does not exist.
  /// </summary>
  Task<ClothingItem?> AppendWearEventAsync(
    string itemId,
    string userId,
    WearEvent ev,
    string? clientEventId = null,
    int maxEvents = 30,
    CancellationToken cancellationToken = default);

  /// <summary>
  /// Cross-partition query used by the cleanup timer — returns drafts in a given
  /// status whose <c>draftUpdatedAt</c> (or <c>draftCreatedAt</c> as fallback) is
  /// older than <paramref name="olderThan"/>.
  /// </summary>
  Task<IReadOnlyList<ClothingItem>> GetByDraftStatusAsync(
    DraftStatus status,
    DateTimeOffset olderThan,
    int maxItems = 200,
    CancellationToken cancellationToken = default);
}
