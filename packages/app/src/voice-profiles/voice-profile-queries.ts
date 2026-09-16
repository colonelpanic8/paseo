import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  VoiceProfile,
  VoiceThread,
  VoiceThreadHistoryEntry,
} from "@getpaseo/protocol/voice-profiles";
import { useFetchQuery } from "@/data/query";
import { useSessionStore } from "@/stores/session-store";
import { useVoiceSelectionStore } from "./voice-selection-store";

export const voiceProfilesQueryBaseKey = ["voice-profiles"] as const;

export function voiceProfileListQueryKey(serverId: string) {
  return [...voiceProfilesQueryBaseKey, "profiles", serverId] as const;
}

export function voiceThreadListQueryKey(serverId: string) {
  return [...voiceProfilesQueryBaseKey, "threads", serverId] as const;
}

export function voiceThreadHistoryQueryKey(serverId: string, threadId: string) {
  return [...voiceProfilesQueryBaseKey, "history", serverId, threadId] as const;
}

const clientScopes = new WeakMap<DaemonClient, number>();
let nextClientScope = 1;

function useVoiceConnection(serverId: string | null) {
  const client = useSessionStore((state) => (serverId ? state.sessions[serverId]?.client : null));
  if (!client) return { client: null, clientScope: 0 };
  let scope = clientScopes.get(client);
  if (scope === undefined) {
    scope = nextClientScope++;
    clientScopes.set(client, scope);
  }
  return { client, clientScope: scope };
}

const LIST_STALE_TIME_MS = 5_000;
export const VOICE_THREAD_HISTORY_PAGE_SIZE = 50;

export function requireVoiceClient(serverId: string, unavailableMessage: string): DaemonClient {
  const client = useSessionStore.getState().sessions[serverId]?.client ?? null;
  if (!client) {
    throw new Error(unavailableMessage);
  }
  return client;
}

export function hostSupportsVoiceProfiles(serverId: string): boolean {
  return (
    useSessionStore.getState().sessions[serverId]?.serverInfo?.features?.voiceProfiles === true
  );
}

function sortBySeq(entries: readonly VoiceThreadHistoryEntry[]): VoiceThreadHistoryEntry[] {
  return [...entries].sort((left, right) => left.seq - right.seq);
}

export interface UseVoiceProfilesResult {
  profiles: VoiceProfile[];
  /** The daemon's configured default, applied when the launcher has no pick. */
  defaultProfileId: string | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

/**
 * The profiles the daemon offers this principal: config-declared ones first,
 * then its own. Loading the list is also when a stale launcher selection gets
 * dropped: the record is the only proof the selected id still exists.
 */
export function useVoiceProfiles(serverId: string | null): UseVoiceProfilesResult {
  const { t } = useTranslation();
  const { client, clientScope } = useVoiceConnection(serverId);
  const reconcile = useVoiceSelectionStore((state) => state.reconcile);
  const query = useFetchQuery({
    queryKey: [...voiceProfileListQueryKey(serverId ?? ""), clientScope],
    enabled: serverId !== null,
    dataShape: "value",
    staleTimeMs: LIST_STALE_TIME_MS,
    queryFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      return await client.listVoiceProfiles();
    },
  });
  const data = query.isPlaceholderData ? null : (query.data ?? null);

  useEffect(() => {
    if (!serverId || !data) {
      return;
    }
    reconcile(serverId, { profileIds: data.profiles.map((profile) => profile.id) });
  }, [data, reconcile, serverId]);

  return {
    profiles: data?.profiles ?? [],
    defaultProfileId: data?.defaultProfileId ?? null,
    isLoading: query.isLoading || query.isPlaceholderData,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
  };
}

/** The display name of one profile, or null until the list has loaded or if it is gone. */
export function useVoiceProfileName(
  serverId: string | null,
  profileId: string | null,
): string | null {
  const { profiles } = useVoiceProfiles(profileId ? serverId : null);
  if (!profileId) {
    return null;
  }
  return profiles.find((profile) => profile.id === profileId)?.name ?? null;
}

export interface UseVoiceThreadsResult {
  /** Most recently active first. */
  threads: VoiceThread[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useVoiceThreads(serverId: string | null): UseVoiceThreadsResult {
  const { t } = useTranslation();
  const { client, clientScope } = useVoiceConnection(serverId);
  const reconcile = useVoiceSelectionStore((state) => state.reconcile);
  const query = useFetchQuery({
    queryKey: [...voiceThreadListQueryKey(serverId ?? ""), clientScope],
    enabled: serverId !== null,
    dataShape: "list",
    staleTimeMs: LIST_STALE_TIME_MS,
    queryFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      return await client.listVoiceThreads();
    },
  });
  const threads = query.isPlaceholderData ? null : (query.data ?? null);

  useEffect(() => {
    if (!serverId || !threads) {
      return;
    }
    reconcile(serverId, {
      threads: threads.map((thread) => ({ id: thread.id, profileId: thread.profileId })),
    });
  }, [reconcile, serverId, threads]);

  return {
    threads: threads ?? [],
    isLoading: query.isLoading || query.isPlaceholderData,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
  };
}

interface OlderHistoryPages {
  key: string;
  entries: VoiceThreadHistoryEntry[];
  hasMore: boolean;
}

function historyPageState(
  older: OlderHistoryPages | null,
  latest: { entries: VoiceThreadHistoryEntry[]; hasMore: boolean } | null,
  key: string,
) {
  const olderEntries = older?.key === key ? older.entries : [];
  const hasMore = older?.key === key ? older.hasMore : (latest?.hasMore ?? false);
  const oldestLoadedSeq = olderEntries[0]?.seq ?? latest?.entries[0]?.seq ?? null;
  return { olderEntries, hasMore, oldestLoadedSeq };
}

export interface UseVoiceThreadHistoryResult {
  thread: VoiceThread | null;
  /** Ascending by sequence, oldest loaded first. */
  entries: VoiceThreadHistoryEntry[];
  hasMore: boolean;
  isLoading: boolean;
  isLoadingOlder: boolean;
  error: Error | null;
  loadOlder: () => Promise<void>;
  refetch: () => void;
}

/**
 * The newest page comes from the query cache so edits and compaction refresh
 * it through invalidation. Older pages are appended on demand and reset when
 * the thread changes; they never go stale because sequence numbers below the
 * newest page do not change.
 */
export function useVoiceThreadHistory(
  serverId: string | null,
  threadId: string | null,
): UseVoiceThreadHistoryResult {
  const { t } = useTranslation();
  const { client, clientScope } = useVoiceConnection(serverId);
  const queryServerId = serverId ?? "";
  const queryThreadId = threadId ?? "";
  const query = useFetchQuery({
    queryKey: [...voiceThreadHistoryQueryKey(queryServerId, queryThreadId), clientScope],
    enabled: serverId !== null && threadId !== null,
    dataShape: "value",
    staleTimeMs: LIST_STALE_TIME_MS,
    queryFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      const page = await client.getVoiceThread({
        threadId: queryThreadId,
        limit: VOICE_THREAD_HISTORY_PAGE_SIZE,
      });
      return { thread: page.thread, entries: sortBySeq(page.history), hasMore: page.hasMore };
    },
  });
  const [older, setOlder] = useState<OlderHistoryPages | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const loadingOlder = useRef(false);

  const latest = query.data ?? null;
  const pageKey = `${clientScope}:${serverId}:${threadId}:${latest?.thread.lastSeq ?? 0}`;
  const { olderEntries, oldestLoadedSeq, hasMore } = historyPageState(older, latest, pageKey);

  const loadOlder = useCallback(async () => {
    if (!serverId || !threadId || !hasMore || oldestLoadedSeq === null || loadingOlder.current) {
      return;
    }
    loadingOlder.current = true;
    setIsLoadingOlder(true);
    try {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      const page = await client.getVoiceThread({
        threadId,
        beforeSeq: oldestLoadedSeq,
        limit: VOICE_THREAD_HISTORY_PAGE_SIZE,
      });
      setOlder((current) => {
        const existing = current?.key === pageKey ? current.entries : [];
        return {
          key: pageKey,
          entries: [...sortBySeq(page.history), ...existing],
          hasMore: page.hasMore,
        };
      });
    } finally {
      loadingOlder.current = false;
      setIsLoadingOlder(false);
    }
  }, [client, hasMore, oldestLoadedSeq, pageKey, serverId, t, threadId]);

  return {
    thread: latest?.thread ?? null,
    entries: [...olderEntries, ...(latest?.entries ?? [])],
    hasMore,
    isLoading: query.isLoading,
    isLoadingOlder,
    error: query.error,
    loadOlder,
    refetch: () => {
      void query.refetch();
    },
  };
}
