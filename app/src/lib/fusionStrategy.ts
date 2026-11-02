export interface FusionSnapshot {
  validated: boolean; status: string; fundamental_covered: number; macro_method: string; note: string;
  macro: { date: string; regime: string; regime_code: number; close: number; ma20: number; ma60: number; rsi: number };
  macro_forecast?: { horizons: Record<string, { direction: string; probability_up?: number; reliable: boolean }> };
  operations: { code: string; asof: string; action: string; technical: { signal: string; white: number; yellow: number; j: number; dif: number; volume_ratio5: number | null; reference_stop_adjusted: number }; fundamental: { status: string; reason?: string } }[];
}
export function fusionOf(adaptive: unknown): FusionSnapshot | undefined {
  return (adaptive as { fusion?: FusionSnapshot })?.fusion;
}
