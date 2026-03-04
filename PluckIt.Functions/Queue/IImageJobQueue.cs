using System.Threading;
using System.Threading.Tasks;
using PluckIt.Functions.Models;

namespace PluckIt.Functions.Queue;

/// <summary>
/// Thin abstraction over the Azure Storage Queue for image processing jobs.
/// Exists solely to keep <see cref="PluckIt.Functions.Functions.WardrobeFunctions"/>
/// unit-testable without a live Azure Storage connection.
/// </summary>
public interface IImageJobQueue
{
    /// <summary>Enqueue an image processing job message.</summary>
    Task EnqueueAsync(ImageProcessingMessage message, CancellationToken ct = default);
}
