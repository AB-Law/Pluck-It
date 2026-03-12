export interface ExpensiveUnwornItem {
  itemId: string;
  amount: number;
  currency: string;
}

export interface TopColorWearShare {
  color: string;
  pct: number;
}

export interface VaultBehavioralInsights {
  topColorWearShare?: TopColorWearShare | null;
  unworn90dPct?: number | null;
  mostExpensiveUnworn?: ExpensiveUnwornItem | null;
  sparseHistory?: boolean;
}

export interface CpwForecast {
  targetCpw: number;
  projectedMonth?: string | null;
  projectedWearsNeeded?: number | null;
  /**
   * Wear rate used for the projection window (wears per month).
   */
  recentWearRate?: number | null;
  /**
   * Wear rate across item lifetime (wears per month).
   */
  historicalWearRate?: number | null;
  /**
   * Direction of pace change between recent and historical wear rates.
   */
  wearRateTrend?: WearRateTrend;
}

export type CpwBadgeLevel = 'unworn' | 'high' | 'medium' | 'low' | 'unknown';
export type WearRateTrend = 'up' | 'down' | 'stable';

export interface CpwIntelItem {
  itemId: string;
  cpw?: number | null;
  badge: CpwBadgeLevel;
  breakEvenReached: boolean;
  breakEvenTargetCpw: number;
  forecast?: CpwForecast | null;
  /**
   * Wear rate used by the current rolling insight window.
   */
  recentWearRate?: number | null;
  /**
   * Wear rate calculated across the item's full ownership period.
   */
  historicalWearRate?: number | null;
  /**
   * Direction of pace change between recent and historical wear rates.
   */
  wearRateTrend?: WearRateTrend;
  /**
   * Recent minus historical wear-rate delta used for trend display.
   */
  wearRateDelta?: number | null;
  /**
   * Display label resolved on the client from wardrobe metadata (e.g. "Brand · Category").
   */
  itemLabel?: string | null;
  /**
   * Display image URL resolved on the client from wardrobe metadata.
   */
  imageUrl?: string | null;
}

export type CpwIntelPanelItem = CpwIntelItem;

export interface VaultInsightsPanelData extends Omit<VaultInsightsResponse, 'cpwIntel'> {
  cpwIntel: CpwIntelPanelItem[];
}

export interface VaultInsightsResponse {
  generatedAt: string;
  currency: string;
  insufficientData: boolean;
  fxDate?: string | null;
  conversionStatus?: string | null;
  behavioralInsights: VaultBehavioralInsights;
  cpwIntel: CpwIntelItem[];
}
