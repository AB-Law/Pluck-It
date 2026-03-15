using PluckIt.Core;
using PluckIt.Infrastructure;
using Shouldly;
using Xunit;

namespace PluckIt.Tests.Unit.Infrastructure;

[Trait("Category", "Unit")]
public sealed class BlobSasServiceTests
{
    private const string AccountName = "testaccount";
    private const string AccountKey = "0000000000000000000000000000000000000000000000000000000000000000";

    private static BlobSasService CreateSut(string archive = "archive", string uploads = "uploads") =>
        new BlobSasService(AccountName, AccountKey, archive, uploads);

    [Fact]
    public void Ctor_RejectsNullArchiveContainer()
    {
        Should.Throw<ArgumentNullException>(() => new BlobSasService(
            accountName: AccountName, accountKey: AccountKey, archiveContainer: null!));
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
        var input = $"https://{AccountName}.blob.core.windows.net/private/item.jpg";
        sut.GenerateSasUrl(input).ShouldBe(input);
    }

    [Fact]
    public void GenerateSasUrl_AddsSasTokenForAllowedContainer()
    {
        var sut = CreateSut(archive: "archive");
        var input = $"https://{AccountName}.blob.core.windows.net/archive/item.jpg";
        var actual = sut.GenerateSasUrl(input);

        actual.ShouldContain("sv=");
        actual.ShouldStartWith($"https://{AccountName}.blob.core.windows.net/archive/item.jpg");
    }

    [Fact]
    public async Task DeleteBlobAsync_NoopForNullOrDisallowed()
    {
        var sut = CreateSut(archive: "archive");
        await Should.NotThrowAsync(async () => await sut.DeleteBlobAsync(""));
        await Should.NotThrowAsync(async () => await sut.DeleteBlobAsync($"https://{AccountName}.blob.core.windows.net/private/item.jpg"));
    }

    [Fact]
    public async Task DeleteBlobAsync_InvalidUrlIsNoop()
    {
        var sut = CreateSut(archive: "archive");
        await Should.NotThrowAsync(async () => await sut.DeleteBlobAsync("bad-url"));
    }

    [Fact]
    public async Task DownloadRawAsync_InvalidUrlThrowsArgumentException()
    {
        var sut = CreateSut(archive: "archive");
        await Should.ThrowAsync<ArgumentException>(async () =>
            await sut.DownloadRawAsync("https://bad"));
    }
}
