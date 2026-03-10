export interface BuyLink {
  platform: 'taobao' | 'yupoo' | 'weidian' | 'weidan' | '1688' | string;
  url: string;
  label?: string | null;
}

export interface ScrapedItem {
  id: string;
  sourceId: string;
  sourceType: 'reddit' | 'brand' | string;
  title: string;
  description: string;
  imageUrl: string;
  productUrl: string;
  tags: string[];
  buyLinks: BuyLink[];
  scoreSignal: number;      // our platform likes − dislikes (starts at 0)
  redditScore?: number;     // Reddit's own upvote count (provenance only)
  galleryImages?: string[]; // all images for gallery posts
  commentText?: string;     // top comment bodies (buy-link source)
  brand: string | null;
  price: string | null;
  scrapedAt: string;
  userId: string;
}

export interface ScraperSource {
  id: string;
  name: string;
  sourceType: 'reddit' | 'brand';
  isGlobal: boolean;
  isActive: boolean;
  config: Record<string, unknown>;
  createdAt: string;
}

export interface UserSourceSubscription {
  sourceId: string;
  userId: string;
  isActive: boolean;
}

export interface DiscoverFeedQuery {
  tags?: string[];
  sourceIds?: string[];
  sortBy?: 'score' | 'recent';
  timeRange?: '1h' | '1d' | '7d' | '30d' | 'all';
  pageSize?: number;
  continuationToken?: string | null;
}

export interface DiscoverFeedResponse {
  items: ScrapedItem[];
  nextContinuationToken?: string | null;
}

// Taste calibration
export interface QuizSession {
  id: string;
  userId: string;
  phase: 1 | 2;
  items: QuizCard[];
  isComplete: boolean;
  createdAt: string;
}

export interface QuizCard {
  id: string;
  imageUrl?: string;
  title: string;
  primaryMood?: string;
  tags: string[];
}

export interface QuizResponse {
  cardPrimaryMood?: string;
  scrapedItemId?: string;
  signal: 'up' | 'down';
}

export interface TasteProfile {
  styleKeywords: string[];
  brands: string[];
  inferredFrom: 'mood_cards' | 'images';
}
