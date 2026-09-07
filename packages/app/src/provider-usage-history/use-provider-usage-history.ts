import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import type {
  ProviderUsageHistoryPayload,
  ProviderUsageHistoryView,
  ProviderUsageHistoryWindowDays,
} from "./types";
import { makeWindow, type ProviderUsageHistoryWindow } from "./window";

// A cold scan walks every transcript in the window, so re-reading on every
// mount would be minutes of work for numbers that move once per session.
export const PROVIDER_USAGE_HISTORY_STALE_TIME_MS = 5 * 60 * 1000;

type ProviderUsageHistoryClient = Pick<DaemonClient, "readProviderUsageHistory">;

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
  view: ProviderUsageHistoryView;
  window: ProviderUsageHistoryWindow;
  refresh: () => Promise<void>;
}

export function useProviderUsageHistory(
  serverId: string | null | undefined,
  windowDays: ProviderUsageHistoryWindowDays,
): UseProviderUsageHistoryResult {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const isSupported = useHostFeature(serverId, "providerUsageHistory");

  const window = useMemo(() => makeWindow(windowDays), [windowDays]);
  const queryKey = useMemo(
    () => providerUsageHistoryQueryKey(serverId, window),
    [serverId, window],
  );
  const canFetch = Boolean(serverId && client && isConnected && isSupported);

  const read = useCallback(
    async (refreshRates: boolean): Promise<ProviderUsageHistoryPayload> => {
      if (!client) {
        throw new Error(t("settings.usageHistory.clientUnavailable"));
      }
      const usageClient: ProviderUsageHistoryClient = client;
      return usageClient.readProviderUsageHistory({
        sinceDay: window.sinceDay,
        untilDay: window.untilDay,
        timeZone: window.timeZone,
        ...(refreshRates ? { refreshRates: true } : {}),
      });
    },
    [client, t, window],
  );

  const queryFn = useCallback(() => read(false), [read]);

  const query = useFetchQuery({
    queryKey,
    queryFn,
    dataShape: "value",
    enabled: canFetch,
    staleTimeMs: PROVIDER_USAGE_HISTORY_STALE_TIME_MS,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  // The rate table is fetched from the network by the daemon, so an explicit
  // refresh is the only place that pays for it.
  const refresh = useCallback(async () => {
    if (!canFetch) return;
    await queryClient.fetchQuery({
      queryKey,
      queryFn: () => read(true),
      staleTime: 0,
    });
  }, [canFetch, queryClient, queryKey, read]);

  const view = useMemo<ProviderUsageHistoryView>(() => {
    if (!serverId || !client || !isConnected) {
      return { kind: "error", message: t("settings.usageHistory.hostUnavailable") };
    }
    if (!isSupported) {
      return { kind: "unsupported" };
    }
    if (query.data) {
      return { kind: "ready", payload: query.data, isRefreshing: query.isFetching };
    }
    if (query.isError) {
      return {
        kind: "error",
        message: query.error instanceof Error ? query.error.message : String(query.error),
      };
    }
    return { kind: "loading" };
  }, [
    client,
    isConnected,
    isSupported,
    query.data,
    query.error,
    query.isError,
    query.isFetching,
    serverId,
    t,
  ]);

  return { view, window, refresh };
}
