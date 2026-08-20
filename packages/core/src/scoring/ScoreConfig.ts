export interface ScoreConfig {
  version: string;
  weights: {
    financialValue: number;
    dealQuality: number;
    trust: number;
    fulfillment: number;
    demand: number;
  };
  thresholds: {
    minDataCoverage: number; // e.g. 0.5 (50%)
    minScoreForEligibility: number; // e.g. 50.0
    priceDropBpsThreshold: number; // e.g. 500 (5%)
  };
  caps: {
    maxCommissionCents: number; // Saturation point for absolute commission (e.g. 20000 = R$200)
    maxCommissionBps: number; // Saturation point for percentage (e.g. 1500 = 15%)
  };
}

export const LIA_SCORE_V1_CONFIG: ScoreConfig = {
  version: "lia-score-v1",
  weights: {
    financialValue: 35,
    dealQuality: 25,
    trust: 15,
    fulfillment: 15,
    demand: 10,
  },
  thresholds: {
    minDataCoverage: 0.6, // Requires at least 60% of signals available
    minScoreForEligibility: 40.0,
    priceDropBpsThreshold: 500, // 5% minimum drop to consider it a new event
  },
  caps: {
    maxCommissionCents: 15000, // R$ 150 saturation cap
    maxCommissionBps: 2000, // 20% saturation cap
  },
};
