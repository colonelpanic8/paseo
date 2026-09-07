import type {
  ProviderUsageHistoryBucket,
  ProviderUsageHistoryPricing,
  ProviderUsageHistoryReadResponseMessage,
  ProviderUsageHistorySource,
  ProviderUsageHistoryTokenTotals,
} from "@getpaseo/protocol/messages";

export type {
  ProviderUsageHistoryBucket,
  ProviderUsageHistoryPricing,
  ProviderUsageHistorySource,
  ProviderUsageHistoryTokenTotals,
};

export type ProviderUsageHistoryPayload = ProviderUsageHistoryReadResponseMessage["payload"];

/** Which number the headline, the chart, and the provider rows report. */
export type ProviderUsageHistoryMetric = "cost" | "tokens";

/** Trailing calendar days the page asks the daemon for. */
export type ProviderUsageHistoryWindowDays = 7 | 30 | 90;

export type ProviderUsageHistoryView =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string }
  | { kind: "ready"; payload: ProviderUsageHistoryPayload; isRefreshing: boolean };
