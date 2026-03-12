using System.Text.Json;
using Azure.AI.OpenAI;
using Moq;
using OpenAI.Chat;
using PluckIt.Core;
using PluckIt.Infrastructure;
using Shouldly;
using Xunit;

namespace PluckIt.Tests.Unit.Infrastructure;

[Trait("Category", "Unit")]
public sealed class StylistServiceTests
{
    private static IReadOnlyCollection<ClothingItem> Wardrobe => new[]
    {
        new ClothingItem
        {
            Id = "item-1",
            UserId = "user-1",
            Brand = "Brand",
            Category = "Tops",
        },
    };

    private static StylistRequest Request => new()
    {
        StylePrompt = "minimal streetwear",
        Occasion = "workout",
        PreferredColors = ["blue", "black"],
        ExcludedColors = ["red"],
    };

    [Fact]
    public void Ctor_RejectsNullClient()
    {
        Should.Throw<ArgumentNullException>(() => new StylistService(null!, "deployment"));
    }

    [Fact]
    public void Ctor_RejectsNullDeployment()
    {
        var openAi = new Mock<AzureOpenAIClient>(MockBehavior.Strict);
        Should.Throw<ArgumentNullException>(() => new StylistService(openAi.Object, null!));
    }

    [Fact]
    public async Task GetRecommendationsAsync_ReturnsDeserializedOutfits()
    {
        var responseJson = """
            [
              {
                "id":"o1",
                "title":"Casual",
                "description":"A simple layered look.",
                "clothingItemIds":["item-1"]
              }
            ]
            """;

        var chatClient = new Mock<ChatClient>(MockBehavior.Strict);
        chatClient
            .Setup(c => c.CompleteChatAsync(
                It.IsAny<ChatMessage[]>(),
                It.IsAny<ChatCompletionOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(OpenAiTestHelpers.CreateChatCompletionResult(responseJson));

        var openAi = new Mock<AzureOpenAIClient>(MockBehavior.Strict);
        openAi
            .Setup(c => c.GetChatClient("test"))
            .Returns(chatClient.Object);

        var sut = new StylistService(openAi.Object, "test");
        var actual = await sut.GetRecommendationsAsync(Wardrobe, Request, CancellationToken.None);

        var list = actual.ShouldHaveSingleItem();
        list.Id.ShouldBe("o1");
        list.Title.ShouldBe("Casual");
        list.Description.ShouldBe("A simple layered look.");
        list.ClothingItemIds.ShouldContain("item-1");
    }

    [Fact]
    public async Task GetRecommendationsAsync_StripsCodeFence()
    {
        var responseJson = """
            ```
            [{ "id":"o1", "title":"Fenced", "description":"With fence", "clothingItemIds":["item-1"] }]
            ```
            """;
        var chatClient = new Mock<ChatClient>(MockBehavior.Strict);
        chatClient
            .Setup(c => c.CompleteChatAsync(
                It.IsAny<ChatMessage[]>(),
                It.IsAny<ChatCompletionOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(OpenAiTestHelpers.CreateChatCompletionResult(responseJson));

        var openAi = new Mock<AzureOpenAIClient>(MockBehavior.Strict);
        openAi
            .Setup(c => c.GetChatClient("test"))
            .Returns(chatClient.Object);

        var sut = new StylistService(openAi.Object, "test");
        var actual = await sut.GetRecommendationsAsync(Wardrobe, Request, CancellationToken.None);

        var list = actual.ShouldHaveSingleItem();
        list.Id.ShouldBe("o1");
    }

    [Fact]
    public async Task GetRecommendationsAsync_ReturnsEmptyWhenOpenAiReturnsInvalidJson()
    {
        var chatClient = new Mock<ChatClient>(MockBehavior.Strict);
        chatClient
            .Setup(c => c.CompleteChatAsync(
                It.IsAny<ChatMessage[]>(),
                It.IsAny<ChatCompletionOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(OpenAiTestHelpers.CreateChatCompletionResult("not-json"));

        var openAi = new Mock<AzureOpenAIClient>(MockBehavior.Strict);
        openAi
            .Setup(c => c.GetChatClient("test"))
            .Returns(chatClient.Object);

        var sut = new StylistService(openAi.Object, "test");
        await Should.ThrowAsync<JsonException>(async () =>
            await sut.GetRecommendationsAsync(Wardrobe, Request, CancellationToken.None));
    }

    [Fact]
    public async Task GetRecommendationsAsync_ReturnsEmptyWhenChatCallThrows()
    {
        var chatClient = new Mock<ChatClient>(MockBehavior.Strict);
        chatClient
            .Setup(c => c.CompleteChatAsync(
                It.IsAny<ChatMessage[]>(),
                It.IsAny<ChatCompletionOptions>(),
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new JsonException("bad response"));

        var openAi = new Mock<AzureOpenAIClient>(MockBehavior.Strict);
        openAi
            .Setup(c => c.GetChatClient("test"))
            .Returns(chatClient.Object);

        var sut = new StylistService(openAi.Object, "test");
        await Should.ThrowAsync<JsonException>(() =>
            sut.GetRecommendationsAsync(Wardrobe, Request, CancellationToken.None));
    }
}
