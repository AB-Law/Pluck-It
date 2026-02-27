namespace PluckIt.Core;

public interface IBlobSasService
{
  /// <summary>
  /// Given a plain blob URL, returns a short-lived SAS URL valid for <paramref name="validForMinutes"/> minutes.
  /// If the URL cannot be parsed or signing fails, returns the original URL unchanged.
  /// </summary>
  string GenerateSasUrl(string blobUrl, int validForMinutes = 120);
}
