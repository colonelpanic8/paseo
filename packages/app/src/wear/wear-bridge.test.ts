import { describe, expect, it, vi } from "vitest";

import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { WearBridge, type WearBridgeTransport } from "./wear-bridge";
import { parseWearCommand, WEAR_PROTOCOL_VERSION } from "./wear-protocol";
import { buildWearSnapshot, formatAge, providerLabel } from "./wear-snapshot";

const NOW = new Date("2026-07-29T12:00:00Z").getTime();

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    serverId: "srv-1",
    id: "a-1",
    provider: "claude",
    status: "running",
    createdAt: new Date(NOW - 600_000),
    updatedAt: new Date(NOW),
    lastUserMessageAt: null,
    lastActivityAt: new Date(NOW - 720_000),
    capabilities: {} as Agent["capabilities"],
    currentModeId: null,
    availableModes: [],
    pendingPermissions: [],
    persistence: null,
    title: "Rewrite the retry loop",
    cwd: "/home/dev/paseo",
    workspaceId: "ws-1",
    model: null,
    parentAgentId: null,
    labels: {},
    ...overrides,
  } as Agent;
}

function workspace(overrides: Partial<WorkspaceDescriptor> = {}): WorkspaceDescriptor {
  return {
    id: "ws-1",
    projectId: "prj_abc",
    projectDisplayName: "paseo",
    projectRootPath: "/home/dev/paseo",
    workspaceDirectory: "/home/dev/paseo",
    projectKind: "git",
    workspaceKind: "worktree",
    name: "jubilant-wombat",
    status: "active",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
    project: {
      projectKey: "github.com/getpaseo/paseo",
      projectName: "paseo",
      workspaceName: "jubilant-wombat",
      checkout: {} as NonNullable<WorkspaceDescriptor["project"]>["checkout"],
    },
    ...overrides,
  } as WorkspaceDescriptor;
}

function workspaceMap(...items: WorkspaceDescriptor[]): Map<string, WorkspaceDescriptor> {
  return new Map(items.map((item) => [item.id, item]));
}

describe("formatAge", () => {
  it("renders wrist-sized durations", () => {
    expect(formatAge(new Date(NOW - 5_000), NOW)).toBe("now");
    expect(formatAge(new Date(NOW - 12 * 60_000), NOW)).toBe("12m");
    expect(formatAge(new Date(NOW - 3 * 3_600_000), NOW)).toBe("3h");
    expect(formatAge(new Date(NOW - 50 * 3_600_000), NOW)).toBe("2d");
  });

  it("never renders a negative age from clock skew", () => {
    expect(formatAge(new Date(NOW + 60_000), NOW)).toBe("now");
  });
});

describe("providerLabel", () => {
  it("maps known provider ids to display names", () => {
    expect(providerLabel("claude")).toBe("Claude");
    expect(providerLabel("omp")).toBe("Oh My Pi");
  });

  it("falls back to capitalising an unknown provider", () => {
    expect(providerLabel("newthing")).toBe("Newthing");
  });
});

describe("buildWearSnapshot", () => {
  it("groups agents under their workspace and carries project identity", () => {
    const snapshot = buildWearSnapshot(
      [{ serverId: "srv-1", agents: [agent()], workspaces: workspaceMap(workspace()) }],
      NOW,
    );

    expect(snapshot.v).toBe(WEAR_PROTOCOL_VERSION);
    expect(snapshot.workspaces).toHaveLength(1);
    const ws = snapshot.workspaces[0];
    expect(ws.name).toBe("jubilant-wombat");
    expect(ws.projectKey).toBe("github.com/getpaseo/paseo");
    expect(ws.serverId).toBe("srv-1");
    expect(ws.agents[0]).toMatchObject({
      provider: "Claude",
      state: "running",
      age: "12m",
      summary: "Rewrite the retry loop",
    });
  });

  it("includes a workspace that has no agents", () => {
    // Regression: the builder used to group by agent, so an agent-less workspace
    // vanished. That broke the empty-workspace row and its go-straight-to-voice
    // navigation rule.
    const snapshot = buildWearSnapshot(
      [{ serverId: "srv-1", agents: [], workspaces: workspaceMap(workspace()) }],
      NOW,
    );
    expect(snapshot.workspaces).toHaveLength(1);
    expect(snapshot.workspaces[0].agents).toEqual([]);
  });

  it("still emits workspaces when nothing is running anywhere", () => {
    // The failure this caused was worse than a missing row: with no agents at all
    // the snapshot came out empty and the watch showed "open Paseo on your phone"
    // as though the bridge were down.
    const snapshot = buildWearSnapshot(
      [
        {
          serverId: "srv-1",
          agents: [],
          workspaces: workspaceMap(workspace(), workspace({ id: "ws-2", name: "other" })),
        },
      ],
      NOW,
    );
    expect(snapshot.workspaces.map((entry) => entry.name)).toEqual(["jubilant-wombat", "other"]);
  });

  it("omits a workspace that is being archived", () => {
    const snapshot = buildWearSnapshot(
      [
        {
          serverId: "srv-1",
          agents: [agent()],
          workspaces: workspaceMap(workspace({ archivingAt: "2026-07-29T00:00:00Z" })),
        },
      ],
      NOW,
    );
    expect(snapshot.workspaces).toHaveLength(0);
  });

  it("sorts agent-less workspaces after idle ones", () => {
    const snapshot = buildWearSnapshot(
      [
        {
          serverId: "srv-1",
          agents: [agent({ id: "a-idle", workspaceId: "ws-idle", status: "idle" })],
          workspaces: workspaceMap(
            workspace({ id: "ws-empty", name: "aaa-empty" }),
            workspace({ id: "ws-idle", name: "zzz-idle" }),
          ),
        },
      ],
      NOW,
    );
    // Name ordering would put the empty one first; urgency must win.
    expect(snapshot.workspaces.map((entry) => entry.name)).toEqual(["zzz-idle", "aaa-empty"]);
  });

  it("drops agents whose workspace is unknown rather than inventing a parent", () => {
    const snapshot = buildWearSnapshot(
      [
        {
          serverId: "srv-1",
          agents: [agent({ workspaceId: "ws-missing" })],
          workspaces: workspaceMap(workspace()),
        },
      ],
      NOW,
    );
    // The agent is dropped — no synthetic parent workspace is invented for it —
    // but the known workspace is still listed, now with nothing in it.
    expect(snapshot.workspaces.map((entry) => entry.id)).toEqual(["ws-1"]);
    expect(snapshot.workspaces[0].agents).toEqual([]);
  });

  it("omits archived agents but keeps their workspace", () => {
    const snapshot = buildWearSnapshot(
      [
        {
          serverId: "srv-1",
          agents: [agent({ archivedAt: new Date(NOW) })],
          workspaces: workspaceMap(workspace()),
        },
      ],
      NOW,
    );
    expect(snapshot.workspaces).toHaveLength(1);
    expect(snapshot.workspaces[0].agents).toEqual([]);
  });

  it("marks an agent with a pending permission as needsInput and extracts the command", () => {
    const withPermission = agent({
      pendingPermissions: [
        {
          id: "perm-1",
          provider: "claude",
          name: "Bash",
          kind: "tool",
          input: { command: "git push origin jubilant-wombat" },
        } as Agent["pendingPermissions"][number],
      ],
    });

    const snapshot = buildWearSnapshot(
      [{ serverId: "srv-1", agents: [withPermission], workspaces: workspaceMap(workspace()) }],
      NOW,
    );

    const entry = snapshot.workspaces[0].agents[0];
    expect(entry.state).toBe("needsInput");
    expect(entry.permission).toEqual({
      id: "perm-1",
      title: "Run command?",
      detail: "git push origin jubilant-wombat",
    });
  });

  it("sorts needs-attention workspaces ahead of running and idle ones", () => {
    const idle = workspace({ id: "ws-idle", name: "zeta" });
    const urgent = workspace({ id: "ws-urgent", name: "alpha" });
    const running = workspace({ id: "ws-running", name: "mid" });

    const snapshot = buildWearSnapshot(
      [
        {
          serverId: "srv-1",
          agents: [
            agent({ id: "a-idle", workspaceId: "ws-idle", status: "idle" }),
            agent({
              id: "a-urgent",
              workspaceId: "ws-urgent",
              pendingPermissions: [
                {
                  id: "p",
                  provider: "claude",
                  name: "Bash",
                  kind: "tool",
                } as Agent["pendingPermissions"][number],
              ],
            }),
            agent({ id: "a-running", workspaceId: "ws-running", status: "running" }),
          ],
          workspaces: workspaceMap(idle, urgent, running),
        },
      ],
      NOW,
    );

    expect(snapshot.workspaces.map((entry) => entry.name)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("merges multiple daemons into one list", () => {
    const snapshot = buildWearSnapshot(
      [
        { serverId: "srv-1", agents: [agent()], workspaces: workspaceMap(workspace()) },
        {
          serverId: "srv-2",
          agents: [agent({ id: "a-2", workspaceId: "ws-2" })],
          workspaces: workspaceMap(workspace({ id: "ws-2", name: "other" })),
        },
      ],
      NOW,
    );
    expect(snapshot.workspaces.map((entry) => entry.serverId).sort()).toEqual(["srv-1", "srv-2"]);
  });
});

describe("parseWearCommand", () => {
  it("parses each command kind", () => {
    expect(
      parseWearCommand(
        JSON.stringify({ v: 1, kind: "sendPrompt", serverId: "s", agentId: "a", text: "hi" }),
      ),
    ).toEqual({ kind: "sendPrompt", serverId: "s", agentId: "a", text: "hi" });

    expect(
      parseWearCommand(
        JSON.stringify({
          v: 1,
          kind: "respondPermission",
          serverId: "s",
          agentId: "a",
          requestId: "r",
          allow: false,
        }),
      ),
    ).toEqual({
      kind: "respondPermission",
      serverId: "s",
      agentId: "a",
      requestId: "r",
      allow: false,
    });

    expect(parseWearCommand(JSON.stringify({ kind: "refresh" }))).toEqual({ kind: "refresh" });
  });

  it("rejects malformed, incomplete, and wrong-version commands", () => {
    expect(parseWearCommand("{ not json")).toBeNull();
    expect(parseWearCommand(JSON.stringify({ kind: "sendPrompt", serverId: "s" }))).toBeNull();
    expect(
      parseWearCommand(JSON.stringify({ v: 99, kind: "stopAgent", serverId: "s", agentId: "a" })),
    ).toBeNull();
    // allow must be a real boolean; a truthy string is a protocol error, not a yes.
    expect(
      parseWearCommand(
        JSON.stringify({
          v: 1,
          kind: "respondPermission",
          serverId: "s",
          agentId: "a",
          requestId: "r",
          allow: "yes",
        }),
      ),
    ).toBeNull();
  });
});

function makeTransport(): WearBridgeTransport & {
  published: string[];
  emit: (payload: string) => void;
} {
  const published: string[] = [];
  let listener: ((payload: string) => void) | null = null;
  return {
    published,
    emit: (payload) => listener?.(payload),
    publishSnapshot: async (payload) => {
      published.push(payload);
      return true;
    },
    addCommandListener: (next) => {
      listener = next;
      return {
        remove: () => {
          listener = null;
        },
      };
    },
    drainPendingCommands: async () => [],
  };
}

describe("WearBridge", () => {
  const baseState = () => [
    { serverId: "srv-1", agents: [agent()], workspaces: workspaceMap(workspace()) },
  ];

  it("publishes once and skips republishing an unchanged snapshot", async () => {
    const transport = makeTransport();
    const bridge = new WearBridge({
      transport,
      readState: baseState,
      getClient: () => null,
      resolveNewAgentConfig: () => null,
      now: () => NOW,
    });

    await bridge.start();
    expect(transport.published).toHaveLength(1);

    await bridge.publish();
    // Nothing changed, so the Data Layer is left alone.
    expect(transport.published).toHaveLength(1);
    bridge.stop();
  });

  it("republishes when the snapshot content actually changes", async () => {
    const transport = makeTransport();
    let status: Agent["status"] = "running";
    const bridge = new WearBridge({
      transport,
      readState: () => [
        { serverId: "srv-1", agents: [agent({ status })], workspaces: workspaceMap(workspace()) },
      ],
      getClient: () => null,
      resolveNewAgentConfig: () => null,
      now: () => NOW,
    });

    await bridge.start();
    status = "idle";
    await bridge.publish();
    expect(transport.published).toHaveLength(2);
    bridge.stop();
  });

  it("routes a permission response to the right daemon client", async () => {
    const transport = makeTransport();
    const respondToPermission = vi.fn().mockResolvedValue(undefined);
    const bridge = new WearBridge({
      transport,
      readState: baseState,
      getClient: (serverId) => (serverId === "srv-1" ? ({ respondToPermission } as never) : null),
      resolveNewAgentConfig: () => null,
      now: () => NOW,
    });
    await bridge.start();

    await bridge.execute({
      kind: "respondPermission",
      serverId: "srv-1",
      agentId: "a-1",
      requestId: "perm-1",
      allow: true,
    });

    expect(respondToPermission).toHaveBeenCalledWith("a-1", "perm-1", { behavior: "allow" });
    bridge.stop();
  });

  it("maps deny to a deny behavior rather than an allow with a flag", async () => {
    const transport = makeTransport();
    const respondToPermission = vi.fn().mockResolvedValue(undefined);
    const bridge = new WearBridge({
      transport,
      readState: baseState,
      getClient: () => ({ respondToPermission }) as never,
      resolveNewAgentConfig: () => null,
      now: () => NOW,
    });
    await bridge.start();

    await bridge.execute({
      kind: "respondPermission",
      serverId: "srv-1",
      agentId: "a-1",
      requestId: "perm-1",
      allow: false,
    });

    expect(respondToPermission).toHaveBeenCalledWith("a-1", "perm-1", { behavior: "deny" });
    bridge.stop();
  });

  it("delivers a prompt received over the native command listener", async () => {
    const transport = makeTransport();
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    const bridge = new WearBridge({
      transport,
      readState: baseState,
      getClient: () => ({ sendAgentMessage }) as never,
      resolveNewAgentConfig: () => null,
      now: () => NOW,
    });
    await bridge.start();

    transport.emit(
      JSON.stringify({
        v: 1,
        kind: "sendPrompt",
        serverId: "srv-1",
        agentId: "a-1",
        text: "rerun tests",
      }),
    );
    await vi.waitFor(() => expect(sendAgentMessage).toHaveBeenCalledWith("a-1", "rerun tests"));
    bridge.stop();
  });

  it("drops commands for a server that is not connected instead of throwing", async () => {
    const transport = makeTransport();
    const warn = vi.fn();
    const bridge = new WearBridge({
      transport,
      readState: baseState,
      getClient: () => null,
      resolveNewAgentConfig: () => null,
      now: () => NOW,
      logger: { warn },
    });
    await bridge.start();

    await expect(
      bridge.execute({ kind: "stopAgent", serverId: "gone", agentId: "a-1" }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    bridge.stop();
  });

  it("survives a daemon call that rejects", async () => {
    const transport = makeTransport();
    const warn = vi.fn();
    const bridge = new WearBridge({
      transport,
      readState: baseState,
      getClient: () => ({ cancelAgent: vi.fn().mockRejectedValue(new Error("boom")) }) as never,
      resolveNewAgentConfig: () => null,
      now: () => NOW,
      logger: { warn },
    });
    await bridge.start();

    await expect(
      bridge.execute({ kind: "stopAgent", serverId: "srv-1", agentId: "a-1" }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    bridge.stop();
  });

  it("drains commands queued while the app process was dead, before first publish", async () => {
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);
    const transport = makeTransport();
    transport.drainPendingCommands = async () => [
      JSON.stringify({
        v: 1,
        kind: "sendPrompt",
        serverId: "srv-1",
        agentId: "a-1",
        text: "queued",
      }),
    ];

    const bridge = new WearBridge({
      transport,
      readState: baseState,
      getClient: () => ({ sendAgentMessage }) as never,
      resolveNewAgentConfig: () => null,
      now: () => NOW,
    });

    await bridge.start();
    expect(sendAgentMessage).toHaveBeenCalledWith("a-1", "queued");
    bridge.stop();
  });

  it("answers a refresh request with a forced republish", async () => {
    const transport = makeTransport();
    const bridge = new WearBridge({
      transport,
      readState: baseState,
      getClient: () => null,
      resolveNewAgentConfig: () => null,
      now: () => NOW,
    });
    await bridge.start();
    expect(transport.published).toHaveLength(1);

    await bridge.execute({ kind: "refresh" });
    // Forced, so it republishes even though nothing changed.
    expect(transport.published).toHaveLength(2);
    bridge.stop();
  });

  it("creates an agent using the provider the phone resolved", async () => {
    const transport = makeTransport();
    const createAgent = vi.fn().mockResolvedValue({});
    const bridge = new WearBridge({
      transport,
      readState: baseState,
      getClient: () => ({ createAgent }) as never,
      resolveNewAgentConfig: () => ({ provider: "claude", cwd: "/home/dev/paseo" }),
      now: () => NOW,
    });
    await bridge.start();

    await bridge.execute({
      kind: "createAgent",
      serverId: "srv-1",
      workspaceId: "ws-1",
      text: "fix the flaky test",
    });

    expect(createAgent).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      provider: "claude",
      cwd: "/home/dev/paseo",
      initialPrompt: "fix the flaky test",
    });
    bridge.stop();
  });

  it("refuses to create an agent when no provider can be resolved", async () => {
    const transport = makeTransport();
    const createAgent = vi.fn();
    const warn = vi.fn();
    const bridge = new WearBridge({
      transport,
      readState: baseState,
      getClient: () => ({ createAgent }) as never,
      resolveNewAgentConfig: () => null,
      now: () => NOW,
      logger: { warn },
    });
    await bridge.start();

    await bridge.execute({
      kind: "createAgent",
      serverId: "srv-1",
      workspaceId: "ws-1",
      text: "anything",
    });

    expect(createAgent).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    bridge.stop();
  });
});
