export interface ClothingColour {
  name: string;
  hex: string;
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
