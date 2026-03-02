using PluckIt.Core;

namespace PluckIt.Tests.Fakes;

/// <summary>
/// Fake <see cref="IBlobSasService"/> that:
/// - Returns the original URL unchanged from <see cref="GenerateSasUrl"/> (makes test assertions deterministic)
/// - Records all delete calls for verification
/// </summary>
public sealed class FakeBlobSasService : IBlobSasService
{
    private readonly List<string> _deletedUrls = [];

    /// <summary>URLs passed to <see cref="DeleteBlobAsync"/>.</summary>
    public IReadOnlyList<string> DeletedUrls => _deletedUrls.AsReadOnly();

    /// <summary>Blob names returned by <see cref="ListArchiveBlobNamesAsync"/>. Seed to simulate storage contents.</summary>
    public List<string> ArchiveBlobNames { get; } = [];

    public string GenerateSasUrl(string blobUrl, int validForMinutes = 120) => blobUrl;

    public Task DeleteBlobAsync(string blobUrl, CancellationToken cancellationToken = default)
    {
        _deletedUrls.Add(blobUrl);
        return Task.CompletedTask;
    }

    public async IAsyncEnumerable<string> ListArchiveBlobNamesAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        foreach (var name in ArchiveBlobNames)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return name;
            await Task.Yield();
        }
    }
}
