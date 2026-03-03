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
}

