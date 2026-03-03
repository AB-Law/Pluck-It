/** Feedback signal sent to POST /api/digest/feedback. */
export type FeedbackSignal = 'up' | 'down';

/** Request body for POST /api/digest/feedback. */
export interface DigestFeedbackRequest {
  digestId: string;
  suggestionIndex: number;
  /** Human-readable description copied from the suggestion for storage (aids LLM prompting). */
  suggestionDescription?: string;
  signal: FeedbackSignal;
}

/** A single purchase suggestion within a digest, including its AI-generated rationale. */
export interface DigestSuggestion {
  item: string;
  rationale: string;
}

/** Full digest document returned by GET /api/digest/latest. */
export interface WardrobeDigest {
  id: string;
  userId: string;
  generatedAt: string;          // ISO 8601 UTC
  wardrobeHash: string;
  suggestions: DigestSuggestion[];
  stylesConsidered: string[];
  totalItems: number;
  itemsWithWearHistory?: number | null;
  climateZone?: string | null;
}
