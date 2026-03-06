using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using PluckIt.Core;
using PluckIt.Functions.Models;
using PluckIt.Functions.Serialization;

namespace PluckIt.Functions.Functions;

/// <summary>
/// Azure Functions queue-triggered worker that executes the full image processing
/// pipeline asynchronously: downloads the raw upload blob, calls the Python
/// segmentation/background-removal processor, extracts AI clothing metadata, and
/// writes the terminal draft state (Ready or Failed) to Cosmos DB.
///
/// Triggered by messages on the <c>image-processing-jobs</c> storage queue that are
/// placed there by <see cref="WardrobeFunctions.UploadItem"/> and
/// <see cref="WardrobeFunctions.RetryDraft"/> upon their 202 Accepted return.
/// </summary>
public class ImageProcessingWorker(
    IWardrobeRepository repo,
    IBlobSasService sasService,
    IClothingMetadataService metadataService,
    IHttpClientFactory httpClientFactory,
    ILogger<ImageProcessingWorker> logger)
{
    [Function("ProcessImageJob")]
    public async Task Run(
        [QueueTrigger("image-processing-jobs", Connection = "StorageQueue")] string messageJson)
    {
        ImageProcessingMessage? message;
        try
        {
            message = JsonSerializer.Deserialize(messageJson,
                PluckItJsonContext.Default.ImageProcessingMessage);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to deserialize queue message: {Raw}", messageJson);
            // Returning normally ACKs the message. The poison queue handles repeated failures.
            return;
        }

        if (message is null)
        {
            logger.LogWarning("Null message received on image-processing-jobs queue.");
            return;
        }

        logger.LogInformation(
            "ProcessImageJob: starting for item {ItemId}, user {UserId}, attempt {Attempt}.",
            message.ItemId, message.UserId, message.Attempt);

        // ── Idempotency guard: skip if draft is no longer in Processing state ──────
        // Wrapped: any Cosmos exception here is transient; mark Failed & ACK so the
        // message is not endlessly retried (which would move it to the poison queue).
        ClothingItem? draft;
        try
        {
            draft = await repo.GetByIdAsync(message.ItemId, message.UserId, CancellationToken.None);
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "ProcessImageJob: Cosmos read failed for item {ItemId}; marking Failed.", message.ItemId);
            try
            {
                await repo.SetDraftTerminalAsync(
                    message.ItemId, message.UserId, DraftStatus.Failed,
                    null, null, "Cosmos read error during idempotency check.",
                    DateTimeOffset.UtcNow, CancellationToken.None);
            }
            catch (Exception writeEx)
            {
                logger.LogError(writeEx,
                    "ProcessImageJob: also failed to mark item {ItemId} as Failed after Cosmos read error.",
                    message.ItemId);
            }
            return; // ACK the message — do not retry
        }

        if (draft is null)
        {
            logger.LogWarning("ProcessImageJob: draft {ItemId} not found; skipping.", message.ItemId);
            return;
        }

        if (draft.DraftStatus != DraftStatus.Processing)
        {
            logger.LogInformation(
                "ProcessImageJob: draft {ItemId} is {Status}; skipping duplicate job.",
                message.ItemId, draft.DraftStatus);
            return;
        }

        // ── Download raw upload bytes ────────────────────────────────────────────
        byte[] imageBytes;
        try
        {
            imageBytes = await sasService.DownloadRawAsync(
                message.RawImageBlobUrl, CancellationToken.None);
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "ProcessImageJob: failed to download raw image for item {ItemId}.", message.ItemId);
            try
            {
                await repo.SetDraftTerminalAsync(
                    message.ItemId, message.UserId, DraftStatus.Failed,
                    null, null, "Raw image download failed.",
                    DateTimeOffset.UtcNow, CancellationToken.None);
            }
            catch (Exception writeEx)
            {
                logger.LogError(writeEx,
                    "ProcessImageJob: also failed to mark item {ItemId} as Failed after download error.",
                    message.ItemId);
            }
            return;
        }

        // ── Run the full pipeline (processor → metadata → terminal state) ─────────
        // Wrap in try-catch: any unhandled exception here would cause the Functions
        // runtime to retry the queue message (eventually poisoning it).
        try
        {
            await RunPipelineAsync(
                message.ItemId,
                message.UserId,
                imageBytes,
                // Raw uploads from clients are always JPEG after resizeImageFile in Angular.
                // The processor normalizes before segmentation, so JPEG is correct here.
                "image/jpeg",
                CancellationToken.None);
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "ProcessImageJob: unhandled exception in pipeline for item {ItemId}; marking Failed.",
                message.ItemId);
            await repo.SetDraftTerminalAsync(
                message.ItemId, message.UserId, DraftStatus.Failed, null, null,
                "Internal pipeline error.", DateTimeOffset.UtcNow, CancellationToken.None);
        }
    }

    // ── Private: full processing pipeline ────────────────────────────────────────

    /// <summary>
    /// Calls the Python processor for background removal, extracts AI metadata from
    /// the returned WebP, and writes the terminal Cosmos draft state. All Cosmos writes
    /// use <see cref="CancellationToken.None"/> so they are not affected by queue timeouts.
    /// </summary>
    private async Task RunPipelineAsync(
        string itemId,
        string userId,
        byte[] imageBytes,
        string mediaType,
        CancellationToken ct)
    {
        // ── Forward image to Python processor ──────────────────────────────────
        using var form = new MultipartFormDataContent();
        var streamContent = new StreamContent(new MemoryStream(imageBytes));
        streamContent.Headers.ContentType =
            new System.Net.Http.Headers.MediaTypeHeaderValue(mediaType);
        form.Add(streamContent, "image", "upload.jpeg");
        form.Add(new StringContent(itemId), "item_id");

        var processorClient = httpClientFactory.CreateClient("processor");
        HttpResponseMessage processorResponse;
        try
        {
            // Hard cap at 125 s — the processor/Modal BiRefNet has an 85 s internal timeout.
            using var processorCts = new CancellationTokenSource(TimeSpan.FromSeconds(125));
            processorResponse = await processorClient.PostAsync(
                "/api/process-image", form, processorCts.Token);
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "ProcessImageJob: processor unreachable for item {ItemId}.", itemId);
            await repo.SetDraftTerminalAsync(itemId, userId, DraftStatus.Failed, null, null,
                "Image processor is unavailable.", DateTimeOffset.UtcNow, CancellationToken.None);
            return;
        }

        if (!processorResponse.IsSuccessStatusCode)
        {
            var body = await processorResponse.Content.ReadAsStringAsync(ct);
            logger.LogError(
                "ProcessImageJob: processor returned {Status} for item {ItemId}: {Body}",
                (int)processorResponse.StatusCode, itemId, body);
            await repo.SetDraftTerminalAsync(itemId, userId, DraftStatus.Failed, null, null,
                $"Processor returned {(int)processorResponse.StatusCode}.",
                DateTimeOffset.UtcNow, CancellationToken.None);
            return;
        }

        ProcessorResult? processed;
        try
        {
            processed = await processorResponse.Content
                .ReadFromJsonAsync(PluckItJsonContext.Default.ProcessorResult, CancellationToken.None);
        }
        catch (Exception ex)
        {
            logger.LogError(ex,
                "ProcessImageJob: failed to deserialize processor response for item {ItemId}.", itemId);
            await repo.SetDraftTerminalAsync(itemId, userId, DraftStatus.Failed, null, null,
                "Processor response was not valid JSON.",
                DateTimeOffset.UtcNow, CancellationToken.None);
            return;
        }

        if (processed is null || string.IsNullOrEmpty(processed.ImageUrl))
        {
            await repo.SetDraftTerminalAsync(itemId, userId, DraftStatus.Failed, null, null,
                "Processor returned an unexpected response.",
                DateTimeOffset.UtcNow, CancellationToken.None);
            return;
        }

        // MediaType is now returned by the processor (image/webp); fall back gracefully.
        var processedMediaType = processed.MediaType ?? "image/webp";

        // ── Extract AI clothing metadata from the processed image ──────────────
        ClothingMetadata? metadata = null;
        try
        {
            var processedSasUrl = sasService.GenerateSasUrl(processed.ImageUrl, validForMinutes: 5);
            using var sasClient = httpClientFactory.CreateClient();
            var processedBytes = await sasClient.GetByteArrayAsync(processedSasUrl, CancellationToken.None);
            var imageData = BinaryData.FromBytes(processedBytes);
            metadata = await metadataService.ExtractMetadataAsync(
                imageData, processedMediaType, CancellationToken.None);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "ProcessImageJob: metadata extraction failed for item {ItemId}; proceeding with empty metadata.",
                itemId);
        }

        // ── Write terminal Ready state ─────────────────────────────────────────
        // Wrapped in try-catch: a transient Cosmos write failure here must NOT
        // cause an unhandled exception that retries the queue message.
        try
        {
            await repo.SetDraftTerminalAsync(
                itemId, userId, DraftStatus.Ready,
                processed.ImageUrl, metadata, null,
                DateTimeOffset.UtcNow, CancellationToken.None);
        }
        catch (Exception ex)
        {
            // Re-throw so the outer Run() catch can set the item to Failed and
            // acknowledge the message (no unnecessary retry).
            logger.LogError(ex,
                "ProcessImageJob: Cosmos write failed on Ready for item {ItemId}.", itemId);
            throw;
        }

        logger.LogInformation(
            "ProcessImageJob: item {ItemId} finalized as Ready with {MediaType}.",
            itemId, processedMediaType);
    }
}
