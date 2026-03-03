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
}

export type CpwBadgeLevel = 'unworn' | 'high' | 'medium' | 'low' | 'unknown';

export interface CpwIntelItem {
  itemId: string;
  cpw?: number | null;
  badge: CpwBadgeLevel;
  breakEvenReached: boolean;
  breakEvenTargetCpw: number;
  forecast?: CpwForecast | null;
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
