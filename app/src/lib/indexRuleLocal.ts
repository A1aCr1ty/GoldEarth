export interface LocalRuleMetrics {
  start: string;
  end: string;
  total_return: number;
  annual_return: number;
  max_drawdown: number;
  trades: number;
  sell_trades: number;
  win_rate: number | null;
  buyhold50_return: number;
  buyhold100_return: number;
}

export interface LocalGridResult extends LocalRuleMetrics {
  open_grids: number;
  retained_shares: number;
  protection_days: number;
  latest: {
    date: string;
    close: number;
    lower: number;
    upper: number;
    step_pct: number;
    current_weight: number;
    next_buy_price: number;
    next_sell_price: number;
    next_action: string;
    break_protection: boolean;
  };
}

export interface LocalOversoldResult extends LocalRuleMetrics {
  bias_threshold: number;
  stop_pct: number;
  right_adds: number;
  stop_exits: number;
  swing_round_trips: number;
  latest: {
    date: string;
    bias20: number;
    wr14: number;
    cmf20: number;
    price_percentile: number | null;
    base_current_weight: number;
    swing_current_weight: number;
    swing_average_cost: number | null;
    entry_low: number | null;
    right_added: boolean;
    next_action: string;
  };
}

export interface LocalNatrMetrics extends LocalRuleMetrics {
  period: number;
  step: number;
  latest: {
    date: string;
    close: number;
    center: number;
    atr: number;
    natr: number;
    current_weight: number;
    target_weight: number;
    next_buy_price: number;
    next_sell_price: number;
    next_action: string;
    regime: string;
  };
}
export interface LocalNatrResult {
  training: LocalNatrMetrics | null;
  selected: LocalNatrMetrics;
  grid_only: LocalNatrMetrics;
  baseline: LocalNatrMetrics;
}

export interface LocalIndexRuleResult {
  code: string;
  grid: LocalGridResult;
  oversold: LocalOversoldResult;
  natr: LocalNatrResult | null;
}
