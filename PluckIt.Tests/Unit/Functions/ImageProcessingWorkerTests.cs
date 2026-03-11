using System;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Moq.Protected;
using Shouldly;
using PluckIt.Core;
using PluckIt.Functions.Functions;
using PluckIt.Functions.Models;
using PluckIt.Functions.Serialization;
using PluckIt.Tests.Fakes;
using PluckIt.Tests.Helpers;
using Xunit;

namespace PluckIt.Tests.Unit.Functions;

[Trait("Category", "Unit")]
public sealed class ImageProcessingWorkerTests
{
    private readonly InMemoryWardrobeRepository _repo;
    private readonly FakeBlobSasService _sasService;
    private readonly FakeClothingMetadataService _metadataService;
    private static readonly JsonSerializerOptions DefaultSerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase
    };

    public ImageProcessingWorkerTests()
    {
        _repo = new InMemoryWardrobeRepository();
        _sasService = new FakeBlobSasService();
        _metadataService = new FakeClothingMetadataService();
    }

    private ImageProcessingWorker CreateSut(HttpMessageHandler httpHandler)
    {
        var httpFactory = TestFactory.CreateHttpClientFactory(httpHandler, "processor");
        return new ImageProcessingWorker(
            _repo,
            _sasService,
            _metadataService,
            httpFactory,
            TestFactory.NullLogger<ImageProcessingWorker>()
        );
    }

    private static HttpMessageHandler CreateMockHttp(HttpStatusCode statusCode, object? responseBody = null)
    {
        var mockHandler = new Mock<HttpMessageHandler>();

        mockHandler.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>()
            )
            .ReturnsAsync(() => new HttpResponseMessage
            {
                StatusCode = statusCode,
                Content = responseBody is not null
                    ? new StringContent(JsonSerializer.Serialize(responseBody, DefaultSerializerOptions))
                    : new StringContent("")
            });

        return mockHandler.Object;
    }

    // ── Pre-conditions & Idempotency ──────────────────────────────────────────

    [Fact]
    public async Task Run_InvalidJson_AcksMessageSilently()
    {
        var sut = CreateSut(CreateMockHttp(HttpStatusCode.OK));
        
        // This should not throw; it catches JSON exceptions and returns (ACK)
        await sut.Run("not-json");
        
        _repo.AllItems.ShouldBeEmpty();
    }

    [Fact]
    public async Task Run_NullMessage_AcksMessageSilently()
    {
        var sut = CreateSut(CreateMockHttp(HttpStatusCode.OK));
        
        await sut.Run("null");
        
        _repo.AllItems.ShouldBeEmpty();
    }

    [Fact]
    public async Task Run_DraftNotFound_Skips()
    {
        var sut = CreateSut(CreateMockHttp(HttpStatusCode.OK));
        var msg = new ImageProcessingMessage("missing", "user-1", "url", 0, DateTimeOffset.UtcNow);
        var json = JsonSerializer.Serialize(msg, PluckItJsonContext.Default.ImageProcessingMessage);

        await sut.Run(json);

        // Repo is untouched
        _repo.AllItems.ShouldBeEmpty();
    }

    [Fact]
    public async Task Run_DraftNotInProcessingState_SkipsDuplicate()
    {
        var draft = new ClothingItem 
        { 
            Id = "dup", 
            UserId = "user-1", 
            DraftStatus = DraftStatus.Ready 
        };
        _repo.WithItems(draft);

        var sut = CreateSut(CreateMockHttp(HttpStatusCode.OK));
        var msg = new ImageProcessingMessage("dup", "user-1", "url", 0, DateTimeOffset.UtcNow);
        var json = JsonSerializer.Serialize(msg, PluckItJsonContext.Default.ImageProcessingMessage);

        await sut.Run(json);

        // State should remain exactly as it was (no updates)
        _repo.AllItems[0].DraftStatus.ShouldBe(DraftStatus.Ready);
    }

    // ── Error Paths ───────────────────────────────────────────────────────────

    [Fact]
    public async Task Run_DownloadFails_MarkedFailed()
    {
        var draft = new ClothingItem { Id = "item", UserId = "user", DraftStatus = DraftStatus.Processing };
        _repo.WithItems(draft);

        // Create a throwing SAS service instead of the fake
        var badSas = new Mock<IBlobSasService>();
        badSas.Setup(s => s.DownloadRawAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
              .ThrowsAsync(new InvalidOperationException("Download failed"));

        var sut = new ImageProcessingWorker(
            _repo, badSas.Object, _metadataService,
            TestFactory.CreateHttpClientFactory(CreateMockHttp(HttpStatusCode.OK)),
            TestFactory.NullLogger<ImageProcessingWorker>());

        var msg = new ImageProcessingMessage("item", "user", "url", 0, DateTimeOffset.UtcNow);
        var json = JsonSerializer.Serialize(msg, PluckItJsonContext.Default.ImageProcessingMessage);

        await sut.Run(json);

        var updated = _repo.AllItems[0];
        updated.DraftStatus.ShouldBe(DraftStatus.Failed);
        var downloadError = updated.DraftError;
        downloadError.ShouldNotBeNull();
        downloadError.ShouldContain("download");
    }

    [Fact]
    public async Task Run_ProcessorReturnsError_MarkedFailed()
    {
        var draft = new ClothingItem { Id = "item", UserId = "user", DraftStatus = DraftStatus.Processing };
        _repo.WithItems(draft);
        _sasService.UploadedBlobs["test"] = new byte[] { 1, 2, 3 };

        // Mock HTTP returning 500 Internal Server Error
        var sut = CreateSut(CreateMockHttp(HttpStatusCode.InternalServerError));
        
        var msg = new ImageProcessingMessage("item", "user", "https://fake.blob/test", 0, DateTimeOffset.UtcNow);
        var json = JsonSerializer.Serialize(msg, PluckItJsonContext.Default.ImageProcessingMessage);

        await sut.Run(json);

        var updated = _repo.AllItems[0];
        updated.DraftStatus.ShouldBe(DraftStatus.Failed);
        var processorError = updated.DraftError;
        processorError.ShouldNotBeNull();
        processorError.ShouldContain("500");
    }

    // ── Happy Path ────────────────────────────────────────────────────────────

    [Fact]
    public async Task Run_HappyPath_MarkedReady()
    {
        var draft = new ClothingItem { Id = "item", UserId = "user", DraftStatus = DraftStatus.Processing };
        _repo.WithItems(draft);
        
        // Ensure SAS download succeeds
        _sasService.UploadedBlobs["raw-blob"] = new byte[] { 0x1, 0x2 };

        // Mock Processor response
        var processorRes = new ProcessorResult("fake-id", "https://processed.blob", "image/webp");
        var sut = CreateSut(CreateMockHttp(HttpStatusCode.OK, processorRes));

        // Let the FakeMetadataService return something
        _metadataService.Response = _metadataService.Response with { Brand = "Gucci" };

        var msg = new ImageProcessingMessage("item", "user", "https://fake.blob/raw-blob", 0, DateTimeOffset.UtcNow);
        var json = JsonSerializer.Serialize(msg, PluckItJsonContext.Default.ImageProcessingMessage);

        await sut.Run(json);

        var updated = _repo.AllItems[0];
        updated.DraftError.ShouldBeNull();
        updated.DraftStatus.ShouldBe(DraftStatus.Ready);
        updated.ImageUrl.ShouldBe("https://processed.blob");
        
        // The InMemoryWardrobeRepository stub ignores metadata, so we just verify the service was called
        _metadataService.CallCount.ShouldBe(1);
    }
}
