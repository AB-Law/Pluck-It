namespace PluckIt.Core;

/// <summary>
/// Shared contract for the wardrobe image cleanup index container.
/// </summary>
public static class WardrobeImageCleanupIndex
{
    /// <summary>
    /// Environment setting that points to the cleanup index container.
    /// </summary>
    public const string ContainerSettingName = "Cosmos__ImageCleanupIndexContainer";

    /// <summary>
    /// Default name used when the setting is not provided.
    /// </summary>
    public const string DefaultContainerName = "WardrobeImageCleanupIndex";

    /// <summary>
    /// Constant partition key value used by all index documents.
    /// </summary>
    public const string PartitionKeyValue = "global";

    /// <summary>
    /// Partition key path for the Cosmos container.
    /// </summary>
    public const string PartitionKeyPath = "/partition";
}
