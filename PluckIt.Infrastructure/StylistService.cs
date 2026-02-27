using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Azure;
using Azure.AI.OpenAI;
using PluckIt.Core;

namespace PluckIt.Infrastructure;

public class StylistService : IStylistService
{
  private readonly OpenAIClient _client;
  private readonly string _deploymentName;

  public StylistService(OpenAIClient client, string deploymentName)
  {
    _client = client ?? throw new ArgumentNullException(nameof(client));
    _deploymentName = deploymentName ?? throw new ArgumentNullException(nameof(deploymentName));
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

    var chatOptions = new ChatCompletionsOptions
    {
      Temperature = 0.7f,
      DeploymentName = _deploymentName,
    };

    chatOptions.Messages.Add(new ChatRequestSystemMessage(systemPrompt));
    chatOptions.Messages.Add(new ChatRequestUserMessage(userPrompt));

    Response<ChatCompletions> response =
      await _client.GetChatCompletionsAsync(chatOptions);

    var content = response.Value.Choices[0].Message.Content;

    try
    {
      var outfits = JsonSerializer.Deserialize<List<OutfitRecommendation>>(
        content,
        new JsonSerializerOptions
        {
          PropertyNameCaseInsensitive = true
        });

      return (IReadOnlyCollection<OutfitRecommendation>)(outfits ?? new List<OutfitRecommendation>());
    }
    catch
    {
      return Array.Empty<OutfitRecommendation>();
    }
  }
}

