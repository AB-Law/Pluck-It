using System.Reflection;
using System.Text.Json;
using Azure;
using Azure.AI.OpenAI;
using Moq;
using OpenAI.Chat;
using PluckIt.Core;
using PluckIt.Infrastructure;
using Shouldly;
using Xunit;

namespace PluckIt.Tests.Unit.Infrastructure;

[Trait("Category", "Unit")]
public sealed class ClothingMetadataServiceTests
{
    private static readonly string[] ExpectedTags = { "cotton", "layered" };

    private static ClothingMetadata InvokeParseMetadata(string rawJson)
    {
        var method = typeof(ClothingMetadataService).GetMethod(
            "ParseMetadata",
            BindingFlags.NonPublic | BindingFlags.Static);
        method.ShouldNotBeNull();
        try
        {
            return method.Invoke(null, [rawJson]) as ClothingMetadata
                ?? throw new InvalidOperationException("Failed to invoke ParseMetadata.");
        }
        catch (System.Reflection.TargetInvocationException ex) when (ex.InnerException is not null)
        {
            throw ex.InnerException;
        }
    }

    private static string InvokeStripCodeFence(string rawJson)
    {
        var method = typeof(ClothingMetadataService).GetMethod(
            "StripCodeFence",
            BindingFlags.NonPublic | BindingFlags.Static);
        method.ShouldNotBeNull();
        try
        {
            return method.Invoke(null, [rawJson]) as string
                ?? throw new InvalidOperationException("Failed to invoke StripCodeFence.");
        }
        catch (System.Reflection.TargetInvocationException ex) when (ex.InnerException is not null)
        {
            throw ex.InnerException;
        }
    }

    private static bool IsSupportedMediaType(string mediaType)
    {
        var method = typeof(ClothingMetadataService).GetMethod(
            "IsSupportedMediaType",
            BindingFlags.NonPublic | BindingFlags.Static);
        method.ShouldNotBeNull();
        try
        {
            return (bool)(method.Invoke(null, [mediaType]) ?? false);
        }
        catch (System.Reflection.TargetInvocationException ex) when (ex.InnerException is not null)
        {
            throw ex.InnerException;
        }
    }

    [Fact]
    public void StripCodeFence_RemovesMarkdownFence()
    {
        const string fenced = """
            ```
            {"brand":"Acme","category":"Dresses"}
            ```
            """;

        var content = InvokeStripCodeFence(fenced);

        content.ShouldBe("""
            {"brand":"Acme","category":"Dresses"}
            """.Trim());
    }

    [Fact]
    public void ParseMetadata_ParsesValidJson()
    {
        const string raw = """
            {
              "brand": "Acme",
              "category": "Tops",
              "tags": ["cotton", "layered"],
              "colours": [{ "name": "White", "hex": "#FFFFFF" }]
            }
            """;
        var metadata = InvokeParseMetadata(raw);

        metadata.Brand.ShouldBe("Acme");
        metadata.Category.ShouldBe("Tops");
        metadata.Tags.ShouldBe(ExpectedTags);
        var colour = metadata.Colours.ShouldHaveSingleItem();
        colour.Name.ShouldBe("White");
        colour.Hex.ShouldBe("#FFFFFF");
    }

    [Fact]
    public void ParseMetadata_ThrowsOnInvalidJson()
    {
        Should.Throw<JsonException>(() => InvokeParseMetadata("not-json"));
    }

    [Fact]
    public void IsSupportedMediaType_RecognizesSupportedMediaType()
    {
        IsSupportedMediaType("image/jpeg").ShouldBeTrue();
        IsSupportedMediaType("image/webp").ShouldBeTrue();
        IsSupportedMediaType("video/mp4").ShouldBeFalse();
    }

    [Fact]
    public async Task ExtractMetadataAsync_ReturnsParsedMetadataFromOpenAi()
    {
        const string json = """
            ```json
            {
              "brand": "Acme",
              "category": "Accessories",
              "tags": ["cotton", "layered"],
              "colours": [{ "name": "White", "hex": "#FFFFFF" }]
            }
            ```
            """;

        var chatClient = new Mock<ChatClient>(MockBehavior.Strict);
        chatClient
            .Setup(c => c.CompleteChatAsync(
                It.IsAny<ChatMessage[]>(),
                It.IsAny<ChatCompletionOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(OpenAiTestHelpers.CreateChatCompletionResult(json));

        var openAi = new Mock<AzureOpenAIClient>(MockBehavior.Strict);
        openAi
            .Setup(c => c.GetChatClient("test-deployment"))
            .Returns(chatClient.Object);

        var sut = new ClothingMetadataService(openAi.Object, "test-deployment");
        var imageData = BinaryData.FromString("image bytes");

        var actual = await sut.ExtractMetadataAsync(imageData, "image/jpeg", CancellationToken.None);

        actual.Brand.ShouldBe("Acme");
        actual.Category.ShouldBe("Accessories");
        actual.Tags.ShouldBe(new[] { "cotton", "layered" });
        var colour = actual.Colours.ShouldHaveSingleItem();
        colour.Name.ShouldBe("White");
        colour.Hex.ShouldBe("#FFFFFF");
    }

    [Fact]
    public async Task ExtractMetadataAsync_MapsInvalidCategoryToUncategorised()
    {
        const string json = """
            ```json
            {
              "brand": "Acme",
              "category": "T-Shirt",
              "tags": ["cotton", "layered"],
              "colours": [{ "name": "White", "hex": "#FFFFFF" }]
            }
            ```
            """;

        var chatClient = new Mock<ChatClient>(MockBehavior.Strict);
        chatClient
            .Setup(c => c.CompleteChatAsync(
                It.IsAny<ChatMessage[]>(),
                It.IsAny<ChatCompletionOptions>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(OpenAiTestHelpers.CreateChatCompletionResult(json));

        var openAi = new Mock<AzureOpenAIClient>(MockBehavior.Strict);
        openAi
            .Setup(c => c.GetChatClient("test-deployment"))
            .Returns(chatClient.Object);

        var sut = new ClothingMetadataService(openAi.Object, "test-deployment");
        var imageData = BinaryData.FromString("image bytes");

        var actual = await sut.ExtractMetadataAsync(imageData, "image/jpeg", CancellationToken.None);

        actual.Category.ShouldBe("Uncategorised");
    }

    [Fact]
    public async Task ExtractMetadataAsync_UnsupportedMediaTypeReturnsEmptyMetadata()
    {
        var openAi = new Mock<AzureOpenAIClient>();
        var sut = new ClothingMetadataService(openAi.Object, "deployment");

        var actual = await sut.ExtractMetadataAsync(BinaryData.FromString("image"), "video/mp4", CancellationToken.None);

        actual.Brand.ShouldBeNull();
        actual.Category.ShouldBeNull();
        actual.Tags.ShouldBeEmpty();
        actual.Colours.ShouldBeEmpty();
        openAi.Verify(
            c => c.GetChatClient(It.IsAny<string>()),
            Times.Once);
    }

    [Fact]
    public async Task ExtractMetadataAsync_ReturnsEmptyMetadataOnOpenAiError()
    {
        var chatClient = new Mock<ChatClient>(MockBehavior.Strict);
        chatClient
            .Setup(c => c.CompleteChatAsync(
                It.IsAny<ChatMessage[]>(),
                It.IsAny<ChatCompletionOptions>(),
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("service error"));

        var openAi = new Mock<AzureOpenAIClient>(MockBehavior.Strict);
        openAi
            .Setup(c => c.GetChatClient("test-deployment"))
            .Returns(chatClient.Object);

        var sut = new ClothingMetadataService(openAi.Object, "test-deployment");
        var actual = await sut.ExtractMetadataAsync(BinaryData.FromString("image bytes"), "image/jpeg", CancellationToken.None);

        actual.Brand.ShouldBeNull();
        actual.Category.ShouldBeNull();
        actual.Tags.ShouldBeEmpty();
        actual.Colours.ShouldBeEmpty();
    }

}
