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
  /** The app is not connected to anything yet. */
  | { kind: "noHosts" }
  /** Nothing has answered yet, but something still might. */
  | { kind: "loading" }
  /** No selected host can answer, and none of them failed trying. */
  | {
      kind: "unavailable";
      messageKey:
        | "settings.usageHistory.unsupported"
        | "settings.usageHistory.hostUnavailable"
        | "settings.usageHistory.hostsUnavailable";
    }
  /** Every selected host was asked and every read failed. */
  | { kind: "error" }
  /** At least one host answered. Hosts that did not are named in the coverage line. */
  | { kind: "ready"; isRefreshing: boolean };
