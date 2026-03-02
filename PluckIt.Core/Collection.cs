using System;
using System.Collections.Generic;

namespace PluckIt.Core;

/// <summary>
/// A curated group of clothing items that can be shared with other users.
/// Partition key in Cosmos DB is <see cref="OwnerId"/>.
/// </summary>
public class Collection
{
    public string Id { get; set; } = default!;

    /// <summary>Google sub of the user who created this collection.</summary>
    public string OwnerId { get; set; } = string.Empty;

    public string Name { get; set; } = string.Empty;

    public string? Description { get; set; }

    /// <summary>When true the collection is discoverable / joinable via share link.</summary>
    public bool IsPublic { get; set; } = false;

    /// <summary>IDs of <see cref="ClothingItem"/> records that belong to this collection.</summary>
    public IReadOnlyCollection<string> ClothingItemIds { get; set; } = Array.Empty<string>();

    /// <summary>
    /// Google sub IDs of users (other than the owner) who have joined the collection.
    /// Used to build the "members who joined" display in the UI.
    /// </summary>
    public IReadOnlyCollection<string> MemberUserIds { get; set; } = Array.Empty<string>();

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}
