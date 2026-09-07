import type { ProviderUsageHistoryPayload, ProviderUsageHistoryView } from "./types";

export interface UsageHistoryViewInput {
  isConnected: boolean;
  isSupported: boolean;
  isError: boolean;
  isFetching: boolean;
  payload: ProviderUsageHistoryPayload | undefined;
}

export function usageHistoryView(input: UsageHistoryViewInput): ProviderUsageHistoryView {
  if (!input.isConnected) {
    return { kind: "error", messageKey: "settings.usageHistory.hostUnavailable" };
  }
  if (!input.isSupported) return { kind: "unsupported" };
  if (input.isError) {
    return { kind: "error", messageKey: "settings.usageHistory.readFailed" };
  }
  if (input.payload) {
    return { kind: "ready", payload: input.payload, isRefreshing: input.isFetching };
  }
  return { kind: "loading" };
}
