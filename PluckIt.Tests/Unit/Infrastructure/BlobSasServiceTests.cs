using PluckIt.Core;
using PluckIt.Infrastructure;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Shouldly;
using Xunit;

namespace PluckIt.Tests.Unit.Infrastructure;

[Trait("Category", "Unit")]
public sealed class BlobSasServiceTests
{
    private const string AccountName = "testaccount";
    private const string AccountKey = "0000000000000000000000000000000000000000000000000000000000000000";

    private static BlobSasService CreateSut(
        string archive = "archive",
        string uploads = "uploads",
        IDistributedCache? distributedCache = null) =>
        distributedCache is null
            ? new BlobSasService(AccountName, AccountKey, archive, uploads)
            : new BlobSasService(AccountName, AccountKey, archive, distributedCache, uploads);

    private static IDistributedCache CreateFallbackDistributedCache() =>
        new MemoryDistributedCache(Options.Create(new MemoryDistributedCacheOptions()));

    private static string BuildAssetUrl(string container, string file) =>
        $"https://{AccountName}.blob.core.windows.net/{container}/{file}";

    [Fact]
    public void Ctor_RejectsNullArchiveContainer()
    {
        Should.Throw<ArgumentNullException>(() => new BlobSasService(
            accountName: AccountName, accountKey: AccountKey, archiveContainer: null!));
    }

    [Fact]
    public void Ctor_WithAccountStorage_RejectsNullDistributedCache()
    {
        Should.Throw<ArgumentNullException>(() => new BlobSasService(
            AccountName,
            AccountKey,
            archiveContainer: "archive",
            distributedCache: null!));
    }

    [Fact]
    public void Ctor_WithConnectionString_RejectsNullDistributedCache()
    {
        Should.Throw<ArgumentNullException>(() => new BlobSasService(
            "UseDevelopmentStorage=true",
            archiveContainer: "archive",
            distributedCache: null!));
    }

    [Fact]
    public void GenerateSasUrl_NullOrWhitespaceReturnsInput()
    {
        var sut = CreateSut();
        sut.GenerateSasUrl(string.Empty).ShouldBe(string.Empty);
        sut.GenerateSasUrl("   ").ShouldBe("   ");
    }

    [Fact]
    public void GenerateSasUrl_RejectsInvalidUrl()
    {
        var sut = CreateSut();
        var bad = "not-a-url";
        sut.GenerateSasUrl(bad).ShouldBe(bad);
    }

    [Fact]
    public void GenerateSasUrl_RejectsContainerNotInAllowlist()
    {
        var sut = CreateSut(archive: "vault");
        var input = BuildAssetUrl("private", "item.jpg");
        sut.GenerateSasUrl(input).ShouldBe(input);
    }

    [Fact]
    public void GenerateSasUrl_AddsSasTokenForAllowedContainer()
    {
        var sut = CreateSut(archive: "archive");
        var input = BuildAssetUrl("archive", "item.jpg");
        var actual = sut.GenerateSasUrl(input);

        actual.ShouldContain("sv=");
        actual.ShouldStartWith(BuildAssetUrl("archive", "item.jpg"));
    }

    [Fact]
    public async Task GenerateSasUrl_CachesSasForAllowedContainer()
    {
        var sut = CreateSut(archive: "archive");
        var input = BuildAssetUrl("archive", "item.jpg");

        var first = sut.GenerateSasUrl(input, validForMinutes: 120);
        await Task.Delay(TimeSpan.FromSeconds(1.1));
        var second = sut.GenerateSasUrl(input, validForMinutes: 120);

        second.ShouldBe(first);
    }

    [Fact]
    public void GenerateSasUrl_CachesByValidityWindow()
    {
        var sut = CreateSut(archive: "archive");
        var input = BuildAssetUrl("archive", "item.jpg");

        var first = sut.GenerateSasUrl(input, validForMinutes: 120);
        var second = sut.GenerateSasUrl(input, validForMinutes: 121);

        second.ShouldNotBe(first);
    }

    [Fact]
    public void GenerateSasUrl_SharedDistributedCacheReusesTokensAcrossInstances()
    {
        var input = BuildAssetUrl("archive", "item.jpg");
        var sharedCache = CreateFallbackDistributedCache();

        var first = CreateSut(archive: "archive", distributedCache: sharedCache);
        var second = CreateSut(archive: "archive", distributedCache: sharedCache);

        var firstSas = first.GenerateSasUrl(input, validForMinutes: 120);
        var secondSas = second.GenerateSasUrl(input, validForMinutes: 120);

        firstSas.ShouldBe(secondSas);
    }

    [Fact]
    public void GenerateSasUrl_WhenCacheGetThrows_StillReturnsSas()
    {
        var input = BuildAssetUrl("archive", "item.jpg");
        var sut = CreateSut(archive: "archive", distributedCache: new ThrowingGetCache());

        var sas = sut.GenerateSasUrl(input);

        sas.ShouldContain("sv=");
    }

    [Fact]
    public void GenerateSasUrl_WhenCacheSetThrows_StillReturnsSas()
    {
        var input = BuildAssetUrl("archive", "item.jpg");
        var sut = CreateSut(archive: "archive", distributedCache: new ThrowingSetCache());

        var sas = sut.GenerateSasUrl(input);

        sas.ShouldContain("sv=");
    }

    [Fact]
    public async Task GenerateSasUrl_ShortExpiryDoesNotUseCache()
    {
        var sut = CreateSut(archive: "archive");
        var input = BuildAssetUrl("archive", "item.jpg");

        var first = sut.GenerateSasUrl(input, validForMinutes: 5);
        await Task.Delay(TimeSpan.FromSeconds(1.1));
        var second = sut.GenerateSasUrl(input, validForMinutes: 5);

        second.ShouldNotBe(first);
    }

    [Fact]
    public async Task DeleteBlobAsync_NoopForNullOrDisallowed()
    {
        var sut = CreateSut(archive: "archive");
        await Should.NotThrowAsync(async () => await sut.DeleteBlobAsync(""));
        await Should.NotThrowAsync(async () => await sut.DeleteBlobAsync(BuildAssetUrl("private", "item.jpg")));
    }

    [Fact]
    public async Task DeleteBlobAsync_InvalidUrlIsNoop()
    {
        var sut = CreateSut(archive: "archive");
        await Should.NotThrowAsync(async () =>
            await sut.DeleteBlobAsync("https://bad"));
    }

    [Fact]
    public async Task DownloadRawAsync_InvalidUrlThrowsArgumentException()
    {
        var sut = CreateSut(archive: "archive");
        await Should.ThrowAsync<ArgumentException>(async () =>
            await sut.DownloadRawAsync("https://bad"));
    }

    private sealed class ThrowingGetCache : IDistributedCache
    {
        public byte[]? Get(string key) => throw new InvalidOperationException("Simulated read failure.");

        public Task<byte[]?> GetAsync(string key, System.Threading.CancellationToken token = default) =>
            Task.FromException<byte[]?>(new InvalidOperationException("Simulated read failure."));

        public void Refresh(string key)
        {
        }

        public Task RefreshAsync(string key, System.Threading.CancellationToken token = default) =>
            Task.CompletedTask;

        public void Remove(string key)
        {
        }

        public Task RemoveAsync(string key, System.Threading.CancellationToken token = default) =>
            Task.CompletedTask;

        public void Set(string key, byte[] value, DistributedCacheEntryOptions options)
        {
        }

        public Task SetAsync(string key, byte[] value, DistributedCacheEntryOptions options,
            System.Threading.CancellationToken token = default) => Task.CompletedTask;
    }

    private sealed class ThrowingSetCache : IDistributedCache
    {
        public byte[]? Get(string key) => null;

        public Task<byte[]?> GetAsync(string key, System.Threading.CancellationToken token = default) =>
            Task.FromResult<byte[]?>(null);

        public void Refresh(string key)
        {
        }

        public Task RefreshAsync(string key, System.Threading.CancellationToken token = default) =>
            Task.CompletedTask;

        public void Remove(string key)
        {
        }

        public Task RemoveAsync(string key, System.Threading.CancellationToken token = default) =>
            Task.CompletedTask;

        public void Set(string key, byte[] value, DistributedCacheEntryOptions options)
        {
            throw new InvalidOperationException("Simulated write failure.");
        }

        public Task SetAsync(string key, byte[] value, DistributedCacheEntryOptions options,
            System.Threading.CancellationToken token = default) =>
            Task.FromException(new InvalidOperationException("Simulated write failure."));
    }
}
