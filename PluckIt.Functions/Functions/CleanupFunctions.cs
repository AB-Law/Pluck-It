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
    // cron: second minute hour day month day-of-week
    // "0 0 2 * * *" = 02:00:00 UTC every day
    [Function(nameof(CleanUpOrphanBlobs))]
    public async Task CleanUpOrphanBlobs(
        [TimerTrigger("0 0 2 * * *")] TimerInfo timer,
        CancellationToken cancellationToken)
    {
        logger.LogInformation("Orphan blob cleanup started at {Time}", DateTimeOffset.UtcNow);

        // ── 1. Collect all known item IDs from Cosmos (cross-partition) ───────
        // We read only the /id field to minimise RU cost.
        var knownIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            // Iterate every container the wardrobe uses; we query the same database/container
            // that's registered in DI — we rely on naming convention here since CleanupFunctions
            // doesn't have a typed IWardrobeRepository (to avoid loading all items into memory).
            // The CosmosClient is the shared singleton; we look up items by scanning with minimal projection.
            // Database / container names fall back to the same defaults as Program.cs.
            var dbName = Environment.GetEnvironmentVariable("Cosmos__Database") ?? "PluckIt";
            var containerName = Environment.GetEnvironmentVariable("Cosmos__Container") ?? "Wardrobe";
            var container = cosmosClient.GetContainer(dbName, containerName);

            var query = new QueryDefinition("SELECT c.id FROM c WHERE IS_DEFINED(c.imageUrl)");
            var iterator = container.GetItemQueryStreamIterator(query, requestOptions: new QueryRequestOptions
            {
                MaxItemCount = 500,
            });

            while (iterator.HasMoreResults)
            {
                using var response = await iterator.ReadNextAsync(cancellationToken);
                if (!response.IsSuccessStatusCode) break;

                using var doc = await System.Text.Json.JsonDocument.ParseAsync(response.Content, cancellationToken: cancellationToken);
                if (doc.RootElement.TryGetProperty("Documents", out var docs))
                {
                    foreach (var item in docs.EnumerateArray())
                    {
                        if (item.TryGetProperty("id", out var idProp))
                            knownIds.Add(idProp.GetString() ?? string.Empty);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to query Cosmos for known item IDs. Aborting cleanup.");
            return;
        }

        logger.LogInformation("Found {Count} known item IDs in Cosmos", knownIds.Count);

        // ── 2. List blobs and delete orphans ──────────────────────────────────
        int deleted = 0, skipped = 0;

        await foreach (var blobName in sasService.ListArchiveBlobNamesAsync())
        {
            // Blob naming convention: "{item_id}-transparent.png"
            // Extract the item ID prefix by stripping the "-transparent.png" suffix
            var itemId = blobName.EndsWith("-transparent.png", StringComparison.OrdinalIgnoreCase)
                ? blobName[..^"-transparent.png".Length]
                : blobName;

            if (knownIds.Contains(itemId))
            {
                skipped++;
                continue;
            }

            // Reconstruct a blob URL for the delete helper
            var accountName = Environment.GetEnvironmentVariable("STORAGE_ACCOUNT_NAME") ?? "";
            var archiveContainer = Environment.GetEnvironmentVariable("ARCHIVE_CONTAINER_NAME") ?? "archive";
            var blobUrl = $"https://{accountName}.blob.core.windows.net/{archiveContainer}/{blobName}";

            logger.LogInformation("Deleting orphan blob: {BlobName}", blobName);
            await sasService.DeleteBlobAsync(blobUrl, cancellationToken);
            deleted++;
        }

        logger.LogInformation(
            "Orphan blob cleanup complete. Deleted: {Deleted}, Skipped (matched): {Skipped}",
            deleted, skipped);
    }
}
