export interface Collection {
  id: string;
  ownerId: string;
  name: string;
  description?: string | null;
  isPublic: boolean;
  clothingItemIds: string[];
  memberUserIds: string[];
  createdAt: string; // ISO DateTimeOffset
}

/** Shape of the POST /api/collections body */
export interface CreateCollectionRequest {
  name: string;
  description?: string | null;
  isPublic: boolean;
  clothingItemIds: string[];
}
