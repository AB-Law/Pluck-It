using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Azure.Cosmos;
using Microsoft.Azure.Functions.Worker;
using Moq;
using Shouldly;
using PluckIt.Functions.Functions;
using PluckIt.Tests.Fakes;
using PluckIt.Tests.Helpers;
using Xunit;

namespace PluckIt.Tests.Unit.Functions;

[Trait("Category", "Unit")]
public sealed class CleanupFunctionsTests
{
    private readonly Mock<CosmosClient> _mockClient;
    private readonly Mock<Container> _mockContainer;
    private readonly FakeBlobSasService _sasService;
    private readonly CleanupFunctions _sut;

    public CleanupFunctionsTests()
    {
        _mockClient = new Mock<CosmosClient>(MockBehavior.Strict);
        _mockContainer = new Mock<Container>(MockBehavior.Strict);

        // CleanupFunctions uses GetContainer with any db/container strings
        _mockClient.Setup(c => c.GetContainer(It.IsAny<string>(), It.IsAny<string>()))
                   .Returns(_mockContainer.Object);

        _sasService = new FakeBlobSasService();

        _sut = new CleanupFunctions(
            _sasService,
            _mockClient.Object,
            TestFactory.NullLogger<CleanupFunctions>()
        );
    }

    private TimerInfo CreateDummyTimer() => new TimerInfo
    {
        ScheduleStatus = new ScheduleStatus(),
        IsPastDue = false
    };

    /// <summary>
    /// Helper to mock the Cosmos query stream iterator so that it returns 
    /// a simulated JSON response containing the provided item IDs.
    /// Cosmos returns pages shaped roughly like { "Documents": [ {"id":"abc"}, ... ] }
    /// </summary>
    private void SetupCosmosQueryIterator(params string[] itemIds)
    {
        var docs = new List<string>();
        foreach (var id in itemIds)
        {
            docs.Add($$"""{"id":"{{id}}"}""");
        }
        var pageJson = $$"""{"Documents": [ {{string.Join(",", docs)}} ]}""";

        var mockStream = new MemoryStream(Encoding.UTF8.GetBytes(pageJson));
        var mockResponse = new Mock<ResponseMessage>();
        mockResponse.SetupGet(r => r.IsSuccessStatusCode).Returns(true);
        mockResponse.SetupGet(r => r.Content).Returns(mockStream);

        var mockIterator = new Mock<FeedIterator>();
        int hasMoreCalls = 0;
        mockIterator.SetupGet(i => i.HasMoreResults).Returns(() => hasMoreCalls++ < 1);
        mockIterator.Setup(i => i.ReadNextAsync(It.IsAny<CancellationToken>()))
                    .ReturnsAsync(mockResponse.Object);

        _mockContainer.Setup(c => c.GetItemQueryStreamIterator(
            It.IsAny<QueryDefinition>(),
            It.IsAny<string>(),
            It.IsAny<QueryRequestOptions>()))
            .Returns(mockIterator.Object);
    }

    [Fact]
    public async Task CleanUpOrphanBlobs_KnownBlob_IsSkipped()
    {
        // Cosmos knows about "item-123"
        SetupCosmosQueryIterator("item-123");

        // Storage has a blob named "item-123-transparent.png"
        _sasService.ArchiveBlobNames.Add("item-123-transparent.png");

        await _sut.CleanUpOrphanBlobs(CreateDummyTimer(), CancellationToken.None);

        // It should NOT be deleted because Cosmos has it
        _sasService.DeletedUrls.ShouldBeEmpty();
    }

    [Fact]
    public async Task CleanUpOrphanBlobs_OrphanBlob_IsDeleted()
    {
        // Cosmos knows about "item-123"
        SetupCosmosQueryIterator("item-123");

        // Storage has a blob named "orphan-999-transparent.png"
        _sasService.ArchiveBlobNames.Add("orphan-999-transparent.png");

        await _sut.CleanUpOrphanBlobs(CreateDummyTimer(), CancellationToken.None);

        // It should be deleted because Cosmos doesn't know about orphan-999
        _sasService.DeletedUrls.Count.ShouldBe(1);
        _sasService.DeletedUrls[0].ShouldContain("orphan-999-transparent.png");
    }

    [Fact]
    public async Task CleanUpOrphanBlobs_MixedBlobs_DeletesOnlyOrphans()
    {
        SetupCosmosQueryIterator("known-1", "known-2");
        _sasService.ArchiveBlobNames.AddRange(new[]
        {
            "known-1-transparent.png",
            "known-2-transparent.png",
            "orphan-7-transparent.png",
            "orphan-8-transparent.png"
        });

        await _sut.CleanUpOrphanBlobs(CreateDummyTimer(), CancellationToken.None);

        _sasService.DeletedUrls.Count.ShouldBe(2);
        _sasService.DeletedUrls.ShouldContain(url => url.Contains("orphan-7"));
        _sasService.DeletedUrls.ShouldContain(url => url.Contains("orphan-8"));
    }

    [Fact]
    public async Task CleanUpOrphanBlobs_EmptyStorage_NoOps()
    {
        SetupCosmosQueryIterator("some-item");
        // Storage has no blobs

        await _sut.CleanUpOrphanBlobs(CreateDummyTimer(), CancellationToken.None);

        _sasService.DeletedUrls.ShouldBeEmpty();
    }

    [Fact]
    public async Task CleanUpOrphanBlobs_CosmosQueryFails_AbortsWithNoDeletions()
    {
        // Cosmos throws an exception
        _mockContainer.Setup(c => c.GetItemQueryStreamIterator(
            It.IsAny<QueryDefinition>(),
            It.IsAny<string>(),
            It.IsAny<QueryRequestOptions>()))
            .Throws(new CosmosException("DB Down", System.Net.HttpStatusCode.ServiceUnavailable, 0, "", 0));

        // Let's pretend storage has blobs that MIGHT be orphans
        _sasService.ArchiveBlobNames.Add("potential-orphan-transparent.png");

        // The job runs and catches the exception
        await _sut.CleanUpOrphanBlobs(CreateDummyTimer(), CancellationToken.None);

        // But no deletes should have been issued because Cosmos read failed (fail-safe)
        _sasService.DeletedUrls.ShouldBeEmpty();
    }
}
