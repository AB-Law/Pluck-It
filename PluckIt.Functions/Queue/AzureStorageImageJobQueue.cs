using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Azure.Storage.Queues;
using PluckIt.Functions.Models;
using PluckIt.Functions.Serialization;

namespace PluckIt.Functions.Queue;

/// <summary>
/// Sends <see cref="ImageProcessingMessage"/> records as UTF-8 JSON to the
/// <c>image-processing-jobs</c> Azure Storage Queue.
/// </summary>
public sealed class AzureStorageImageJobQueue(QueueClient client) : IImageJobQueue
{
    public async Task EnqueueAsync(ImageProcessingMessage message, CancellationToken ct = default)
    {
        var json = JsonSerializer.Serialize(message, PluckItJsonContext.Default.ImageProcessingMessage);
        // QueueClient is configured with Base64 encoding (matching the trigger default
        // for dotnet-isolated apps). The SDK base64-encodes this JSON automatically.
        await client.SendMessageAsync(json, ct);
    }
}
