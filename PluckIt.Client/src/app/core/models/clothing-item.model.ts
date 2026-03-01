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

export interface ClothingItem {
  id: string;
  userId?: string;
  imageUrl: string;
  tags: string[];
  colours: ClothingColour[];
  brand: string | null;
  category: string | null;
  price: number | null;
  notes: string | null;
  dateAdded: string | null;

  // User-enriched in the "Enrich Your Item" modal after upload
  purchaseDate: string | null;  // ISO date string, e.g. "2024-11-20"
  careInfo: string[];           // "dry_clean" | "wash" | "iron" | "bleach"
  condition: string | null;     // "New" | "Excellent" | "Good" | "Fair"
  size?: ClothingSize | null;
}
