using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Azure.AI.OpenAI;
using OpenAI.Chat;
using PluckIt.Core;

namespace PluckIt.Infrastructure;

public class StylistService : IStylistService
{
  private readonly ChatClient _chatClient;

  public StylistService(AzureOpenAIClient client, string deploymentName)
  {
    if (client is null) throw new ArgumentNullException(nameof(client));
    if (deploymentName is null) throw new ArgumentNullException(nameof(deploymentName));
    _chatClient = client.GetChatClient(deploymentName);
  }

  public async Task<IReadOnlyCollection<OutfitRecommendation>> GetRecommendationsAsync(
    IEnumerable<ClothingItem> wardrobe,
    StylistRequest request,
    CancellationToken cancellationToken = default)
  {
    var systemPrompt =
      """
      You are a personal stylist. Create versatile outfit recommendations using the user's digital wardrobe.
      The user can ask for any aesthetic, occasion, or mood (for example: minimalist, date night, office, streetwear, cozy, etc.).
      Respond with a compact JSON array where each element has:
      - id: short identifier
      - title: short title
      - description: 1-3 sentence explanation of the outfit
      - clothingItemIds: array of ClothingItem ids from the wardrobe to use
      """;

    var wardrobeSummary = JsonSerializer.Serialize(wardrobe, new JsonSerializerOptions
    {
      PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    });

    var userPrompt =
      $"""
      Wardrobe (JSON):
      {wardrobeSummary}

      Request:
      StylePrompt: {request.StylePrompt}
      Occasion: {request.Occasion}
      PreferredColors: {string.Join(", ", request.PreferredColors ?? Array.Empty<string>())}
      ExcludedColors: {string.Join(", ", request.ExcludedColors ?? Array.Empty<string>())}

      Return ONLY a JSON array of outfit objects as described, with no extra commentary.
      """;

    var messages = new ChatMessage[]
    {
      new SystemChatMessage(systemPrompt),
      new UserChatMessage(userPrompt),
    };

    var options = new ChatCompletionOptions { Temperature = 0.7f };

    ChatCompletion result = await _chatClient.CompleteChatAsync(messages, options, cancellationToken);

    var content = result.Content[0].Text;

    // GPT often wraps JSON in a markdown code fence — strip it
    var json = content.Trim();
    if (json.StartsWith("```"))
    {
      var firstNewline = json.IndexOf('\n');
      var lastFence = json.LastIndexOf("```");
      if (firstNewline >= 0 && lastFence > firstNewline)
        json = json[(firstNewline + 1)..lastFence].Trim();
    }

    var outfits = JsonSerializer.Deserialize<List<OutfitRecommendation>>(
      json,
      new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

    return outfits ?? new List<OutfitRecommendation>();
  }
}

