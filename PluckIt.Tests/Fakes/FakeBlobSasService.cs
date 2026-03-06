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

    /// <summary>Number of times <see cref="GenerateSasUrl"/> has been called.</summary>
    public int GenerateSasUrlCallCount { get; private set; }

    /// <summary>Blob names returned by <see cref="ListArchiveBlobNamesAsync"/>. Seed to simulate storage contents.</summary>
    public List<string> ArchiveBlobNames { get; } = [];

    public string GenerateSasUrl(string blobUrl, int validForMinutes = 120)
    {
        GenerateSasUrlCallCount++;
        return blobUrl + "?sas=fake";
    }

    public Task DeleteBlobAsync(string blobUrl, CancellationToken cancellationToken = default)
    {
        _deletedUrls.Add(blobUrl);
        return Task.CompletedTask;
    }

    /// <summary>Blob name → uploaded bytes. Seed or inspect during tests.</summary>
    public Dictionary<string, byte[]> UploadedBlobs { get; } = [];

    public Task<string> UploadRawAsync(string blobName, byte[] bytes, string contentType, CancellationToken cancellationToken = default)
    {
        UploadedBlobs[blobName] = bytes;
        return Task.FromResult($"https://fake.storage/{blobName}");
    }

    public Task<byte[]> DownloadRawAsync(string blobUrl, CancellationToken cancellationToken = default)
    {
        var name = blobUrl.Split('/').Last();
        if (UploadedBlobs.TryGetValue(name, out var data)) return Task.FromResult(data);
        return Task.FromResult(Array.Empty<byte>());
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
