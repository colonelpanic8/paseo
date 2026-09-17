import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useFetchQueries } from "@/data/query";
import { useHostFeatureMap } from "@/runtime/host-features";
import { getHostRuntimeStore, useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import type { ProviderUsageHistoryHostInput } from "./merge";
import { readCachedUsageHistory, writeCachedUsageHistory } from "./payload-cache";
import type { ProviderUsageHistoryPayload, ProviderUsageHistoryWindowDays } from "./types";
import { makeWindow, msUntilNextLocalDay, type ProviderUsageHistoryWindow } from "./window";

// A cold scan walks every transcript in the window, so re-reading on every
// mount would be minutes of work for numbers that move once per session.
export const PROVIDER_USAGE_HISTORY_STALE_TIME_MS = 5 * 60 * 1000;
/** A timer that lands a hair before midnight re-arms itself; the slack keeps that rare. */
const DAY_ROLLOVER_SLACK_MS = 1000;

/** A host the page asks for usage. Named separately so the query fan-out never sees a profile. */
export interface ProviderUsageHistoryHostRef {
  readonly serverId: string;
  readonly name: string;
}

type RememberedPayloads = ReadonlyMap<string, ProviderUsageHistoryPayload>;

const NO_REMEMBERED_PAYLOADS: RememberedPayloads = new Map();
const ID_SEPARATOR = "\u0000";

/** Last payload each host reported for this window, read once per window from device storage. */
function useRememberedUsageHistory(
  serverIds: readonly string[],
  window: ProviderUsageHistoryWindow,
): RememberedPayloads {
  const [remembered, setRemembered] = useState<RememberedPayloads>(NO_REMEMBERED_PAYLOADS);
  // Keyed on the joined ids, not the array: the caller rebuilds it whenever a connection status
  // changes, and re-running the read on every render would never settle.
  const identity = serverIds.join(ID_SEPARATOR);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const found = new Map<string, ProviderUsageHistoryPayload>();
      await Promise.all(
        identity
          .split(ID_SEPARATOR)
          .filter((serverId) => serverId.length > 0)
          .map(async (serverId) => {
            const payload = await readCachedUsageHistory(serverId, window);
            if (payload) found.set(serverId, payload);
          }),
      );
      if (!cancelled) setRemembered(found);
    }
    load().catch((error: unknown) => {
      console.error("Failed to read cached provider usage history", { error });
    });
    return () => {
      cancelled = true;
    };
  }, [identity, window]);

  return remembered;
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

interface HostQueryResults {
  hosts: readonly ProviderUsageHistoryHostInput[];
  isFetching: boolean;
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

  // The window is anchored to the day the page opened and re-anchored once
  // local midnight passes, so a page left open keeps asking for today.
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setTimeout(
      () => setClock(new Date()),
      msUntilNextLocalDay(clock) + DAY_ROLLOVER_SLACK_MS,
    );
    return () => clearTimeout(timer);
  }, [clock]);
  // Aliased: `window` is the global on web.
  const usageWindow = useMemo(() => makeWindow(windowDays, clock), [clock, windowDays]);
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const connectionStatuses = useHostRuntimeConnectionStatuses(serverIds);
  const features = useHostFeatureMap(serverIds, "providerUsageHistory");

  const read = useCallback(
    async (serverId: string, refreshRates: boolean): Promise<ProviderUsageHistoryPayload> => {
      const client = getHostRuntimeStore().getClient(serverId);
      if (!client) {
        throw new Error(t("settings.usageHistory.clientUnavailable"));
      }
      let payload: ProviderUsageHistoryPayload;
      try {
        payload = await client.readProviderUsageHistory({
          sinceDay: usageWindow.sinceDay,
          untilDay: usageWindow.untilDay,
          timeZone: usageWindow.timeZone,
          ...(refreshRates ? { refreshRates: true } : {}),
        });
      } catch (error) {
        console.error("Failed to read provider usage history", { error, serverId, usageWindow });
        throw error;
      }
      // Remembering the answer must never cost the caller the answer itself.
      writeCachedUsageHistory(serverId, usageWindow, payload).catch((error: unknown) => {
        console.error("Failed to cache provider usage history", { error, serverId });
      });
      return payload;
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

  const remembered = useRememberedUsageHistory(fetchableServerIds, usageWindow);

  // Combined by the query layer, which structurally shares the result: the host
  // list keeps its identity across renders until a host's answer changes, so the
  // page can derive its report from it exactly once per answer.
  const combine = useCallback(
    (results: UseQueryResult<ProviderUsageHistoryPayload, Error>[]): HostQueryResults => ({
      hosts: hosts.map((host, index): ProviderUsageHistoryHostInput => {
        const base = { serverId: host.serverId, hostName: host.name };
        if (connectionStatuses.get(host.serverId) !== "online") {
          return { ...base, status: "offline" };
        }
        if (features.get(host.serverId) !== true) return { ...base, status: "unsupported" };
        const result = results[index];
        if (result?.isError) return { ...base, status: "error" };
        if (result?.data) return { ...base, status: "ready", payload: result.data };
        // A host with no answer yet is fetching one, and it will replace these numbers.
        // Until it does they are closer to the truth than an empty page. A host that
        // failed keeps saying so.
        const lastKnown = remembered.get(host.serverId);
        if (lastKnown) return { ...base, status: "ready", payload: lastKnown };
        return { ...base, status: "pending" };
      }),
      isFetching: results.some((result) => result.isFetching),
    }),
    [connectionStatuses, features, hosts, remembered],
  );

  const { hosts: hostStates, isFetching } = useFetchQueries<
    ProviderUsageHistoryPayload,
    HostQueryResults
  >(
    hosts.map((host) => ({
      queryKey: providerUsageHistoryQueryKey(host.serverId, usageWindow),
      queryFn: () => read(host.serverId, false),
      dataShape: "value",
      enabled: fetchableServerIds.includes(host.serverId),
      staleTimeMs: PROVIDER_USAGE_HISTORY_STALE_TIME_MS,
      // A remount inside the stale window reuses the answer instead of rescanning.
      refetchOnMount: true,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
    })),
    combine,
  );

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
    isFetching,
    refresh,
  };
}
