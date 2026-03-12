using System;
using System.Reflection;
using Azure;
using Azure.AI.OpenAI;
using Moq;
using OpenAI.Chat;
using System.ClientModel;
using System.ClientModel.Primitives;

namespace PluckIt.Tests.Unit.Infrastructure;

/// <summary>
/// Reflection-based helpers for constructing Azure OpenAI SDK return objects in tests.
/// </summary>
internal static class OpenAiTestHelpers
{
    /// <summary>
    /// Creates a synthetic <see cref="ClientResult{T}"/> containing a <see cref="ChatCompletion"/>
    /// with one choice and one content part containing <paramref name="content" />.
    /// </summary>
    public static ClientResult<ChatCompletion> CreateChatCompletionResult(string content)
    {
        var messageContent = new ChatMessageContent(content);

        var messageType = typeof(ChatCompletion).Assembly.GetType("OpenAI.Chat.InternalChatCompletionResponseMessage")
            ?? throw new InvalidOperationException("OpenAI internal message type missing.");
        var messageCtor = messageType.GetConstructors(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
            .Single(c => c.GetParameters().Length == 2);
        var internalMessage = messageCtor.Invoke(new object[] { messageContent, null })!;

        var choiceType = typeof(ChatCompletion).Assembly.GetType("OpenAI.Chat.InternalCreateChatCompletionResponseChoice")
            ?? throw new InvalidOperationException("OpenAI internal choice type missing.");
        var choiceCtor = choiceType.GetConstructors(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
            .First(c => c.GetParameters().Length == 4);
        var choice = choiceCtor.Invoke(new object[]
        {
            ChatFinishReason.Stop,
            0,
            internalMessage,
            null,
        })!;

        var choices = Array.CreateInstance(choiceType, 1);
        choices.SetValue(choice, 0);

        var completionCtor = typeof(ChatCompletion).GetConstructors(BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance)
            .First(c => c.GetParameters().Length == 4);
        var completion = completionCtor.Invoke(new object[]
        {
            "chat-id",
            choices,
            DateTimeOffset.UtcNow,
            "test-model",
        })!;

        var responseType = typeof(ClientResult<ChatCompletion>);
        var responseCtor = responseType.GetConstructors(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
            .Single(c => c.GetParameters().Length == 2);
        var mockResponse = new Mock<PipelineResponse>().Object;

        return (ClientResult<ChatCompletion>)responseCtor.Invoke(new object[] { completion, mockResponse })!;
    }
}
