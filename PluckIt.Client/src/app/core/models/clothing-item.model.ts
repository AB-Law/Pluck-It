export interface ClothingColour {
  name: string;
  hex: string;
}

export interface ClothingItem {
  id: string;
  imageUrl: string;
  tags: string[];
  colours: ClothingColour[];
  brand: string | null;
  category: string | null;
  price: number | null;
  notes: string | null;
  dateAdded: string | null;
}
