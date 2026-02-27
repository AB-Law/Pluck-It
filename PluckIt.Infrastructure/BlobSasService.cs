using System;
using Azure.Storage;
using Azure.Storage.Sas;
using PluckIt.Core;

namespace PluckIt.Infrastructure;

public class BlobSasService : IBlobSasService
{
  private readonly string _accountName;
  private readonly StorageSharedKeyCredential _credential;
  private readonly string _archiveContainer;

  public BlobSasService(string accountName, string accountKey, string archiveContainer)
  {
    _accountName = accountName ?? throw new ArgumentNullException(nameof(accountName));
    _credential = new StorageSharedKeyCredential(accountName, accountKey);
    _archiveContainer = archiveContainer ?? throw new ArgumentNullException(nameof(archiveContainer));
  }

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
}
