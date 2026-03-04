using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Threading.Tasks;
using Azure.Storage;
using Azure.Storage.Blobs;
using Azure.Storage.Sas;
using PluckIt.Core;

namespace PluckIt.Infrastructure;

public class BlobSasService : IBlobSasService
{
  private readonly string _accountName;
  private readonly StorageSharedKeyCredential _credential;
  private readonly string _archiveContainer;
  private readonly string _uploadsContainer;
  private readonly BlobServiceClient _serviceClient;

  public BlobSasService(string accountName, string accountKey, string archiveContainer,
      string uploadsContainer = "uploads")
  {
    _accountName = accountName ?? throw new ArgumentNullException(nameof(accountName));
    _credential = new StorageSharedKeyCredential(accountName, accountKey);
    _archiveContainer = archiveContainer ?? throw new ArgumentNullException(nameof(archiveContainer));
    _uploadsContainer = uploadsContainer;
    _serviceClient = new BlobServiceClient(
        new Uri($"https://{accountName}.blob.core.windows.net"), _credential);
  }

  private BlobContainerClient ArchiveContainer =>
    _serviceClient.GetBlobContainerClient(_archiveContainer);

  public string GenerateSasUrl(string blobUrl, int validForMinutes = 120)
  {
    if (string.IsNullOrWhiteSpace(blobUrl))
      return blobUrl;

    try
    {
      var uri = new Uri(blobUrl);

      // Path is /{container}/{blob...}
      var segments = uri.AbsolutePath.TrimStart('/').Split('/', 2);
      if (segments.Length < 2)
        return blobUrl;

      var containerName = segments[0];
      var blobName = segments[1];

      var sasBuilder = new BlobSasBuilder
      {
        BlobContainerName = containerName,
        BlobName = blobName,
        Resource = "b",
        ExpiresOn = DateTimeOffset.UtcNow.AddMinutes(validForMinutes),
      };
      sasBuilder.SetPermissions(BlobSasPermissions.Read);

      var sasToken = sasBuilder.ToSasQueryParameters(_credential).ToString();
      return $"{uri.GetLeftPart(UriPartial.Path)}?{sasToken}";
    }
    catch
    {
      // Never crash the request over a SAS failure — return plain URL as fallback
      return blobUrl;
    }
  }

  public async Task DeleteBlobAsync(string blobUrl, CancellationToken cancellationToken = default)
  {
    if (string.IsNullOrWhiteSpace(blobUrl))
      return;

    try
    {
      var uri = new Uri(blobUrl.Split('?')[0]); // strip any existing SAS token
      var segments = uri.AbsolutePath.TrimStart('/').Split('/', 2);
      if (segments.Length < 2) return;

      var blobName = segments[1];
      await ArchiveContainer.GetBlobClient(blobName)
        .DeleteIfExistsAsync(cancellationToken: cancellationToken);
    }
    catch
    {
      // Best-effort — never crash the caller over a blob delete failure
    }
  }

  public async IAsyncEnumerable<string> ListArchiveBlobNamesAsync(
    [EnumeratorCancellation] CancellationToken cancellationToken = default)
  {
    await foreach (var item in ArchiveContainer
      .GetBlobsAsync(cancellationToken: cancellationToken)
      .WithCancellation(cancellationToken))
    {
      yield return item.Name;
    }
  }

  public async Task<string> UploadRawAsync(string blobName, byte[] bytes, string contentType,
      CancellationToken cancellationToken = default)
  {
    var container = _serviceClient.GetBlobContainerClient(_uploadsContainer);
    var blobClient = container.GetBlobClient(blobName);
    using var stream = new System.IO.MemoryStream(bytes);
    await blobClient.UploadAsync(stream,
        new Azure.Storage.Blobs.Models.BlobUploadOptions
        {
            HttpHeaders = new Azure.Storage.Blobs.Models.BlobHttpHeaders
            { ContentType = contentType }
        },
        cancellationToken);
    return blobClient.Uri.ToString();
  }

  public async Task<byte[]> DownloadRawAsync(string blobUrl, CancellationToken cancellationToken = default)
  {
    var uri = new Uri(blobUrl.Split('?')[0]);
    var segments = uri.AbsolutePath.TrimStart('/').Split('/', 2);
    var containerName = segments[0];
    var blobName = segments.Length > 1 ? segments[1] : throw new ArgumentException("Cannot parse blob name from URL.");
    var blobClient = _serviceClient.GetBlobContainerClient(containerName).GetBlobClient(blobName);
    var result = await blobClient.DownloadContentAsync(cancellationToken);
    return result.Value.Content.ToArray();
  }
}
