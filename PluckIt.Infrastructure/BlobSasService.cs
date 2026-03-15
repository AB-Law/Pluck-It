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
  private readonly StorageSharedKeyCredential _credential;
  private readonly string _archiveContainer;
  private readonly string _uploadsContainer;
  private readonly BlobServiceClient _serviceClient;
  private readonly HashSet<string> _allowedContainers;

  public BlobSasService(string accountName, string accountKey, string archiveContainer,
      string uploadsContainer = "uploads")
  {
    _credential = new StorageSharedKeyCredential(accountName, accountKey);
    _archiveContainer = archiveContainer ?? throw new ArgumentNullException(nameof(archiveContainer));
    _uploadsContainer = uploadsContainer;
    _allowedContainers = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
      _archiveContainer,
      _uploadsContainer
    };
    _serviceClient = new BlobServiceClient(
        new Uri($"https://{accountName}.blob.core.windows.net"), _credential);
  }

  /// <summary>
  /// Constructor for local development using Azurite — pass "UseDevelopmentStorage=true".
  /// Azurite's auth implementation is incompatible with StorageSharedKeyCredential + explicit URI
  /// when using Azure.Storage.Blobs v12.28+ (API version 2026-02-06).
  /// </summary>
  public BlobSasService(string connectionString, string archiveContainer,
      string uploadsContainer = "uploads")
  {
    _archiveContainer = archiveContainer ?? throw new ArgumentNullException(nameof(archiveContainer));
    _uploadsContainer = uploadsContainer;
    _allowedContainers = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
    {
      _archiveContainer,
      _uploadsContainer
    };
    _serviceClient = new BlobServiceClient(connectionString);
    // Extract credential from the dev storage connection string for SAS generation.
    // For Azurite, SAS URLs won't be used externally, so a dummy credential is fine.
    _credential = new StorageSharedKeyCredential("devstoreaccount1",
        "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OugushZnRUOkvietl3hGys8uqHFht0YhfB7DPm3bkzrEt5PJBKgIfbI=");
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
      // Azurite containers are set to public-blob access in local dev,
      // and Azurite doesn't support the SDK's SAS API version — skip SAS.
      if (uri.Host == "127.0.0.1" || uri.Host == "localhost")
        return blobUrl;

      var (containerName, blobName) = ParseBlobUri(uri);
      if (!_allowedContainers.Contains(containerName))
        return blobUrl;

      var sasBuilder = new BlobSasBuilder
      {
        BlobContainerName = containerName,
        BlobName = blobName,
        Resource = "b",
        ExpiresOn = DateTimeOffset.UtcNow.AddMinutes(validForMinutes),
      };
      sasBuilder.SetPermissions(BlobSasPermissions.Read);

      var sasToken = sasBuilder.ToSasQueryParameters(_credential).ToString();
      var canonicalBlobUri = _serviceClient.GetBlobContainerClient(containerName)
        .GetBlobClient(blobName)
        .Uri;
      return $"{canonicalBlobUri}?{sasToken}";
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
      var (containerName, blobName) = ParseBlobUri(uri);
      if (!_allowedContainers.Contains(containerName))
        return;
      await _serviceClient.GetBlobContainerClient(containerName).GetBlobClient(blobName)
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

  public async Task<string> UploadArchiveAsync(string blobName, byte[] bytes, string contentType,
      CancellationToken cancellationToken = default)
  {
    var blobClient = ArchiveContainer.GetBlobClient(blobName);
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
    var (containerName, blobName) = ParseBlobUri(uri);
    var blobClient = _serviceClient.GetBlobContainerClient(containerName).GetBlobClient(blobName);
    var result = await blobClient.DownloadContentAsync(cancellationToken);
    return result.Value.Content.ToArray();
  }

  /// <summary>
  /// Parses both subdomain-style (Azure) and path-style (Azurite) blob URLs.
  /// Azure:   https://{account}.blob.core.windows.net/{container}/{blob}  → path = /{container}/{blob}
  /// Azurite: http://127.0.0.1:10000/{account}/{container}/{blob}         → path = /{account}/{container}/{blob}
  /// </summary>
  private static (string container, string blobName) ParseBlobUri(Uri uri)
  {
    var parts = uri.AbsolutePath.TrimStart('/').Split('/', 3);
    // Path-style: first segment is the storage account name (not a container)
    if (parts.Length >= 3 && parts[0] == "devstoreaccount1")
      return (parts[1], parts[2]);
    if (parts.Length < 2)
      throw new ArgumentException($"Cannot parse container/blob from URL: {uri}");
    return (parts[0], parts[1]);
  }
}
