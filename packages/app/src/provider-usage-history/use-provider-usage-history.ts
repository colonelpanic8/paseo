import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useFetchQueries } from "@/data/query";
import { useHostFeatureMap } from "@/runtime/host-features";
import { getHostRuntimeStore, useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import type { ProviderUsageHistoryHostInput } from "./merge";
import type { ProviderUsageHistoryPayload, ProviderUsageHistoryWindowDays } from "./types";
import { makeWindow, type ProviderUsageHistoryWindow } from "./window";

// A cold scan walks every transcript in the window, so re-reading on every
// mount would be minutes of work for numbers that move once per session.
export const PROVIDER_USAGE_HISTORY_STALE_TIME_MS = 5 * 60 * 1000;

/** A host the page asks for usage. Named separately so the query fan-out never sees a profile. */
export interface ProviderUsageHistoryHostRef {
  readonly serverId: string;
  readonly name: string;
}

export function providerUsageHistoryQueryKey(
  serverId: string | null | undefined,
  window: ProviderUsageHistoryWindow,
) {
  return [
    "providerUsageHistory",
    serverId ?? "",
    window.sinceDay,
    window.untilDay,
    window.timeZone,
  ] as const;
}

export interface UseProviderUsageHistoryResult {
  hosts: readonly ProviderUsageHistoryHostInput[];
  window: ProviderUsageHistoryWindow;
  isFetching: boolean;
  refresh: () => Promise<void>;
}

/**
 * Reads usage history from every given host at once. One query per host, keyed
 * the way the single-host page keyed it, so switching the host filter reuses
 * whatever is already cached. A host that is down, too old, or still scanning
 * reports its state instead of blocking the ones that answered.
 */
export function useProviderUsageHistory(
  hosts: readonly ProviderUsageHistoryHostRef[],
  windowDays: ProviderUsageHistoryWindowDays,
): UseProviderUsageHistoryResult {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Aliased: `window` is the global on web.
  const usageWindow = useMemo(() => makeWindow(windowDays), [windowDays]);
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  const features = useHostFeatureMap(serverIds, "providerUsageHistory");

  const read = useCallback(
    async (serverId: string, refreshRates: boolean): Promise<ProviderUsageHistoryPayload> => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) {
        throw new Error(t("settings.usageHistory.clientUnavailable"));
      }
      try {
        return await client.readProviderUsageHistory({
          sinceDay: usageWindow.sinceDay,
          untilDay: usageWindow.untilDay,
          timeZone: usageWindow.timeZone,
          ...(refreshRates ? { refreshRates: true } : {}),
        });
      } catch (error) {
        console.error("Failed to read provider usage history", { error, serverId, usageWindow });
        throw error;
      }
    },
    [t, usageWindow],
  );

  const fetchableServerIds = useMemo(
    () =>
      serverIds.filter(
        (serverId) =>
          connectionStatuses.get(serverId) === "online" && features.get(serverId) === true,
      ),
    [connectionStatuses, features, serverIds],
  );

  const results = useFetchQueries<ProviderUsageHistoryPayload>(
    hosts.map((host) => ({
      queryKey: providerUsageHistoryQueryKey(host.serverId, usageWindow),
      queryFn: () => read(host.serverId, false),
      dataShape: "value",
      enabled: fetchableServerIds.includes(host.serverId),
      staleTimeMs: PROVIDER_USAGE_HISTORY_STALE_TIME_MS,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    })),
  );

  const hostStates = hosts.map((host, index): ProviderUsageHistoryHostInput => {
    const base = { serverId: host.serverId, hostName: host.name };
    if (connectionStatuses.get(host.serverId) !== "online") return { ...base, status: "offline" };
    if (features.get(host.serverId) !== true) return { ...base, status: "unsupported" };
    const result = results[index];
    if (result?.isError) return { ...base, status: "error" };
    if (result?.data) return { ...base, status: "ready", payload: result.data };
    return { ...base, status: "pending" };
  });

  // The rate table is fetched from the network by the daemon, so an explicit
  // refresh is the only place that pays for it.
  const refresh = useCallback(async () => {
    await Promise.all(
      fetchableServerIds.map((serverId) =>
        // Query state owns the error presentation, including failed refreshes of cached data.
        queryClient
          .fetchQuery({
            queryKey: providerUsageHistoryQueryKey(serverId, usageWindow),
            queryFn: () => read(serverId, true),
            staleTime: 0,
          })
          .catch(() => undefined),
      ),
    );
  }, [fetchableServerIds, queryClient, read, usageWindow]);

  return {
    hosts: hostStates,
    window: usageWindow,
    isFetching: results.some((result) => result.isFetching),
    refresh,
  };
}
