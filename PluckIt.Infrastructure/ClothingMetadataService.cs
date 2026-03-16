using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Azure.AI.OpenAI;
using OpenAI.Chat;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using PluckIt.Core;

namespace PluckIt.Infrastructure;

public class ClothingMetadataService : IClothingMetadataService
{
  private readonly ChatClient _chatClient;
  private readonly ILogger<ClothingMetadataService> _logger;
  private const string UncategorisedCategory = "Uncategorised";

  public ClothingMetadataService(AzureOpenAIClient client, string deploymentName)
    : this(client, deploymentName, NullLogger<ClothingMetadataService>.Instance)
  {
  }

  public ClothingMetadataService(
    AzureOpenAIClient client,
    string deploymentName,
    ILogger<ClothingMetadataService>? logger)
  {
    if (client is null) throw new ArgumentNullException(nameof(client));
    if (deploymentName is null) throw new ArgumentNullException(nameof(deploymentName));
    _chatClient = client.GetChatClient(deploymentName);
    _logger = logger ?? NullLogger<ClothingMetadataService>.Instance;
  }

  private static readonly HashSet<string> _allowedCategories = new(StringComparer.OrdinalIgnoreCase)
  {
    "Tops", "Bottoms", "Outerwear", "Footwear", "Accessories",
    "Knitwear", "Dresses", "Activewear", "Swimwear", "Underwear",
  };

  // Azure OpenAI vision only accepts these four MIME types.
  private static readonly HashSet<string> _supportedMediaTypes = new(StringComparer.OrdinalIgnoreCase)
  {
    "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp",
  };

  public async Task<ClothingMetadata> ExtractMetadataAsync(BinaryData imageData, string mediaType, CancellationToken cancellationToken = default)
  {
    if (!IsSupportedMediaType(mediaType))
      return EmptyMetadata();

    try
    {
      var raw = await FetchMetadataTextAsync(imageData, mediaType, cancellationToken);
      var normalized = StripCodeFence(raw);
      var metadata = ParseMetadata(normalized);
      return EnsureAllowedCategory(metadata);
    }
    catch
    {
      return EmptyMetadata();
    }
  }

  private static bool IsSupportedMediaType(string mediaType) =>
    _supportedMediaTypes.Contains(mediaType);

  private async Task<string> FetchMetadataTextAsync(BinaryData imageData, string mediaType,
      CancellationToken cancellationToken)
  {
    var messages = BuildChatMessages(imageData, mediaType);
    var options = new ChatCompletionOptions { Temperature = 0.2f };
    var result = await _chatClient.CompleteChatAsync(messages, options, cancellationToken);
    return result.Value.Content[0].Text?.Trim() ?? "{}";
  }

  private static ChatMessage[] BuildChatMessages(BinaryData imageData, string mediaType)
  {
    return new ChatMessage[]
    {
      new SystemChatMessage(MetadataSystemPrompt),
      new UserChatMessage(
        ChatMessageContentPart.CreateTextPart("Analyze this clothing item:"),
        ChatMessageContentPart.CreateImagePart(imageData, mediaType)),
    };
  }

  private static string StripCodeFence(string raw)
  {
    if (!raw.StartsWith("```"))
      return raw;

    var newline = raw.IndexOf('\n');
    var lastFence = raw.LastIndexOf("```");
    if (newline < 0 || lastFence <= newline)
      return raw;

    return raw[(newline + 1)..lastFence].Trim();
  }

  private static ClothingMetadata ParseMetadata(string rawJson)
  {
    using var doc = JsonDocument.Parse(rawJson);
    var root = doc.RootElement;

    return new ClothingMetadata(
      GetOptionalString(root, "brand"),
      GetOptionalString(root, "category"),
      ReadTags(root),
      ReadColours(root));
  }

  private ClothingMetadata EnsureAllowedCategory(ClothingMetadata metadata)
  {
    if (IsCategoryAllowed(metadata.Category))
      return metadata;

    _logger.LogWarning(
      "LLM returned unexpected category '{Category}'. Falling back to {FallbackCategory}.",
      metadata.Category ?? "<null>",
      UncategorisedCategory);

    return metadata with { Category = UncategorisedCategory };
  }

  private static bool IsCategoryAllowed(string? category) =>
    _allowedCategories.Contains(category ?? string.Empty);

  private static string? GetOptionalString(JsonElement root, string propertyName)
  {
    return root.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.String
      ? value.GetString()
      : null;
  }

  private static List<string> ReadTags(JsonElement root)
  {
    var tags = new List<string>();
    if (!root.TryGetProperty("tags", out var tagsEl) || tagsEl.ValueKind != JsonValueKind.Array)
      return tags;

    foreach (var tag in tagsEl.EnumerateArray())
    {
      if (tag.GetString() is string s)
        tags.Add(s);
    }

    return tags;
  }

  private static List<ClothingColour> ReadColours(JsonElement root)
  {
    var colours = new List<ClothingColour>();
    if (!root.TryGetProperty("colours", out var coloursEl) || coloursEl.ValueKind != JsonValueKind.Array)
      return colours;

    foreach (var col in coloursEl.EnumerateArray())
    {
      var name = GetOptionalString(col, "name") ?? "";
      var hex = GetOptionalString(col, "hex") ?? "";
      if (!string.IsNullOrEmpty(name))
        colours.Add(new ClothingColour(name, hex));
    }

    return colours;
  }

  private static ClothingMetadata EmptyMetadata() =>
    new(null, null, Array.Empty<string>(), Array.Empty<ClothingColour>());

  private static string MetadataSystemPrompt => """
    You are an expert fashion analyst. Analyze the clothing item visible in the image.
    Return ONLY valid JSON — no markdown, no code fences, no extra text — with exactly these fields:
    {
      "brand": "<detected brand name, or null if not visible>",
      "category": "<one value from the allowed list>",
      "tags": ["<tag>", ...],
      "colours": [{ "name": "<colour name>", "hex": "<#rrggbb>" }, ...]
    }

    Allowed category values (pick the single best match, use exact casing):
    Tops, Bottoms, Outerwear, Footwear, Accessories, Knitwear, Dresses, Activewear, Swimwear, Underwear

    For tags, be thorough — include ALL of the following that apply (lowercase, concise):
      • Brand name (e.g. "dior", "nike", "zara") — always include if brand is detected
      • Category synonym (e.g. "t-shirt", "tee", "jeans", "hoodie", "sneakers")
      • Material / fabric (e.g. "cotton", "denim", "leather", "mesh", "linen", "polyester")
      • Pattern / print (e.g. "solid", "striped", "plaid", "graphic", "floral", "logo print",
        "camo", "tie-dye", "animal print")
      • Fit / silhouette (e.g. "slim fit", "oversized", "relaxed", "cropped", "baggy", "fitted")
      • Style / vibe (e.g. "streetwear", "casual", "formal", "smart casual", "workwear",
        "athletic", "vintage", "preppy", "bohemian", "minimalist")
      • Occasion (e.g. "everyday", "gym", "office", "evening", "beach", "party")
      • Season (e.g. "summer", "winter", "all-season") if clearly suited to one season
      • Notable details (e.g. "short sleeve", "long sleeve", "zip-up", "button-down",
        "distressed", "embroidered", "mesh panel", "high-top", "low-top")
      • Any visible text, graphic, or motif (e.g. "band tee", "logo tee", "slogan")
    Aim for 6–12 tags. More specific tags make the item easier to find later.

    For colours, list the 1-3 main colours visible on the garment itself (ignore background).
    """;
}
