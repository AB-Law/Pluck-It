using System.Net;
using Microsoft.Azure.Cosmos;
using Moq;
using PluckIt.Core;
using PluckIt.Infrastructure;
using Shouldly;
using Xunit;

namespace PluckIt.Tests.Unit.Infrastructure;

[Trait("Category", "Unit")]
public sealed class UserProfileRepositoryTests
{
    private const string DatabaseName = "test-db";
    private const string ContainerName = "user-profiles";

    private readonly Mock<CosmosClient> _mockClient = new(MockBehavior.Strict);
    private readonly Mock<Container> _mockContainer = new(MockBehavior.Strict);
    private readonly UserProfileRepository _sut;

    public UserProfileRepositoryTests()
    {
        _mockClient.Setup(c => c.GetContainer(DatabaseName, ContainerName)).Returns(_mockContainer.Object);
        _sut = new UserProfileRepository(_mockClient.Object, DatabaseName, ContainerName);
    }

    private static UserProfile CreateProfile(string id) =>
        new()
        {
            Id = id,
            CurrencyCode = "USD",
            PreferredColours = ["blue", "black"],
        };

    [Fact]
    public void Ctor_RejectsNullClient()
    {
        Should.Throw<ArgumentNullException>(() => new UserProfileRepository(null!, DatabaseName, ContainerName));
    }

    [Fact]
    public void Ctor_RejectsNullDatabase()
    {
        Should.Throw<ArgumentNullException>(() => new UserProfileRepository(new Mock<CosmosClient>().Object, null!, ContainerName));
    }

    [Fact]
    public void Ctor_RejectsNullContainer()
    {
        Should.Throw<ArgumentNullException>(() => new UserProfileRepository(new Mock<CosmosClient>().Object, DatabaseName, null!));
    }

    [Fact]
    public async Task GetAsync_ReturnsProfileWhenPresent()
    {
        var profile = CreateProfile("user-1");
        _mockContainer
            .Setup(c => c.ReadItemAsync<UserProfile>(
                "user-1",
                new PartitionKey("user-1"),
                null,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(CosmosTestHelpers.CreateItemResponse(profile).Object);

        var actual = await _sut.GetAsync("user-1", CancellationToken.None);

        actual.ShouldNotBeNull();
        actual!.Id.ShouldBe(profile.Id);
    }

    [Fact]
    public async Task GetAsync_ReturnsNullWhenNotFound()
    {
        _mockContainer
            .Setup(c => c.ReadItemAsync<UserProfile>(
                "missing",
                new PartitionKey("missing"),
                null,
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(CosmosTestHelpers.CreateCosmosException(HttpStatusCode.NotFound));

        var actual = await _sut.GetAsync("missing", CancellationToken.None);

        actual.ShouldBeNull();
    }

    [Fact]
    public async Task UpsertAsync_ForwardsToCosmos()
    {
        var profile = CreateProfile("user-2");
        _mockContainer
            .Setup(c => c.UpsertItemAsync(profile, new PartitionKey("user-2"), null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(CosmosTestHelpers.CreateItemResponse(profile).Object);

        await _sut.UpsertAsync(profile, CancellationToken.None);

        _mockContainer.Verify(
            c => c.UpsertItemAsync(profile, new PartitionKey("user-2"), null, It.IsAny<CancellationToken>()),
            Times.Once);
    }
}
