using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace PluckIt.Core;

public interface IWardrobeRepository
{
  Task<IReadOnlyCollection<ClothingItem>> GetAllAsync(
    string userId,
    string? category,
    IReadOnlyCollection<string>? tags,
    int page,
    int pageSize,
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

