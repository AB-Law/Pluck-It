using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace PluckIt.Core;

public interface IBlobSasService
{
  /// <summary>
  /// Given a plain blob URL, returns a short-lived SAS URL valid for <paramref name="validForMinutes"/> minutes.
  /// If the URL cannot be parsed or signing fails, returns the original URL unchanged.
  /// </summary>
  string GenerateSasUrl(string blobUrl, int validForMinutes = 120);

  /// <summary>
  /// Deletes the blob at <paramref name="blobUrl"/> from the archive container.
  /// Silently succeeds if the blob does not exist.
  /// </summary>
  Task DeleteBlobAsync(string blobUrl, CancellationToken cancellationToken = default);

  /// <summary>
  /// Lists all blob names in the archive container.
  /// Used by the cleanup Function to identify orphaned blobs.
  /// </summary>
  IAsyncEnumerable<string> ListArchiveBlobNamesAsync(CancellationToken cancellationToken = default);
}
