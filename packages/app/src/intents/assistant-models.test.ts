import { describe, expect, it } from "vitest";
import type { ProviderSnapshotEntry } from "@getpaseo/protocol/agent-types";
import {
  parseAssistantModelsRequest,
  runAssistantModelsQuery,
  type AssistantModelsRequest,
} from "./assistant-models";
import type { AssistantHostClient, AssistantHostConnection } from "./assistant-requests";

const claude: ProviderSnapshotEntry = {
  provider: "claude",
  label: "Claude",
  status: "ready",
  enabled: true,
  defaultModeId: "default",
  modes: [
    { id: "default", label: "Default" },
    { id: "bypassPermissions", label: "Bypass" },
  ],
  models: [
    {
      provider: "claude",
      id: "opus",
      label: "Opus",
      isDefault: true,
      thinkingOptions: [
        { id: "low", label: "Low" },
        { id: "high", label: "High", isDefault: true },
      ],
    },
    { provider: "claude", id: "sonnet", label: "Sonnet" },
    { provider: "claude", id: "legacy", label: "Legacy", isSelectable: false },
  ],
};

function request(patch: Partial<AssistantModelsRequest> = {}): AssistantModelsRequest {
  return {
    requestId: "r",
    serverId: "srv",
    projectId: null,
    provider: null,
    q: null,
    limit: 25,
    ...patch,
  };
}

function host(snapshots: ProviderSnapshotEntry[][]) {
  const cwds: (string | undefined)[] = [];
  let call = 0;
  const client = {
    listProjects: async () => ({
      projects: [{ projectId: "proj-1", projectRootPath: "/repo", projectKind: "git" }],
    }),
    getProvidersSnapshot: async (options?: { cwd?: string }) => {
      cwds.push(options?.cwd);
      return { entries: snapshots[Math.min(call++, snapshots.length - 1)] };
    },
  } as unknown as AssistantHostClient;
  const connection: AssistantHostConnection = {
    kind: "connected",
    client,
    serverName: "ryzen-shine",
  };
  return { connect: async () => connection, cwds };
}

describe("runAssistantModelsQuery", () => {
  it("lists each selectable model with its provider's modes and thinking options", async () => {
    const { connect } = host([[claude, { provider: "codex", status: "ready", enabled: false }]]);

    const rows = await runAssistantModelsQuery({ request: request(), connect });

    expect(rows.map((row) => row.model)).toEqual(["opus", "sonnet"]);
    expect(rows[0]).toEqual({
      serverId: "srv",
      serverName: "ryzen-shine",
      provider: "claude",
      providerLabel: "Claude",
      status: "ready",
      model: "opus",
      modelLabel: "Opus",
      isDefault: 1,
      thinkingOptions: "low, high",
      defaultThinkingOption: "high",
      modes: "default, bypassPermissions",
      defaultMode: "default",
      note: "",
    });
  });

  it("reads the project's directory and waits out loading entries", async () => {
    const { connect, cwds } = host([[{ ...claude, status: "loading", models: [] }], [claude]]);

    const rows = await runAssistantModelsQuery({
      request: request({ projectId: "proj-1" }),
      connect,
      retryDelayMs: 0,
    });

    expect(cwds).toEqual(["/repo", "/repo"]);
    expect(rows).toHaveLength(2);
  });

  it("reports a provider that is not ready as one row with the reason", async () => {
    const { connect } = host([
      [
        {
          provider: "codex",
          label: "Codex",
          status: "error",
          enabled: true,
          error: "Not logged in",
        },
      ],
    ]);

    const rows = await runAssistantModelsQuery({ request: request(), connect });

    expect(rows).toEqual([
      expect.objectContaining({
        provider: "codex",
        status: "error",
        model: "",
        note: "Not logged in",
      }),
    ]);
  });

  it("filters by provider and by one fragment, then applies the limit", async () => {
    const { connect } = host([[claude]]);
    const byFragment = await runAssistantModelsQuery({ request: request({ q: "son" }), connect });
    expect(byFragment.map((row) => row.model)).toEqual(["sonnet"]);
    const limited = await runAssistantModelsQuery({ request: request({ limit: 1 }), connect });
    expect(limited.map((row) => row.model)).toEqual(["opus"]);
    const other = await runAssistantModelsQuery({
      request: request({ provider: "codex" }),
      connect,
    });
    expect(other).toEqual([]);
  });

  it("answers an offline host, an unpaired host, and an unknown project with a notice", async () => {
    const offline = await runAssistantModelsQuery({
      request: request(),
      connect: async () => ({ kind: "offline", serverName: "ryzen-shine" }),
    });
    expect(offline).toEqual([
      expect.objectContaining({ status: "notice", serverName: "ryzen-shine" }),
    ]);
    const unpaired = await runAssistantModelsQuery({
      request: request(),
      connect: async () => ({ kind: "unknown_host" }),
    });
    expect(unpaired[0]?.status).toBe("notice");
    const { connect } = host([[claude]]);
    const unknown = await runAssistantModelsQuery({
      request: request({ projectId: "nope" }),
      connect,
    });
    expect(unknown).toEqual([
      expect.objectContaining({ status: "notice", note: "That project is not on this host." }),
    ]);
  });
});

describe("parseAssistantModelsRequest", () => {
  it("needs a host and lowercases the fragment", () => {
    expect(parseAssistantModelsRequest({ requestId: "r" })).toBeNull();
    expect(parseAssistantModelsRequest({ requestId: "r", serverId: "srv", q: " Son " })).toEqual(
      request({ q: "son" }),
    );
  });
});
