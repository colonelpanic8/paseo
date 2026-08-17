import type { AgentProvider, ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { normalizeWorkspacePath } from "@/utils/workspace-identity";

export const PROVIDERS_SNAPSHOT_QUERY_ROOT = "providersSnapshot";

export interface ProvidersSnapshotQueryData {
  entries: ProviderSnapshotEntry[];
  generatedAt: string;
}

function generatedAtMs(snapshot: ProvidersSnapshotQueryData): number {
  const ms = Date.parse(snapshot.generatedAt);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

// A get_providers_snapshot fetch races providers_snapshot_update pushes: a cold
// snapshot answers with "loading" entries and warm-up pushes can arrive while the
// response is still resolving through the async cache-write chain. Both helpers
// keep the newest snapshot by generatedAt; they differ on ties because warm-up
// emits per-provider pushes within the same millisecond. A push must supersede an
// equally-stamped predecessor, while a fetch response must lose to an
// equally-stamped push — the settled daemon sends no further push to repair a
// stale overwrite.
export function mergePushedProvidersSnapshot<T extends ProvidersSnapshotQueryData>(
  current: T | undefined,
  pushed: T,
): T {
  if (!current) return pushed;
  return generatedAtMs(current) > generatedAtMs(pushed) ? current : pushed;
}

export function mergeFetchedProvidersSnapshot<T extends ProvidersSnapshotQueryData>(
  current: T | undefined,
  fetched: T,
): T {
  if (!current) return fetched;
  return generatedAtMs(current) >= generatedAtMs(fetched) ? current : fetched;
}

export function normalizeProvidersSnapshotCwd(cwd?: string | null): string | null {
  return normalizeWorkspacePath(cwd);
}

export function providersSnapshotQueryRoot(serverId: string | null) {
  return [PROVIDERS_SNAPSHOT_QUERY_ROOT, serverId] as const;
}

export function providersSnapshotQueryKey(serverId: string | null, cwd?: string | null) {
  const normalizedCwd = normalizeProvidersSnapshotCwd(cwd);
  return normalizedCwd
    ? ([PROVIDERS_SNAPSHOT_QUERY_ROOT, serverId, "cwd", normalizedCwd] as const)
    : ([PROVIDERS_SNAPSHOT_QUERY_ROOT, serverId, "home"] as const);
}

export function providersSnapshotRequestOptions(input: {
  cwd?: string | null;
  providers?: AgentProvider[];
  ifNoneMatch?: string;
}) {
  const normalizedCwd = normalizeProvidersSnapshotCwd(input.cwd);
  return {
    ...(normalizedCwd ? { cwd: normalizedCwd } : {}),
    ...(input.providers ? { providers: input.providers } : {}),
    ...(input.ifNoneMatch ? { ifNoneMatch: input.ifNoneMatch } : {}),
  };
}

export function isProvidersSnapshotHomeScope(cwd?: string | null): boolean {
  return normalizeProvidersSnapshotCwd(cwd) === null;
}
