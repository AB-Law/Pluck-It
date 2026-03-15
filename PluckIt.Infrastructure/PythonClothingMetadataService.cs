using System.Net.Http.Headers;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Azure.Core;
using Azure.Identity;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.DependencyInjection;
using PluckIt.Core;

namespace PluckIt.Infrastructure;

/// <summary>
/// Clothing metadata service implementation that calls the Python processor metadata
/// endpoint. Returns empty metadata on any failure to keep the image pipeline
/// fail-open.
/// </summary>
public class PythonClothingMetadataService : IClothingMetadataService
{
  private readonly IHttpClientFactory _httpClientFactory;
  private readonly string _metadataEndpoint;
  private readonly string _authMode;
  private readonly string _apiKey;
  private readonly string _azureAdScope;
  private readonly string _azureAdAudience;
  private readonly TokenCredential _tokenCredential;
  private readonly ILogger<PythonClothingMetadataService> _logger;
  private readonly string _httpClientName;

  public PythonClothingMetadataService(
    IHttpClientFactory httpClientFactory,
    string metadataEndpoint,
    string authMode,
    string? apiKey = null,
    string? azureAdScope = null,
    string? azureAdAudience = null,
    ILogger<PythonClothingMetadataService>? logger = null,
    TokenCredential? tokenCredential = null,
    string httpClientName = "processor")
  {
    _httpClientFactory = httpClientFactory ?? throw new ArgumentNullException(nameof(httpClientFactory));
    _metadataEndpoint = !string.IsNullOrWhiteSpace(metadataEndpoint)
      ? metadataEndpoint
      : throw new ArgumentException("Metadata endpoint URL must be set.", nameof(metadataEndpoint));
    _authMode = (authMode ?? "api-key").Trim().ToLowerInvariant();
    _apiKey = apiKey ?? string.Empty;
    _azureAdScope = azureAdScope ?? string.Empty;
    _azureAdAudience = azureAdAudience ?? string.Empty;
    _tokenCredential = tokenCredential ?? new DefaultAzureCredential();
    _logger = logger ?? NullLogger<PythonClothingMetadataService>.Instance;
    _httpClientName = httpClientName;
  }

  public async Task<ClothingMetadata> ExtractMetadataAsync(
    BinaryData imageData,
    string mediaType,
    CancellationToken cancellationToken = default)
  {
    try
    {
      var client = _httpClientFactory.CreateClient(_httpClientName);
      using var request = BuildRequest(imageData, mediaType);
      await AttachAuthHeaderAsync(request.Headers, cancellationToken);
      AttachTracingHeaders(request.Headers);

      using var response = await client.SendAsync(request, cancellationToken);
      if (!response.IsSuccessStatusCode)
      {
        _logger.LogWarning(
          "Python metadata call failed for {StatusCode}: {ReasonPhrase}",
          (int)response.StatusCode,
          response.ReasonPhrase);
        return EmptyMetadata();
      }

      var body = await response.Content.ReadAsStringAsync(cancellationToken);
      var metadata = JsonSerializer.Deserialize<PythonMetadataResponse>(body);
      return metadata is null ? EmptyMetadata() : MapMetadata(metadata);
    }
    catch (Exception ex)
    {
      _logger.LogWarning(
        ex,
        "Python metadata extraction call failed; returning empty metadata.");
      return EmptyMetadata();
    }
  }

  private static ClothingMetadata EmptyMetadata() =>
    new ClothingMetadata(null, null, Array.Empty<string>(), Array.Empty<ClothingColour>());

  private HttpRequestMessage BuildRequest(BinaryData imageData, string mediaType)
  {
    var body = new MetadataRequest(
      "item",
      Convert.ToBase64String(imageData.ToMemory().ToArray()),
      string.IsNullOrWhiteSpace(mediaType) ? "image/jpeg" : mediaType);
    var json = JsonSerializer.Serialize(body);
    var content = new StringContent(json, Encoding.UTF8, "application/json");
    return new HttpRequestMessage(HttpMethod.Post, _metadataEndpoint) { Content = content };
  }

  private void AttachTracingHeaders(HttpRequestHeaders headers)
  {
    var traceParent = System.Diagnostics.Activity.Current?.Id;
    if (!string.IsNullOrWhiteSpace(traceParent))
    {
      headers.TryAddWithoutValidation("traceparent", traceParent);
    }

    var requestId = System.Diagnostics.Activity.Current?.TraceId.ToString();
    if (!string.IsNullOrWhiteSpace(requestId))
    {
      headers.TryAddWithoutValidation("X-Request-Id", requestId);
    }
  }

  private async Task AttachAuthHeaderAsync(HttpRequestHeaders headers, CancellationToken cancellationToken)
  {
    if (string.Equals(_authMode, "api-key", StringComparison.OrdinalIgnoreCase))
    {
      headers.Add("X-API-Key", _apiKey);
      return;
    }

    if (!string.Equals(_authMode, "azuread", StringComparison.OrdinalIgnoreCase))
    {
      _logger.LogWarning("Unsupported metadata auth mode: {AuthMode}", _authMode);
      return;
    }

    var token = await FetchAzureAccessTokenAsync(cancellationToken);
    if (!string.IsNullOrWhiteSpace(token))
    {
      headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
    }
  }

  private async Task<string> FetchAzureAccessTokenAsync(CancellationToken cancellationToken)
  {
    var scope = string.IsNullOrWhiteSpace(_azureAdScope)
      ? BuildDefaultScope(_azureAdAudience)
      : _azureAdScope;
    if (string.IsNullOrWhiteSpace(scope))
    {
      _logger.LogWarning("Metadata auth mode is azuread but no AzureAdScope or audience was configured.");
      return string.Empty;
    }

    var token = await _tokenCredential.GetTokenAsync(new TokenRequestContext([scope]), cancellationToken);
    return token.Token;
  }

  private static string BuildDefaultScope(string audience) =>
    string.IsNullOrWhiteSpace(audience)
      ? string.Empty
      : audience.Contains("/.default", StringComparison.OrdinalIgnoreCase)
        ? audience
        : $"{audience}/.default";

  private static ClothingMetadata MapMetadata(PythonMetadataResponse response)
  {
    var tags = response.Tags is null
      ? Array.Empty<string>()
      : response.Tags
        .Select(tag => tag?.Trim())
        .Where(IsValidTag)
        .Select(tag => tag!)
        .ToArray();

    var colours = response.Colours is null
      ? Array.Empty<ClothingColour>()
      : response.Colours
        .Select(c => ToColour(c))
        .Where(c => c is not null)
        .ToArray()!;

    return new ClothingMetadata(
      string.IsNullOrWhiteSpace(response.Brand) ? null : response.Brand.Trim(),
      string.IsNullOrWhiteSpace(response.Category) ? null : response.Category.Trim(),
      tags,
      colours);
  }

  private static bool IsValidTag(string? value) => !string.IsNullOrWhiteSpace(value);

  private static ClothingColour? ToColour(PythonColour? colour)
  {
    if (colour is null)
    {
      return null;
    }

    if (string.IsNullOrWhiteSpace(colour.Name) || string.IsNullOrWhiteSpace(colour.Hex))
    {
      return null;
    }

    return new ClothingColour(colour.Name.Trim(), colour.Hex.Trim());
  }

  private sealed record MetadataRequest(
    [property: JsonPropertyName("item_id")] string ItemId,
    [property: JsonPropertyName("image_bytes_base64")] string ImageBytesBase64,
    [property: JsonPropertyName("media_type")] string MediaType)
  ;

  private sealed record PythonMetadataResponse(
    [property: JsonPropertyName("brand")] string? Brand,
    [property: JsonPropertyName("category")] string? Category,
    [property: JsonPropertyName("tags")] string[]? Tags,
    [property: JsonPropertyName("colours")] PythonColour[]? Colours);

  private sealed record PythonColour(
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("hex")] string? Hex);
}
