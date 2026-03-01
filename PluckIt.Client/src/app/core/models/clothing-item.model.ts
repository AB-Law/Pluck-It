export interface ClothingColour {
  name: string;
  hex: string;
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
}
