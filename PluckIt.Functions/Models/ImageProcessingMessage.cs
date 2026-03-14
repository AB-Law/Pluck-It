using System;

namespace PluckIt.Functions.Models;

/// <summary>
/// Message payload placed on the <c>image-processing-jobs</c> Azure Storage Queue.
/// The queue worker deserializes this to run the full segmentation + metadata pipeline
/// asynchronously, decoupled from the HTTP request lifetime.
/// </summary>
public record ImageProcessingMessage(
    string ItemId,
    string UserId,
    string RawImageBlobUrl,
    int Attempt,
    DateTimeOffset EnqueuedAt,
    bool SkipSegmentation = false);
