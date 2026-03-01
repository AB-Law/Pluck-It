using System;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.Cosmos;
using PluckIt.Core;

namespace PluckIt.Infrastructure;

public class UserProfileRepository : IUserProfileRepository
{
  private readonly CosmosClient _client;
  private readonly string _databaseName;
  private readonly string _containerName;

  public UserProfileRepository(CosmosClient client, string databaseName, string containerName)
  {
    _client = client ?? throw new ArgumentNullException(nameof(client));
    _databaseName = databaseName ?? throw new ArgumentNullException(nameof(databaseName));
    _containerName = containerName ?? throw new ArgumentNullException(nameof(containerName));
  }

  private Container Container => _client.GetContainer(_databaseName, _containerName);

  public async Task<UserProfile?> GetAsync(string userId, CancellationToken cancellationToken = default)
  {
    try
    {
      var response = await Container.ReadItemAsync<UserProfile>(
        userId,
        new PartitionKey(userId),
        cancellationToken: cancellationToken);
      return response.Resource;
    }
    catch (CosmosException ex) when (ex.StatusCode == HttpStatusCode.NotFound)
    {
      return null;
    }
  }

  public async Task UpsertAsync(UserProfile profile, CancellationToken cancellationToken = default)
  {
    await Container.UpsertItemAsync(
      profile,
      new PartitionKey(profile.Id),
      cancellationToken: cancellationToken);
  }
}
