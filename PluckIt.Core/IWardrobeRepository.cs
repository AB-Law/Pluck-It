using System.Threading;
using System.Threading.Tasks;

namespace PluckIt.Core;

public interface IWardrobeRepository
{
  /// <summary>
  /// Returns a single page of clothing items for a user, applying all filters,
  /// sort, and pagination specified in <paramref name="query"/>.
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
  /// Atomically appends <paramref name="ev"/> to the item's WearEvents array,
  /// stamps LastWornAt, increments WearCount by 1, and trims WearEvents to
  /// the most recent <paramref name="maxEvents"/> entries.
  /// Returns the updated item, or null if the item does not exist.
  /// </summary>
  Task<ClothingItem?> AppendWearEventAsync(
    string itemId,
    string userId,
    WearEvent ev,
    int maxEvents = 30,
    CancellationToken cancellationToken = default);
}

