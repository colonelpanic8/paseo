import type { ProviderUsageHistoryHostInput } from "./merge";
import type { ProviderUsageHistoryView } from "./types";

export interface UsageHistoryViewInput {
  /** The selected hosts, with the status the fan-out resolved for each. */
  hosts: readonly ProviderUsageHistoryHostInput[];
  isFetching: boolean;
}

/**
 * Results show as soon as any host answers; the page never waits for the
 * slowest one. Everything short of that resolves to a single state, and the
 * summary card's coverage line names the hosts that are missing from it.
 */
export function usageHistoryView(input: UsageHistoryViewInput): ProviderUsageHistoryView {
  if (input.hosts.length === 0) return { kind: "noHosts" };

  const has = (status: ProviderUsageHistoryHostInput["status"]) =>
    input.hosts.some((host) => host.status === status);
  const every = (status: ProviderUsageHistoryHostInput["status"]) =>
    input.hosts.every((host) => host.status === status);

  if (has("ready")) return { kind: "ready", isRefreshing: input.isFetching };
  if (has("pending")) return { kind: "loading" };
  if (every("error")) return { kind: "error" };
  if (every("unsupported")) {
    return { kind: "unavailable", messageKey: "settings.usageHistory.unsupported" };
  }
  if (every("offline")) {
    return { kind: "unavailable", messageKey: "settings.usageHistory.hostUnavailable" };
  }
  return { kind: "unavailable", messageKey: "settings.usageHistory.hostsUnavailable" };
}
