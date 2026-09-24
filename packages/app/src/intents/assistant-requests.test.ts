import { describe, expect, it } from "vitest";
import { DaemonConnectionError } from "@getpaseo/client/internal/daemon-client";
import type { CreationSnapshot } from "@getpaseo/protocol/messages";
import {
  runAssistantRequest,
  type AssistantHostClient,
  type AssistantHostConnection,
  type AssistantRequestJob,
  type AssistantRequestPlan,
  type AssistantRequestUpdate,
} from "./assistant-requests";

const KEY = "k".repeat(64);

function snapshot(patch: Partial<CreationSnapshot>): CreationSnapshot {
  return {
    kind: "workspace",
    idempotencyKey: `assistant:${KEY}`,
    revision: 1,
    phase: "accepted",
    workspaceId: null,
    agentId: null,
    error: null,
    ...patch,
  };
}

interface FakeHost {
  client: AssistantHostClient;
  calls: string[];
  createInputs: Record<string, unknown>[];
  sendInputs: unknown[][];
}

function fakeHost(options: {
  features?: Record<string, boolean>;
  create?: (input: Record<string, unknown>) => Promise<unknown>;
  send?: () => Promise<void>;
  loadingSnapshots?: number;
}): FakeHost {
  let snapshots = 0;
  const calls: string[] = [];
  const createInputs: Record<string, unknown>[] = [];
  const sendInputs: unknown[][] = [];
  const client = {
    getLastServerInfoMessage: () => ({
      features: options.features ?? {
        creationLifecycle: true,
        workspaceRequestReceipts: true,
        workspaceMultiplicity: true,
        agentRequestReceipts: true,
      },
    }),
    listProjects: async () => {
      calls.push("listProjects");
      return {
        projects: [
          { projectId: "proj-1", projectRootPath: "/repo", projectKind: "git" },
          { projectId: "plain", projectRootPath: "/plain", projectKind: "directory" },
        ],
      };
    },
    getProvidersSnapshot: async () => ({
      entries: [
        {
          provider: "claude",
          status: (snapshots += 1) <= (options.loadingSnapshots ?? 0) ? "loading" : "ready",
          enabled: true,
          models: [{ id: "opus" }, { id: "sonnet" }],
          modes: [{ id: "default" }, { id: "bypassPermissions" }],
        },
      ],
    }),
    getCheckoutStatus: async () => ({
      currentBranch: "main",
      upstreamRef: "refs/remotes/origin/main",
    }),
    createWorkspace: async (input: Record<string, unknown>) => {
      calls.push("createWorkspace");
      createInputs.push(input);
      return options.create
        ? options.create(input)
        : { creation: snapshot({ phase: "completed" }), error: null };
    },
    fetchAgent: async (agentId: string) =>
      agentId === "agent-1" ? { agent: { id: "agent-1", archivedAt: null }, project: null } : null,
    sendAgentMessage: async (...args: unknown[]) => {
      calls.push("sendAgentMessage");
      sendInputs.push(args);
      await options.send?.();
    },
  } as unknown as AssistantHostClient;
  return { client, calls, createInputs, sendInputs };
}

/** Mirrors the native journal: the first plan wins and is echoed back. */
function fakeJournal(
  input: { calls?: string[]; storedPlan?: AssistantRequestPlan; failCommit?: boolean } = {},
) {
  const updates: AssistantRequestUpdate[] = [];
  let plan: AssistantRequestPlan | undefined = input.storedPlan;
  let state = "accepted";
  const report = async (update: AssistantRequestUpdate) => {
    if (update.dispatchStarted && input.failCommit) throw new Error("disk full");
    input.calls?.push(`report:${update.state ?? ""}${update.dispatchStarted ? ":dispatch" : ""}`);
    updates.push(update);
    plan ??= update.plan;
    state = update.state ?? state;
    return { state, plan };
  };
  return { updates, report, last: () => updates.at(-1) };
}

function createJob(
  args: Record<string, unknown>,
  plan: AssistantRequestPlan | null = null,
): AssistantRequestJob {
  return {
    key: KEY,
    operation: "create_agent",
    arguments: {
      serverId: "srv",
      projectId: "proj-1",
      prompt: "Fix the flaky test",
      isolation: "worktree",
      provider: "claude",
      ...args,
    },
    plan,
    dispatchStarted: plan !== null,
  };
}

function deps(
  connection: AssistantHostConnection,
  journal: ReturnType<typeof fakeJournal>,
  preferences: Record<string, unknown> = {},
) {
  return {
    connect: async () => connection,
    loadFormPreferences: async () => preferences,
    report: journal.report,
    dispatchTimeoutMs: 1_000,
  };
}

describe("runAssistantRequest create_agent", () => {
  it("commits the plan with dispatchStarted before the daemon sees it, then completes on prompt start", async () => {
    const host = fakeHost({
      create: async (input) => {
        (input.onEvent as (s: CreationSnapshot) => void)(
          snapshot({ phase: "workspace_ready", workspaceId: "ws-1" }),
        );
        return {
          creation: snapshot({ phase: "prompt_started", workspaceId: "ws-1", agentId: "ag-1" }),
          error: null,
        };
      },
    });
    const journal = fakeJournal({ calls: host.calls });

    await runAssistantRequest(
      createJob({}),
      deps({ kind: "connected", client: host.client }, journal),
    );

    expect(host.calls.indexOf("report:accepted:dispatch")).toBeLessThan(
      host.calls.indexOf("createWorkspace"),
    );
    const request = host.createInputs[0];
    expect(request.idempotencyKey).toBe(`assistant:${KEY}`);
    expect(request.source).toMatchObject({
      kind: "worktree",
      cwd: "/repo",
      projectId: "proj-1",
      action: "branch-off",
      refName: "refs/remotes/origin/main",
    });
    expect(request.agent).toMatchObject({
      initialPrompt: "Fix the flaky test",
      clientMessageId: `assistant:${KEY}:initial-message`,
    });
    expect(journal.last()).toEqual({ state: "completed", workspaceId: "ws-1", agentId: "ag-1" });
  });

  it("replays the persisted plan verbatim without re-resolving defaults", async () => {
    const host = fakeHost({});
    const plan: AssistantRequestPlan = {
      kind: "create_agent",
      request: {
        idempotencyKey: `assistant:${KEY}`,
        source: { kind: "directory", path: "/repo", projectId: "proj-1" },
      },
    };
    const journal = fakeJournal({ storedPlan: plan });

    await runAssistantRequest(
      createJob({}, plan),
      deps({ kind: "connected", client: host.client }, journal),
    );

    expect(host.calls).toEqual(["createWorkspace"]);
    expect(host.createInputs[0]).toMatchObject(plan.request);
    expect(journal.last()?.state).toBe("completed");
  });

  it("dispatches the plan another run already committed", async () => {
    const host = fakeHost({});
    const earlier: AssistantRequestPlan = {
      kind: "create_agent",
      request: {
        idempotencyKey: `assistant:${KEY}`,
        source: { kind: "worktree", worktreeSlug: "first-run" },
      },
    };
    const journal = fakeJournal({ storedPlan: earlier });

    await runAssistantRequest(
      createJob({}),
      deps({ kind: "connected", client: host.client }, journal),
    );

    expect(host.createInputs[0].source).toEqual({ kind: "worktree", worktreeSlug: "first-run" });
  });

  it("reports an unknown daemon outcome as uncertain", async () => {
    const host = fakeHost({
      create: async () => ({
        creation: snapshot({
          phase: "failed",
          failedStage: "prompt",
          outcomeUnknown: true,
          error: "restart",
        }),
        error: "restart",
      }),
    });
    const journal = fakeJournal();

    await runAssistantRequest(
      createJob({}),
      deps({ kind: "connected", client: host.client }, journal),
    );

    expect(journal.last()?.state).toBe("uncertain");
  });

  it("leaves the request pending when the connection drops mid-creation", async () => {
    const host = fakeHost({
      create: async () => {
        throw new DaemonConnectionError("lost");
      },
    });
    const journal = fakeJournal();

    await runAssistantRequest(
      createJob({}),
      deps({ kind: "connected", client: host.client }, journal),
    );

    expect(journal.updates.map((update) => update.state)).toEqual(["accepted"]);
  });

  it("never dispatches when the plan cannot be committed", async () => {
    const host = fakeHost({});
    const journal = fakeJournal({ failCommit: true });

    await runAssistantRequest(
      createJob({}),
      deps({ kind: "connected", client: host.client }, journal),
    );

    expect(host.calls).not.toContain("createWorkspace");
  });

  it("uses saved provider and model but never a saved permission mode", async () => {
    const host = fakeHost({});
    const journal = fakeJournal();

    await runAssistantRequest(
      createJob({ isolation: "local", provider: undefined }),
      deps({ kind: "connected", client: host.client }, journal, {
        provider: "claude",
        providerPreferences: { claude: { model: "sonnet", mode: "bypassPermissions" } },
      }),
    );

    const config = (host.createInputs[0].agent as { config: Record<string, unknown> }).config;
    expect(config).toEqual({ provider: "claude", cwd: "/repo", model: "sonnet" });
    expect(host.createInputs[0].source).toEqual({
      kind: "directory",
      path: "/repo",
      projectId: "proj-1",
    });
  });

  it.each([
    ["an unknown project", { projectId: "gone" }, {}, "rejected", "unknown_project"],
    [
      "a worktree on a non-git project",
      { projectId: "plain" },
      {},
      "rejected",
      "worktree_unsupported",
    ],
    ["a provider the host lacks", { provider: "codex" }, {}, "rejected", "unknown_provider"],
    ["a mode the provider lacks", { modeId: "yolo" }, {}, "rejected", "unknown_mode"],
  ])("rejects %s without dispatching", async (_label, args, preferences, state, code) => {
    const host = fakeHost({});
    const journal = fakeJournal();

    await runAssistantRequest(
      createJob({ ...(preferences === null ? { provider: undefined } : {}), ...args }),
      deps({ kind: "connected", client: host.client }, journal, {}),
    );

    expect(host.calls).not.toContain("createWorkspace");
    expect(journal.last()).toMatchObject({ state, error: { code } });
  });

  it("waits out the host's first loading provider snapshot for a new directory", async () => {
    const host = fakeHost({ loadingSnapshots: 1 });
    const journal = fakeJournal();

    await runAssistantRequest(
      createJob({}),
      deps({ kind: "connected", client: host.client }, journal),
    );

    expect(host.calls).toContain("createWorkspace");
    expect(journal.last()?.state).toBe("completed");
  });

  it("falls back to the host's first ready provider when none is named or saved", async () => {
    const host = fakeHost({});
    const journal = fakeJournal();

    await runAssistantRequest(
      createJob({ isolation: "local", provider: undefined }),
      deps({ kind: "connected", client: host.client }, journal),
    );

    const config = (host.createInputs[0].agent as { config: Record<string, unknown> }).config;
    expect(config).toEqual({ provider: "claude", cwd: "/repo" });
    expect(journal.last()?.state).toBe("completed");
  });

  it("asks for configuration when no provider is ready and none is named", async () => {
    const host = fakeHost({ loadingSnapshots: 99 });
    const journal = fakeJournal();

    await runAssistantRequest(
      createJob({ provider: undefined }),
      deps({ kind: "connected", client: host.client }, journal),
    );

    expect(host.calls).not.toContain("createWorkspace");
    expect(journal.last()).toMatchObject({
      state: "needs_configuration",
      error: { code: "provider_required" },
    });
  }, 10_000);

  it("asks for a host update instead of degrading on an old daemon", async () => {
    const host = fakeHost({ features: { creationLifecycle: true } });
    const journal = fakeJournal();

    await runAssistantRequest(
      createJob({}),
      deps({ kind: "connected", client: host.client }, journal),
    );

    expect(journal.last()).toMatchObject({ state: "needs_host_update" });
  });

  it("waits for an offline host and refuses an unpaired one", async () => {
    const offline = fakeJournal();
    await runAssistantRequest(createJob({}), deps({ kind: "offline" }, offline));
    expect(offline.last()).toMatchObject({ state: "waiting_for_host" });

    const unpaired = fakeJournal();
    await runAssistantRequest(createJob({}), deps({ kind: "unknown_host" }, unpaired));
    expect(unpaired.last()).toMatchObject({ state: "rejected", error: { code: "unknown_host" } });
  });
});

describe("runAssistantRequest send_prompt", () => {
  const sendJob: AssistantRequestJob = {
    key: KEY,
    operation: "send_prompt",
    arguments: { serverId: "srv", agentId: "agent-1", prompt: "Run the tests" },
    plan: null,
    dispatchStarted: false,
  };

  it("sends once with a stable message id and steers a running turn by default", async () => {
    const host = fakeHost({});
    const journal = fakeJournal({ calls: host.calls });

    await runAssistantRequest(sendJob, deps({ kind: "connected", client: host.client }, journal));

    expect(host.calls.indexOf("report:accepted:dispatch")).toBeLessThan(
      host.calls.indexOf("sendAgentMessage"),
    );
    expect(host.sendInputs[0]).toEqual([
      "agent-1",
      "Run the tests",
      { messageId: `assistant:${KEY}:message`, activeTurnBehavior: "steer" },
    ]);
    expect(journal.last()).toEqual({ state: "completed", agentId: "agent-1" });
  });

  it("maps the daemon's outcome-unknown receipt to uncertain and a refusal to failed", async () => {
    const unknown = fakeJournal();
    await runAssistantRequest(
      sendJob,
      deps(
        {
          kind: "connected",
          client: fakeHost({
            send: async () => {
              throw new Error("agent_request_outcome_unknown");
            },
          }).client,
        },
        unknown,
      ),
    );
    expect(unknown.last()?.state).toBe("uncertain");

    const refused = fakeJournal();
    await runAssistantRequest(
      sendJob,
      deps(
        {
          kind: "connected",
          client: fakeHost({
            send: async () => {
              throw new Error("Agent is busy");
            },
          }).client,
        },
        refused,
      ),
    );
    expect(refused.last()).toMatchObject({ state: "failed", error: { code: "send_rejected" } });
  });

  it("rejects an unknown agent without sending", async () => {
    const host = fakeHost({});
    const journal = fakeJournal();

    await runAssistantRequest(
      { ...sendJob, arguments: { serverId: "srv", agentId: "nope", prompt: "hi" } },
      deps({ kind: "connected", client: host.client }, journal),
    );

    expect(host.calls).not.toContain("sendAgentMessage");
    expect(journal.last()).toMatchObject({ state: "rejected", error: { code: "unknown_agent" } });
  });
});
