import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it } from "vitest";

import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import { compactProviderSnapshot } from "@getpaseo/protocol/provider-snapshot-codec";
import type { CachedProviderSnapshot, ProviderSnapshotCache } from "@/data/provider-snapshot-cache";
import { draftAgentCommandsQueryKey } from "@/hooks/agent-commands-query";
import { applyProvidersSnapshotUpdate, type ProvidersSnapshotUpdate } from "@/data/push-router";
import {
  fetchProvidersSnapshot,
  fetchProvidersSnapshotForQuery,
  providersSnapshotQueryKey,
  refreshAndApplyProvidersSnapshot,
  selectorOpenRefetchDecision,
  type ProvidersSnapshotClient,
} from "./use-providers-snapshot";

type GetProvidersSnapshotResult = Awaited<ReturnType<DaemonClient["getProvidersSnapshot"]>>;
type RefreshProvidersSnapshotResult = Awaited<ReturnType<DaemonClient["refreshProvidersSnapshot"]>>;
type GetProvidersSnapshotOptions = Parameters<DaemonClient["getProvidersSnapshot"]>[0];
type RefreshProvidersSnapshotOptions = Parameters<DaemonClient["refreshProvidersSnapshot"]>[0];

interface FakeProvidersSnapshotClient extends ProvidersSnapshotClient {
  getCalls: GetProvidersSnapshotOptions[];
  refreshCalls: RefreshProvidersSnapshotOptions[];
}

function createClient(
  input: {
    snapshots?: GetProvidersSnapshotResult[];
    refreshResult?: RefreshProvidersSnapshotResult;
  } = {},
): FakeProvidersSnapshotClient {
  const snapshots = [...(input.snapshots ?? [])];
  const refreshResult: RefreshProvidersSnapshotResult = input.refreshResult ?? {
    acknowledged: true,
    requestId: "refresh-1",
  };

  const getCalls: GetProvidersSnapshotOptions[] = [];
  const refreshCalls: RefreshProvidersSnapshotOptions[] = [];

  return {
    getCalls,
    refreshCalls,
    async getProvidersSnapshot(options) {
      getCalls.push(options ?? {});
      const next = snapshots.shift();
      if (!next) {
        throw new Error("No snapshot configured for getProvidersSnapshot call");
      }
      return next;
    },
    async refreshProvidersSnapshot(options) {
      refreshCalls.push(options ?? {});
      return refreshResult;
    },
  };
}

function providersSnapshot(entries: ProviderSnapshotEntry[]): GetProvidersSnapshotResult {
  return {
    entries,
    generatedAt: "2026-01-01T00:00:00.000Z",
    requestId: "snapshot",
  };
}

function codexEntry(
  status: ProviderSnapshotEntry["status"],
  models?: ProviderSnapshotEntry["models"],
): ProviderSnapshotEntry {
  return {
    provider: "codex",
    status,
    enabled: true,
    ...(models ? { models } : {}),
  };
}

const readyCodexModel = { provider: "codex", id: "gpt-5.4", label: "GPT-5.4" } as const;
const serverId = "server-1";

function createCache(initial: CachedProviderSnapshot | null = null): ProviderSnapshotCache & {
  writes: Parameters<ProviderSnapshotCache["write"]>[0][];
} {
  const writes: Parameters<ProviderSnapshotCache["write"]>[0][] = [];
  return {
    writes,
    async read() {
      return initial;
    },
    async write(input) {
      writes.push(input);
    },
  };
}

function updateMessage(
  entries: ProviderSnapshotEntry[],
  cwd?: string,
  generatedAt = "2026-01-01T00:00:01.000Z",
): ProvidersSnapshotUpdate {
  return {
    type: "providers_snapshot_update",
    payload: {
      ...(cwd ? { cwd } : {}),
      entries,
      generatedAt,
    },
  };
}

describe("providersSnapshotQueryKey", () => {
  it("uses separate keys for home and workspace scopes", () => {
    expect(providersSnapshotQueryKey(serverId)).toEqual(["providersSnapshot", serverId, "home"]);
    expect(providersSnapshotQueryKey(serverId, "/repo-a")).toEqual([
      "providersSnapshot",
      serverId,
      "cwd",
      "/repo-a",
    ]);
  });
});

describe("fetchProvidersSnapshot", () => {
  it("sends no cwd for the home scope", async () => {
    const client = createClient({ snapshots: [providersSnapshot([])] });

    await fetchProvidersSnapshot({ client, serverId, cwd: null, cache: createCache() });

    expect(client.getCalls).toEqual([{}]);
  });

  it("sends the workspace cwd for the workspace scope", async () => {
    const client = createClient({ snapshots: [providersSnapshot([])] });

    await fetchProvidersSnapshot({
      client,
      serverId,
      cwd: "/repo-a",
      cache: createCache(),
    });

    expect(client.getCalls).toEqual([{ cwd: "/repo-a" }]);
  });

  it("reuses a cached snapshot when the daemon reports its hash unchanged", async () => {
    const entries = [codexEntry("ready", [readyCodexModel])];
    const compactSnapshot = compactProviderSnapshot(entries);
    const cache = createCache({
      version: 1,
      hash: "snapshot-hash",
      generatedAt: "2026-01-01T00:00:00.000Z",
      compactSnapshot,
      entries,
    });
    const client = createClient({
      snapshots: [
        {
          entries: [],
          snapshotHash: "snapshot-hash",
          notModified: true,
          generatedAt: "2026-01-02T00:00:00.000Z",
          requestId: "snapshot-2",
        },
      ],
    });

    const snapshot = await fetchProvidersSnapshot({
      client,
      serverId,
      cwd: "/repo-a",
      cache,
    });

    expect(client.getCalls).toEqual([{ cwd: "/repo-a", ifNoneMatch: "snapshot-hash" }]);
    expect(snapshot.entries).toBe(entries);
    expect(cache.writes).toEqual([]);
  });

  it("persists a changed compact snapshot for the next launch", async () => {
    const entries = [codexEntry("ready", [readyCodexModel])];
    const compactSnapshot = compactProviderSnapshot(entries);
    const cache = createCache();
    const client = createClient({
      snapshots: [
        {
          entries,
          compactSnapshot,
          snapshotHash: "next-hash",
          generatedAt: "2026-01-02T00:00:00.000Z",
          requestId: "snapshot-2",
        },
      ],
    });

    await fetchProvidersSnapshot({ client, serverId, cwd: "/repo-a", cache });

    expect(cache.writes).toEqual([
      {
        serverId,
        cwd: "/repo-a",
        hash: "next-hash",
        generatedAt: "2026-01-02T00:00:00.000Z",
        compactSnapshot,
      },
    ]);
  });
});

describe("fetchProvidersSnapshotForQuery", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  it("prefers a pushed snapshot that landed while the fetch was in flight", async () => {
    const readyEntries = [codexEntry("ready", [readyCodexModel])];
    const client: ProvidersSnapshotClient = {
      async getProvidersSnapshot() {
        applyProvidersSnapshotUpdate({
          serverId,
          queryClient,
          message: updateMessage(readyEntries, "/repo-a", "2026-01-01T00:00:00.500Z"),
        });
        return providersSnapshot([codexEntry("loading")]);
      },
      async refreshProvidersSnapshot() {
        return { acknowledged: true, requestId: "refresh-1" };
      },
    };

    const snapshot = await fetchProvidersSnapshotForQuery({
      client,
      queryClient,
      serverId,
      cwd: "/repo-a",
      cache: createCache(),
    });

    expect(snapshot.entries).toEqual(readyEntries);
  });

  it("prefers an equally-stamped pushed snapshot over the fetch response", async () => {
    const readyEntries = [codexEntry("ready", [readyCodexModel])];
    queryClient.setQueryData(providersSnapshotQueryKey(serverId, "/repo-a"), {
      entries: readyEntries,
      generatedAt: "2026-01-01T00:00:00.000Z",
      requestId: "providers_snapshot_update",
    });
    const client = createClient({ snapshots: [providersSnapshot([codexEntry("loading")])] });

    const snapshot = await fetchProvidersSnapshotForQuery({
      client,
      queryClient,
      serverId,
      cwd: "/repo-a",
      cache: createCache(),
    });

    expect(snapshot.entries).toEqual(readyEntries);
  });

  it("returns the fetch result when it is fresher than the cached snapshot", async () => {
    queryClient.setQueryData(providersSnapshotQueryKey(serverId, "/repo-a"), {
      entries: [codexEntry("loading")],
      generatedAt: "2025-12-31T00:00:00.000Z",
      requestId: "providers_snapshot_update",
    });
    const client = createClient({
      snapshots: [providersSnapshot([codexEntry("ready", [readyCodexModel])])],
    });

    const snapshot = await fetchProvidersSnapshotForQuery({
      client,
      queryClient,
      serverId,
      cwd: "/repo-a",
      cache: createCache(),
    });

    expect(snapshot.entries).toEqual([codexEntry("ready", [readyCodexModel])]);
  });
});

describe("refreshAndApplyProvidersSnapshot", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  it("refreshes then re-fetches the home snapshot and writes it into the home query cache", async () => {
    const client = createClient({
      snapshots: [providersSnapshot([codexEntry("ready", [readyCodexModel])])],
    });

    await refreshAndApplyProvidersSnapshot({
      client,
      queryClient,
      serverId,
      cwd: null,
      providers: ["codex"],
      cache: createCache(),
    });

    expect(client.refreshCalls).toEqual([{ providers: ["codex"] }]);
    expect(client.getCalls).toEqual([{}]);
    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId))).toEqual(
      providersSnapshot([codexEntry("ready", [readyCodexModel])]),
    );
  });

  it("refreshes then re-fetches the workspace snapshot with the cwd preserved", async () => {
    const client = createClient({
      snapshots: [providersSnapshot([codexEntry("ready", [readyCodexModel])])],
    });

    await refreshAndApplyProvidersSnapshot({
      client,
      queryClient,
      serverId,
      cwd: "/repo-a",
      providers: ["codex"],
      cache: createCache(),
    });

    expect(client.refreshCalls).toEqual([{ cwd: "/repo-a", providers: ["codex"] }]);
    expect(client.getCalls).toEqual([{ cwd: "/repo-a" }]);
    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId, "/repo-a"))).toEqual(
      providersSnapshot([codexEntry("ready", [readyCodexModel])]),
    );
  });

  it("invalidates every scope under the server when refreshing the home snapshot", async () => {
    const client = createClient({ snapshots: [providersSnapshot([])] });
    queryClient.setQueryData(providersSnapshotQueryKey(serverId, "/repo-a"), providersSnapshot([]));
    queryClient.setQueryData(providersSnapshotQueryKey(serverId, "/repo-b"), providersSnapshot([]));

    await refreshAndApplyProvidersSnapshot({
      client,
      queryClient,
      serverId,
      cwd: null,
      cache: createCache(),
    });

    expect(
      queryClient.getQueryState(providersSnapshotQueryKey(serverId, "/repo-a"))?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(providersSnapshotQueryKey(serverId, "/repo-b"))?.isInvalidated,
    ).toBe(true);
  });

  it("does not invalidate sibling scopes when refreshing a workspace snapshot", async () => {
    const client = createClient({ snapshots: [providersSnapshot([])] });
    queryClient.setQueryData(providersSnapshotQueryKey(serverId), providersSnapshot([]));
    queryClient.setQueryData(providersSnapshotQueryKey(serverId, "/repo-b"), providersSnapshot([]));

    await refreshAndApplyProvidersSnapshot({
      client,
      queryClient,
      serverId,
      cwd: "/repo-a",
      cache: createCache(),
    });

    expect(queryClient.getQueryState(providersSnapshotQueryKey(serverId))?.isInvalidated).toBe(
      false,
    );
    expect(
      queryClient.getQueryState(providersSnapshotQueryKey(serverId, "/repo-b"))?.isInvalidated,
    ).toBe(false);
  });

  it("keeps a fresher pushed snapshot over the refetched one", async () => {
    const readyEntries = [codexEntry("ready", [readyCodexModel])];
    queryClient.setQueryData(providersSnapshotQueryKey(serverId, "/repo-a"), {
      entries: readyEntries,
      generatedAt: "2026-01-01T00:00:01.000Z",
      requestId: "providers_snapshot_update",
    });
    const client = createClient({ snapshots: [providersSnapshot([codexEntry("loading")])] });

    await refreshAndApplyProvidersSnapshot({
      client,
      queryClient,
      serverId,
      cwd: "/repo-a",
      cache: createCache(),
    });

    const data = queryClient.getQueryData<{ entries: ProviderSnapshotEntry[] }>(
      providersSnapshotQueryKey(serverId, "/repo-a"),
    );
    expect(data?.entries).toEqual(readyEntries);
  });

  it("invalidates cached agent commands when refreshing providers", async () => {
    const client = createClient({ snapshots: [providersSnapshot([])] });
    const commandsKey = draftAgentCommandsQueryKey({
      serverId,
      draftConfig: { provider: "codex", cwd: "/repo-a" },
    });
    queryClient.setQueryData(commandsKey, [{ name: "compact", description: "", argumentHint: "" }]);

    await refreshAndApplyProvidersSnapshot({
      client,
      queryClient,
      serverId,
      cwd: "/repo-a",
      cache: createCache(),
    });

    expect(queryClient.getQueryState(commandsKey)?.isInvalidated).toBe(true);
  });
});

describe("applyProvidersSnapshotUpdate", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
  });

  it("routes updates to the home query cache when the message carries no cwd", () => {
    applyProvidersSnapshotUpdate({
      serverId,
      queryClient,
      message: updateMessage([codexEntry("ready", [readyCodexModel])]),
    });

    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId))).toEqual({
      entries: [codexEntry("ready", [readyCodexModel])],
      generatedAt: "2026-01-01T00:00:01.000Z",
      requestId: "providers_snapshot_update",
    });
  });

  it("routes workspace updates to the matching scope without touching siblings", () => {
    queryClient.setQueryData(providersSnapshotQueryKey(serverId, "/repo-b"), providersSnapshot([]));

    applyProvidersSnapshotUpdate({
      serverId,
      queryClient,
      message: updateMessage([codexEntry("ready", [readyCodexModel])], "/repo-a"),
    });

    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId, "/repo-a"))).toEqual({
      entries: [codexEntry("ready", [readyCodexModel])],
      generatedAt: "2026-01-01T00:00:01.000Z",
      requestId: "providers_snapshot_update",
    });
    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId, "/repo-b"))).toEqual(
      providersSnapshot([]),
    );
  });

  it("persists compact push updates", () => {
    const entries = [codexEntry("ready", [readyCodexModel])];
    const compactSnapshot = compactProviderSnapshot(entries);
    const cache = createCache();
    const message = updateMessage(entries, "/repo-a");
    message.payload.compactSnapshot = compactSnapshot;
    message.payload.snapshotHash = "push-hash";

    applyProvidersSnapshotUpdate({ serverId, queryClient, message, cache });

    expect(cache.writes).toEqual([
      {
        serverId,
        cwd: "/repo-a",
        hash: "push-hash",
        generatedAt: "2026-01-01T00:00:01.000Z",
        compactSnapshot,
      },
    ]);
  });

  it("applies Windows daemon updates to app-normalized workspace paths", () => {
    const workspaceCwd = "C:/Users/Ezekiel Bulver/project";
    const daemonCwd = "C:\\Users\\Ezekiel Bulver\\project";
    queryClient.setQueryData(
      providersSnapshotQueryKey(serverId, workspaceCwd),
      providersSnapshot([codexEntry("loading")]),
    );

    applyProvidersSnapshotUpdate({
      serverId,
      queryClient,
      message: updateMessage([codexEntry("ready", [readyCodexModel])], daemonCwd),
    });

    expect(queryClient.getQueryData(providersSnapshotQueryKey(serverId, workspaceCwd))).toEqual({
      entries: [codexEntry("ready", [readyCodexModel])],
      generatedAt: "2026-01-01T00:00:01.000Z",
      requestId: "providers_snapshot_update",
    });
  });

  it("does not regress the cache when a push is older than the cached snapshot", () => {
    const readyEntries = [codexEntry("ready", [readyCodexModel])];
    queryClient.setQueryData(providersSnapshotQueryKey(serverId, "/repo-a"), {
      entries: readyEntries,
      generatedAt: "2026-01-01T00:00:02.000Z",
      requestId: "providers_snapshot_update",
    });

    applyProvidersSnapshotUpdate({
      serverId,
      queryClient,
      message: updateMessage([codexEntry("loading")], "/repo-a"),
    });

    const data = queryClient.getQueryData<{ entries: ProviderSnapshotEntry[] }>(
      providersSnapshotQueryKey(serverId, "/repo-a"),
    );
    expect(data?.entries).toEqual(readyEntries);
  });

  it("applies a push stamped in the same millisecond as the cached snapshot", () => {
    queryClient.setQueryData(providersSnapshotQueryKey(serverId, "/repo-a"), {
      entries: [codexEntry("loading")],
      generatedAt: "2026-01-01T00:00:01.000Z",
      requestId: "providers_snapshot_update",
    });

    applyProvidersSnapshotUpdate({
      serverId,
      queryClient,
      message: updateMessage([codexEntry("ready", [readyCodexModel])], "/repo-a"),
    });

    const data = queryClient.getQueryData<{ entries: ProviderSnapshotEntry[] }>(
      providersSnapshotQueryKey(serverId, "/repo-a"),
    );
    expect(data?.entries).toEqual([codexEntry("ready", [readyCodexModel])]);
  });

  it("invalidates cached agent commands when a provider snapshot update arrives", () => {
    const commandsKey = draftAgentCommandsQueryKey({
      serverId,
      draftConfig: { provider: "codex", cwd: "/repo-a" },
    });
    queryClient.setQueryData(commandsKey, [{ name: "compact", description: "", argumentHint: "" }]);

    applyProvidersSnapshotUpdate({
      serverId,
      queryClient,
      message: updateMessage([codexEntry("ready", [readyCodexModel])], "/repo-a"),
    });

    expect(queryClient.getQueryState(commandsKey)?.isInvalidated).toBe(true);
  });
});

describe("selectorOpenRefetchDecision", () => {
  it("refetches stale entries when no provider is selected", () => {
    expect(
      selectorOpenRefetchDecision({
        entries: [codexEntry("ready", [readyCodexModel])],
        selectedProvider: null,
      }),
    ).toBe("refetch-stale");
  });

  it("forces a refetch when the selected provider has no entry", () => {
    expect(selectorOpenRefetchDecision({ entries: [], selectedProvider: "codex" })).toBe(
      "refetch-always",
    );
  });

  it("forces a refetch when the selected provider is still loading", () => {
    expect(
      selectorOpenRefetchDecision({
        entries: [codexEntry("loading")],
        selectedProvider: "codex",
      }),
    ).toBe("refetch-always");
  });

  it("keeps a stale-only refetch when the selected provider is ready with no models", () => {
    expect(
      selectorOpenRefetchDecision({
        entries: [codexEntry("ready", [])],
        selectedProvider: "codex",
      }),
    ).toBe("refetch-stale");
  });

  it("keeps a stale-only refetch when the selected provider is ready with models", () => {
    expect(
      selectorOpenRefetchDecision({
        entries: [codexEntry("ready", [readyCodexModel])],
        selectedProvider: "codex",
      }),
    ).toBe("refetch-stale");
  });
});
