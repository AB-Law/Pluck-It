using System.Threading;
using System.Threading.Tasks;

namespace PluckIt.Core;

public interface IUserProfileRepository
{
  Task<UserProfile?> GetAsync(string userId, CancellationToken cancellationToken = default);
  Task UpsertAsync(UserProfile profile, CancellationToken cancellationToken = default);
}
