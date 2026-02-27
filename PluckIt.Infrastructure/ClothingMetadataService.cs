using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Azure.AI.OpenAI;
using OpenAI.Chat;
using PluckIt.Core;

namespace PluckIt.Infrastructure;

public class ClothingMetadataService : IClothingMetadataService
{
  private readonly ChatClient _chatClient;

  public ClothingMetadataService(AzureOpenAIClient client, string deploymentName)
  {
    if (client is null) throw new ArgumentNullException(nameof(client));
    if (deploymentName is null) throw new ArgumentNullException(nameof(deploymentName));
    _chatClient = client.GetChatClient(deploymentName);
  }

  public async Task<ClothingMetadata> ExtractMetadataAsync(string imageUrl, CancellationToken cancellationToken = default)
  {
    var systemPrompt =
      """
      You are an expert fashion analyst. Analyze the clothing item visible in the image.
      Return ONLY valid JSON — no markdown, no code fences, no extra text — with exactly these fields:
      {
        "brand": "<detected brand name or null>",
        "category": "<single category, e.g. T-Shirt, Jeans, Sneakers, Jacket, Dress, Hoodie, Shorts>",
        "tags": ["<descriptive tag>", ...],
        "colours": [{ "name": "<colour name>", "hex": "<#rrggbb>" }, ...]
      }
      For tags, use descriptive style/fit/season words (e.g. "casual", "slim fit", "summer", "streetwear").
      For colours, list the 1-3 main colours visible on the garment itself (ignore background).
      """;

    var messages = new ChatMessage[]
    {
      new SystemChatMessage(systemPrompt),
      new UserChatMessage(
        ChatMessageContentPart.CreateTextPart("Analyze this clothing item:"),
        ChatMessageContentPart.CreateImagePart(new Uri(imageUrl), ChatImageDetailLevel.Auto)),
    };

    var options = new ChatCompletionOptions { Temperature = 0.2f };

    var result = await _chatClient.CompleteChatAsync(messages, options, cancellationToken);

    var raw = result.Value.Content[0].Text?.Trim() ?? "{}";

    // Strip markdown code fences if model wraps response
    if (raw.StartsWith("```"))
    {
      var newline = raw.IndexOf('\n');
      var lastFence = raw.LastIndexOf("```");
      if (newline >= 0 && lastFence > newline)
        raw = raw[(newline + 1)..lastFence].Trim();
    }

    try
    {
      using var doc = JsonDocument.Parse(raw);
      var root = doc.RootElement;

      var brand = root.TryGetProperty("brand", out var b) && b.ValueKind == JsonValueKind.String
        ? b.GetString()
        : null;

      var category = root.TryGetProperty("category", out var c) && c.ValueKind == JsonValueKind.String
        ? c.GetString()
        : null;

      var tags = new List<string>();
      if (root.TryGetProperty("tags", out var tagsEl) && tagsEl.ValueKind == JsonValueKind.Array)
        foreach (var tag in tagsEl.EnumerateArray())
          if (tag.GetString() is string s)
            tags.Add(s);

      var colours = new List<ClothingColour>();
      if (root.TryGetProperty("colours", out var coloursEl) && coloursEl.ValueKind == JsonValueKind.Array)
        foreach (var col in coloursEl.EnumerateArray())
        {
          var name = col.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
          var hex = col.TryGetProperty("hex", out var h) ? h.GetString() ?? "" : "";
          if (!string.IsNullOrEmpty(name))
            colours.Add(new ClothingColour(name, hex));
        }

      return new ClothingMetadata(brand, category, tags, colours);
    }
    catch
    {
      // Fallback: return empty metadata rather than crashing the upload flow
      return new ClothingMetadata(null, null, Array.Empty<string>(), Array.Empty<ClothingColour>());
    }
  }
}
