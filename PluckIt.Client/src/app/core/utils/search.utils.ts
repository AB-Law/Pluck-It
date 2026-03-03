import { ClothingItem } from '../models/clothing-item.model';

/**
 * Returns true if every whitespace-separated word in `query` appears (as a
 * case-insensitive substring) in at least one searchable field of `item`.
 *
 * Searchable fields: brand, category, notes, tags, aestheticTags, colour names.
 *
 * Examples:
 *   matchesItem(item, 'black')          → true if any colour is "Black"
 *   matchesItem(item, 'black cortiez')  → true if item has a black colour AND brand contains "cortiez"
 *   matchesItem(item, '')               → always true (no query)
 */
export function matchesItem(item: ClothingItem, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;

  const fields: string[] = [
    item.brand        ?? '',
    item.category     ?? '',
    item.notes        ?? '',
    ...(item.tags           ?? []),
    ...(item.aestheticTags  ?? []),
    ...(item.colours?.map(c => c.name) ?? []),
  ].map(f => f.toLowerCase());

  return trimmed
    .toLowerCase()
    .split(/\s+/)
    .every(word => fields.some(f => f.includes(word)));
}
