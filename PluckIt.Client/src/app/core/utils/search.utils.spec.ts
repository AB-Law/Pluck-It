import { ClothingItem } from '../models/clothing-item.model';
import { matchesItem } from './search.utils';

// ── Helpers ───────────────────────────────────────────────────────────────────

function item(overrides: Partial<ClothingItem> = {}): ClothingItem {
  return {
    id:                    'test-id',
    userId:                'user-1',
    imageUrl:              'https://example.com/img.png',
    tags:                  [],
    colours:               [],
    brand:                 null,
    category:              null,
    price:                 null,
    notes:                 null,
    dateAdded:             null,
    wearCount:             0,
    estimatedMarketValue:  null,
    purchaseDate:          null,
    condition:             null,
    aestheticTags:         null,
    ...overrides,
  };
}

// ── Empty / trivial queries ───────────────────────────────────────────────────

describe('matchesItem – empty / trivial', () => {
  it('returns true for an empty query', () => {
    expect(matchesItem(item(), '')).toBe(true);
  });

  it('returns true for a whitespace-only query', () => {
    expect(matchesItem(item(), '   ')).toBe(true);
  });

  it('returns false when no field matches and query is non-empty', () => {
    expect(matchesItem(item({ brand: 'Nike', category: 'Tops' }), 'zzzzz')).toBe(false);
  });
});

// ── Single-word queries ───────────────────────────────────────────────────────

describe('matchesItem – single word', () => {
  it('matches by brand (exact, case-insensitive)', () => {
    expect(matchesItem(item({ brand: 'Corteiz' }), 'corteiz')).toBe(true);
    expect(matchesItem(item({ brand: 'Corteiz' }), 'CORTEIZ')).toBe(true);
  });

  it('matches by brand substring', () => {
    expect(matchesItem(item({ brand: 'Nike ACG' }), 'acg')).toBe(true);
  });

  it('matches by colour name', () => {
    expect(matchesItem(item({ colours: [{ name: 'Black', hex: '#000' }] }), 'black')).toBe(true);
  });

  it('matches by colour name substring (e.g. "ack" in "Black")', () => {
    expect(matchesItem(item({ colours: [{ name: 'Black', hex: '#000' }] }), 'ack')).toBe(true);
  });

  it('does NOT match when colour is different', () => {
    expect(matchesItem(item({ colours: [{ name: 'White', hex: '#FFF' }] }), 'black')).toBe(false);
  });

  it('matches by category', () => {
    expect(matchesItem(item({ category: 'Tops' }), 'tops')).toBe(true);
  });

  it('matches by tag', () => {
    expect(matchesItem(item({ tags: ['denim', 'casual'] }), 'denim')).toBe(true);
  });

  it('matches by aesthetic tag', () => {
    expect(matchesItem(item({ aestheticTags: ['Streetwear'] }), 'street')).toBe(true);
  });

  it('matches by notes', () => {
    expect(matchesItem(item({ notes: 'bought at Harrods' }), 'harrods')).toBe(true);
  });
});

// ── Multi-word AND logic ──────────────────────────────────────────────────────

describe('matchesItem – multi-word (AND across fields)', () => {
  const blackCorteiz = item({
    brand:   'Corteiz',
    colours: [{ name: 'Black', hex: '#000' }],
    tags:    ['streetwear'],
  });

  it('"black corteiz" matches item with black colour + Corteiz brand', () => {
    expect(matchesItem(blackCorteiz, 'black corteiz')).toBe(true);
  });

  it('"corteiz black" (reversed order) also matches', () => {
    expect(matchesItem(blackCorteiz, 'corteiz black')).toBe(true);
  });

  it('"black nike" does NOT match a Corteiz item', () => {
    expect(matchesItem(blackCorteiz, 'black nike')).toBe(false);
  });

  it('"black corteiz streetwear" (3 words) matches when all three appear', () => {
    expect(matchesItem(blackCorteiz, 'black corteiz streetwear')).toBe(true);
  });

  it('"black corteiz formal" fails because "formal" is absent', () => {
    expect(matchesItem(blackCorteiz, 'black corteiz formal')).toBe(false);
  });

  it('matches two colour words when both colours are present', () => {
    const multiColour = item({
      colours: [{ name: 'Black', hex: '#000' }, { name: 'White', hex: '#FFF' }],
    });
    expect(matchesItem(multiColour, 'black white')).toBe(true);
  });

  it('matches colour + category', () => {
    const whiteTop = item({ category: 'Tops', colours: [{ name: 'White', hex: '#FFF' }] });
    expect(matchesItem(whiteTop, 'white tops')).toBe(true);
  });

  it('multi-word query does not match when only one word is present', () => {
    const onlyBlack = item({ colours: [{ name: 'Black', hex: '#000' }] });
    expect(matchesItem(onlyBlack, 'black corteiz')).toBe(false);
  });
});

// ── Null / missing fields ─────────────────────────────────────────────────────

describe('matchesItem – null / missing fields', () => {
  it('handles null brand gracefully', () => {
    expect(matchesItem(item({ brand: null }), 'nike')).toBe(false);
  });

  it('handles null colours gracefully', () => {
    expect(matchesItem(item({ colours: undefined as any }), 'black')).toBe(false);
  });

  it('handles missing aestheticTags gracefully', () => {
    expect(matchesItem(item({ aestheticTags: null }), 'luxe')).toBe(false);
  });

  it('handles empty tags array gracefully', () => {
    expect(matchesItem(item({ tags: [] }), 'denim')).toBe(false);
  });
});

// ── Extra whitespace ──────────────────────────────────────────────────────────

describe('matchesItem – whitespace handling', () => {
  it('handles multiple spaces between words', () => {
    const whiteNike = item({ brand: 'Nike', colours: [{ name: 'White', hex: '#FFF' }] });
    expect(matchesItem(whiteNike, 'white   nike')).toBe(true);
  });

  it('ignores leading/trailing spaces', () => {
    const nikeItem = item({ brand: 'Nike' });
    expect(matchesItem(nikeItem, '  nike  ')).toBe(true);
  });
});
