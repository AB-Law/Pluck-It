using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using PluckIt.Functions.Models;
using PluckIt.Functions.Queue;

namespace PluckIt.Tests.Fakes;

/// <summary>
/// In-memory fake for <see cref="IImageJobQueue"/> used in unit tests.
/// Captures enqueued messages so tests can assert on them.
/// </summary>
public sealed class FakeImageJobQueue : IImageJobQueue
{
    private readonly List<ImageProcessingMessage> _messages = [];

    public IReadOnlyList<ImageProcessingMessage> EnqueuedMessages => _messages;

    public Task EnqueueAsync(ImageProcessingMessage message, CancellationToken ct = default)
    {
        _messages.Add(message);
        return Task.CompletedTask;
    }
}
