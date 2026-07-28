import { useRef } from "react";
import { useShallow } from "zustand/shallow";
import { useFetchQueries } from "@/data/query";
import { getHostRuntimeStore, useHostRuntimeConnectionStatuses } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

// Recently-archived workspaces are an undo affordance, not an archive browser.
// The daemon caps its own response; this is the client-side ceiling on the merged
// cross-host list so a many-host sidebar can't grow an unbounded tail.
const ARCHIVED_WORKSPACE_LIMIT = 25;
const ARCHIVED_WORKSPACES_STALE_TIME = 30_000;

export interface ArchivedWorkspaceEntry {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
  projectId: string;
  projectName: string;
  name: string;
  workspaceDirectory: string;
  archivedAt: Date;
}

export function archivedWorkspacesQueryKey(serverId: string): [string, string] {
  return ["archivedWorkspaces", serverId];
}

interface ArchivedWorkspacesCache {
  signature: string;
  value: ArchivedWorkspaceEntry[];
}

const EMPTY_ARCHIVED_WORKSPACES_CACHE: ArchivedWorkspacesCache = { signature: "", value: [] };

/**
 * Archived workspaces are deliberately kept out of the session store's workspace
 * map: everything that reads that map (project mode, switchers, counts) treats a
 * present descriptor as live. These rows live only here, and only status mode
 * renders them.
 */
export function useArchivedWorkspaces({
  serverIds,
}: {
  serverIds: readonly string[];
}): ArchivedWorkspaceEntry[] {
  // COMPAT(archivedWorkspacesList): added in v0.2.0, drop the gate when floor >= v0.2.0.
  // Single capability-detection site; hosts without the RPC simply contribute nothing.
  const supportedServerIds = useSessionStore(
    useShallow((state) =>
      serverIds.filter(
        (serverId) =>
          state.sessions[serverId]?.serverInfo?.features?.archivedWorkspacesList === true,
      ),
    ),
  );
  // An offline host has no client to ask, so asking only burns retries. Its rows
  // reappear when the connection does.
  const connectionStatuses = useHostRuntimeConnectionStatuses(supportedServerIds);

  const queries = useFetchQueries(
    supportedServerIds.map((serverId) => ({
      queryKey: archivedWorkspacesQueryKey(serverId),
      queryFn: async (): Promise<ArchivedWorkspaceEntry[]> => {
        const client = getHostRuntimeStore().getClient(serverId);
        if (!client) {
          throw new Error("Host disconnected");
        }
        const entries = await client.listArchivedWorkspaces({
          limit: ARCHIVED_WORKSPACE_LIMIT,
        });
        return entries.map((entry) => ({
          workspaceKey: `${serverId}:${entry.id}`,
          serverId,
          workspaceId: entry.id,
          projectId: entry.projectId,
          projectName: entry.projectDisplayName,
          name: entry.name,
          workspaceDirectory: entry.workspaceDirectory,
          archivedAt: new Date(entry.archivedAt),
        }));
      },
      enabled: connectionStatuses.get(serverId) === "online",
      staleTimeMs: ARCHIVED_WORKSPACES_STALE_TIME,
      dataShape: "list" as const,
    })),
  );

  // useQueries hands back a fresh wrapper array every render, so the merged result
  // must be cached on the data itself or every consumer re-renders forever. A
  // useMemo can't express this (its dependency is derived from the same array it
  // consumes), so cache explicitly: recompute only when the signature moves.
  const dataSlices = queries.map((query) => query.data);
  const signature = dataSlices
    .map(
      (slice) =>
        slice?.map((entry) => `${entry.workspaceKey}@${entry.archivedAt.getTime()}`).join(",") ??
        "",
    )
    .join("|");

  const cache = useRef<ArchivedWorkspacesCache>(EMPTY_ARCHIVED_WORKSPACES_CACHE);
  if (cache.current.signature !== signature) {
    cache.current = { signature, value: mergeArchivedWorkspaces(dataSlices) };
  }
  return cache.current.value;
}

export function mergeArchivedWorkspaces(
  slices: ReadonlyArray<ArchivedWorkspaceEntry[] | undefined>,
): ArchivedWorkspaceEntry[] {
  const merged: ArchivedWorkspaceEntry[] = [];
  for (const slice of slices) {
    if (slice) merged.push(...slice);
  }
  return merged
    .sort((left, right) => compareArchivedWorkspaces(left, right))
    .slice(0, ARCHIVED_WORKSPACE_LIMIT);
}

// Newest archive first. Entries archived in the same millisecond (a cascade
// archive writes one timestamp across several workspaces) fall back to the key so
// the order stays stable across refetches.
function compareArchivedWorkspaces(
  left: ArchivedWorkspaceEntry,
  right: ArchivedWorkspaceEntry,
): number {
  const leftTime = left.archivedAt.getTime();
  const rightTime = right.archivedAt.getTime();
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return left.workspaceKey.localeCompare(right.workspaceKey);
}
