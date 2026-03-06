using System.Threading;
using System.Threading.Tasks;

namespace PluckIt.Core;

public interface IEmbeddingService
{
    /// <summary>
    /// Generates a vector embedding for an image formatted as a base64 Data URI.
    /// Input must be of the format: `data:image/webp;base64,...`
    /// </summary>
    Task<float[]> EmbedImageAsync(string imageDataUri, CancellationToken cancellationToken = default);

    /// <summary>
    /// Generates a vector embedding for a text query.
    /// </summary>
    Task<float[]> EmbedTextAsync(string text, CancellationToken cancellationToken = default);
}
