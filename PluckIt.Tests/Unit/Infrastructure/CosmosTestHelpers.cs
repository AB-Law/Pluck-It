using System.Net;
using Microsoft.Azure.Cosmos;
using Moq;

namespace PluckIt.Tests.Unit.Infrastructure;

/// <summary>
/// Shared test helpers for Cosmos iterator/response mocking in repository unit tests.
/// </summary>
public static class CosmosTestHelpers
{
    /// <summary>
    /// Creates a mocked <see cref="FeedResponse{T}"/> that enumerates the supplied items.
    /// </summary>
    public static Mock<FeedResponse<T>> CreateFeedResponse<T>(
        IReadOnlyList<T> items,
        string? continuationToken = null)
    {
        var response = new Mock<FeedResponse<T>>(MockBehavior.Strict);
        response.Setup(r => r.GetEnumerator()).Returns(() => items.GetEnumerator());
        response.As<IEnumerable<T>>().Setup(r => r.GetEnumerator()).Returns(() => items.GetEnumerator());
        response.SetupGet(r => r.Resource).Returns(items);
        response.SetupGet(r => r.Count).Returns(items.Count);
        response.SetupGet(r => r.ContinuationToken).Returns(continuationToken);

        return response;
    }

    /// <summary>
    /// Creates a mocked <see cref="FeedIterator{T}"/> that returns pages in order.
    /// </summary>
    public static Mock<FeedIterator<T>> CreateQueryIterator<T>(
        params (IReadOnlyList<T> Items, string? ContinuationToken)[] pages)
    {
        var responses = pages
            .Select(p => CreateFeedResponse(p.Items, p.ContinuationToken).Object)
            .ToArray();

        var index = 0;
        var iterator = new Mock<FeedIterator<T>>(MockBehavior.Strict);
        iterator.SetupGet(i => i.HasMoreResults).Returns(() => index < responses.Length);
        iterator
            .Setup(i => i.ReadNextAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(() => responses[index++]);

        return iterator;
    }

    /// <summary>
    /// Creates a mocked single-page query iterator.
    /// </summary>
    public static Mock<FeedIterator<T>> CreateQueryIterator<T>(IReadOnlyList<T> page)
    {
        return CreateQueryIterator((page, null));
    }

    /// <summary>
    /// Creates a mocked Cosmos read response with the expected resource payload.
    /// </summary>
    public static Mock<ItemResponse<T>> CreateItemResponse<T>(T resource)
    {
        var response = new Mock<ItemResponse<T>>(MockBehavior.Strict);
        response.SetupGet(r => r.Resource).Returns(resource);
        return response;
    }

    /// <summary>
    /// Creates a mocked Cosmos HTTP exception with the specified status code.
    /// </summary>
    public static CosmosException CreateCosmosException(HttpStatusCode statusCode) =>
        new("Mocked Cosmos exception", statusCode, (int)statusCode, "mock", 0.0);
}
