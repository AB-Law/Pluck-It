using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.Cosmos;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using PluckIt.Core;

namespace PluckIt.Functions.Functions;

/// <summary>
/// Daily blob cleanup Function.
/// Runs at 02:00 UTC and deletes any blobs in the archive container that have no
/// corresponding ClothingItem document in Cosmos. This handles:
///   - Images orphaned when a user discards an upload draft
///   - Any other leaks from partial failures
/// </summary>
public class CleanupFunctions(
    IBlobSasService sasService,
    CosmosClient cosmosClient,
    ILogger<CleanupFunctions> logger)
{
    private const string TransparentSuffix = "-transparent.png";

    private static (string dbName, string wardrobeContainerName, string? imageCleanupIndexContainerName) GetCosmosConfig()
    {
        var dbName = Environment.GetEnvironmentVariable("Cosmos__Database") ?? "PluckIt";
        var containerName = Environment.GetEnvironmentVariable("Cosmos__Container") ?? "Wardrobe";
        var imageCleanupIndexContainerName = Environment.GetEnvironmentVariable(
            WardrobeImageCleanupIndex.ContainerSettingName);
        return (dbName, containerName, imageCleanupIndexContainerName);
    }

    private static (string accountName, string archiveContainer) GetStorageConfig()
    {
        var accountName = Environment.GetEnvironmentVariable("STORAGE_ACCOUNT_NAME") ?? "";
        var archiveContainer = Environment.GetEnvironmentVariable("ARCHIVE_CONTAINER_NAME") ?? "archive";
        return (accountName, archiveContainer);
    }

    private static string ExtractItemIdFromBlobName(string blobName)
    {
        if (blobName.EndsWith(TransparentSuffix, StringComparison.OrdinalIgnoreCase))
        {
            return blobName[..^TransparentSuffix.Length];
        }

        return blobName;
    }

    private static string BuildBlobUrl(string accountName, string archiveContainer, string blobName)
        => $"https://{accountName}.blob.core.windows.net/{archiveContainer}/{blobName}";

    private async Task<HashSet<string>> GetKnownItemIdsAsync(CancellationToken cancellationToken)
    {
        var (dbName, wardrobeContainerName, imageCleanupIndexContainerName) = GetCosmosConfig();
        var useImageCleanupIndex = !string.IsNullOrWhiteSpace(imageCleanupIndexContainerName);
        var containerName = useImageCleanupIndex
            ? imageCleanupIndexContainerName!
            : wardrobeContainerName;
        var container = cosmosClient.GetContainer(dbName, containerName);

        var query = useImageCleanupIndex
            ? new QueryDefinition("SELECT c.itemId FROM c")
            : new QueryDefinition("SELECT c.id FROM c WHERE IS_DEFINED(c.imageUrl)");
        var queryOptions = new QueryRequestOptions
        {
            MaxItemCount = 500,
            PartitionKey = useImageCleanupIndex
                ? new PartitionKey(WardrobeImageCleanupIndex.PartitionKeyValue)
                : null,
        };
        var knownIds = await ReadKnownItemIdsAsync(container, query, queryOptions, cancellationToken);
        return knownIds;
    }

    private static async Task<HashSet<string>> ReadKnownItemIdsAsync(
        Container container,
        QueryDefinition query,
        QueryRequestOptions requestOptions,
        CancellationToken cancellationToken)
    {
        var knownIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var iterator = container.GetItemQueryStreamIterator(
            query,
            requestOptions: requestOptions);
        while (iterator.HasMoreResults)
        {
            using var response = await iterator.ReadNextAsync(cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                break;
            }

            using var doc = await JsonDocument.ParseAsync(response.Content, cancellationToken: cancellationToken);
            if (!doc.RootElement.TryGetProperty("Documents", out var docs))
            {
                continue;
            }

            foreach (var item in docs.EnumerateArray())
            {
                if (!item.TryGetProperty("id", out var idProp))
                {
                    if (!item.TryGetProperty("itemId", out idProp))
                    {
                        continue;
                    }
                }

                var id = idProp.GetString();
                if (!string.IsNullOrEmpty(id))
                {
                    knownIds.Add(id);
                }
            }
        }
        return knownIds;
    }

    // cron: second minute hour day month day-of-week
    // "0 0 2 * * *" = 02:00:00 UTC every day
    [Function(nameof(CleanUpOrphanBlobs))]
    public async Task CleanUpOrphanBlobs(
        [TimerTrigger("0 0 2 * * *")] TimerInfo timer,
        CancellationToken cancellationToken)
    {
        logger.LogInformation("Orphan blob cleanup started at {Time}", DateTimeOffset.UtcNow);

        // ── 1. Collect all known item IDs from Cosmos ────────────────────
        // Prefer the cleanup index container when configured; otherwise
        // use the legacy wardrobe scan.
        try
        {
            var knownIds = await GetKnownItemIdsAsync(cancellationToken);

            // ── 2. List blobs and delete orphans ──────────────────────────────
            int deleted = 0, skipped = 0;
            var (accountName, archiveContainer) = GetStorageConfig();

            await foreach (var blobName in sasService.ListArchiveBlobNamesAsync())
            {
                var itemId = ExtractItemIdFromBlobName(blobName);

                if (knownIds.Contains(itemId))
                {
                    skipped++;
                    continue;
                }

                var blobUrl = BuildBlobUrl(accountName, archiveContainer, blobName);
                await sasService.DeleteBlobAsync(blobUrl, cancellationToken);
                deleted++;
            }

            logger.LogInformation(
                "Orphan blob cleanup complete. Deleted: {Deleted}, Skipped (matched): {Skipped}",
                deleted, skipped);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to query Cosmos for known item IDs. Aborting cleanup.");
        }
    }
}
