export interface ClothingColour {
  name: string;
  hex: string;
}

/**
 * Weather snapshot recorded at wear time.
 * Mirrors the C# WeatherSnapshot record.
 */
export interface WeatherSnapshot {
  tempCelsius: number;
  conditions: string; // e.g. "clear", "rain", "snow"
}

/**
 * A single wear event logged via PATCH /api/wardrobe/{id}/wear.
 * Mirrors the C# WearEvent record.
 */
export interface WearEvent {
  occurredAt: string;           // ISO 8601 UTC string
  occasion?: string | null;     // e.g. "casual", "work", "formal"
  weatherSnapshot?: WeatherSnapshot | null;
}

export interface WearLogPayload {
  clientEventId?: string | null;
  source?: string | null;
  occurredAt?: string | null;
  occasion?: string | null;
  stylingActivityId?: string | null;
  weatherSnapshot?: WeatherSnapshot | null;
}

export interface WearHistoryRecord {
  id: string;
  userId: string;
  itemId: string;
  occurredAt: string;
  source?: string | null;
  occasion?: string | null;
  weatherSnapshot?: WeatherSnapshot | null;
  stylingActivityId?: string | null;
  createdAt: string;
}

export interface WearHistorySummary {
  totalInRange: number;
  trackedFrom?: string | null;
  legacyUntrackedCount: number;
}

export interface WearHistoryResponse {
  itemId: string;
  events: WearHistoryRecord[];
  summary: WearHistorySummary;
}

export type StylingActivityType = 'AddedToStyleBoard';
export type WearSuggestionStatus = 'Pending' | 'Accepted' | 'Dismissed' | 'Expired';

export interface StylingActivityRequest {
  clientEventId?: string | null;
  itemId: string;
  activityType?: StylingActivityType;
  source?: string | null;
  occurredAt?: string | null;
}

export interface StylingActivityResponse {
  status: string;
  activityId: string;
}

export interface WearSuggestionItem {
  suggestionId: string;
  itemId: string;
  message: string;
  activityAt: string;
  expiresAt?: string | null;
}

export interface WearSuggestionsResponse {
  suggestions: WearSuggestionItem[];
}

export interface UpdateWearSuggestionStatusRequest {
  status: WearSuggestionStatus;
}

export interface UpdateWearSuggestionStatusResponse {
  status: string;
}

/**
 * Category-aware sizing. Only the relevant fields are set per category type:
 * - Tops / Knitwear / Outerwear / Dresses / Activewear / Swimwear / Underwear → letter
 * - Bottoms → waist + inseam
 * - Footwear → shoeSize
 * system is sourced from the user's profile preference.
 */
export interface ClothingSize {
  letter?: string | null;    // XS | S | M | L | XL | XXL | XXXL
  waist?: number | null;     // inches, e.g. 32
  inseam?: number | null;    // inches, e.g. 30
  shoeSize?: number | null;  // decimal, e.g. 10.5
  system?: string | null;    // US | EU | UK
}

/**
 * Structured price, stored in OriginalCurrency.
 * The UI converts to the user's preferred currency at display time.
 */
export interface ClothingPrice {
  amount: number;
  originalCurrency: string;  // ISO 4217, e.g. "USD" | "INR" | "GBP"
  purchaseDate?: string | null;
}

/** Subjective condition grade. Mirrors the C# ItemCondition enum. */
export type ItemCondition = 'New' | 'Excellent' | 'Good' | 'Fair';

export interface ClothingItem {
  id: string;
  userId?: string;
  imageUrl: string;
  tags: string[];
  colours: ClothingColour[];
  brand: string | null;
  category: string | null;

  /** Structured price object (replaces the old flat number). */
  price: ClothingPrice | null;

  notes: string | null;
  dateAdded: string | null;

  // ── Digital Vault analytics ─────────────────────────────────────────────
  wearCount: number;                // defaults to 0 on the server; may be absent in very old docs
  estimatedMarketValue: number | null;
  /** UTC timestamp of the most recent wear event. Null if never worn. */
  lastWornAt?: string | null;

  /**
   * Rolling log of the last ≤30 wear events.
   * Absent in documents created before the personalization graph feature.
   */
  wearEvents?: WearEvent[] | null;
  // ── Enrichment metadata ──────────────────────────────────────────────────
  purchaseDate: string | null;  // ISO date string, e.g. "2024-11-20"
  careInfo?: string[] | null;   // "dry_clean" | "wash" | "iron" | "bleach" — absent in old docs
  condition: ItemCondition | null;
  size?: ClothingSize | null;

  /**
   * Aesthetic / style tags set during enrichment, e.g. ["Formal", "Luxe", "Casual"].
   * Drives Digital Vault smart-group filtering.
   */
  aestheticTags?: string[] | null;
}

// ─── Wardrobe query / paging types ───────────────────────────────────────────

/** Sort field identifiers — must match C# WardrobeSortField allowlist exactly. */
export type WardrobeSortField = 'dateAdded' | 'wearCount' | 'price.amount';

/**
 * All filter, sort, and pagination parameters accepted by GET /api/wardrobe.
 * All fields are optional — omitted fields are not sent as query params.
 */
export interface WardrobeQuery {
  category?:          string | null;
  brand?:             string | null;
  condition?:         ItemCondition | null;
  tags?:              string[] | null;
  aestheticTags?:     string[] | null;
  priceMin?:          number | null;
  priceMax?:          number | null;
  minWears?:          number | null;
  maxWears?:          number | null;
  sortField?:         WardrobeSortField | null;
  sortDir?:           'asc' | 'desc' | null;
  pageSize?:          number | null;
  continuationToken?: string | null;
}

/**
 * Paged response envelope returned by GET /api/wardrobe.
 * Mirrors C# WardrobePagedResult (camelCase serialization).
 */
export interface WardrobePagedResponse {
  items:                  ClothingItem[];
  nextContinuationToken?: string | null;
}
