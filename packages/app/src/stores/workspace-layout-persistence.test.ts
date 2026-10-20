import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { expect, it } from "vitest";
import type { StateStorage } from "zustand/middleware";
import type { PersistenceScheduler } from "@/storage/throttled-persist-storage";
import {
  collectAllTabs,
  createWorkspaceLayoutStore,
  type WorkspaceLayout,
} from "./workspace-layout-store";

Object.assign(globalThis, { indexedDB, IDBKeyRange });

function createLayoutPersistence() {
  let nowMs = 0;
  let writes = 0;
  let scheduled: { callback: () => void; dueAt: number } | null = null;
  const values = new Map<string, string>();
  const storage: StateStorage = {
    getItem: (name) => values.get(name) ?? null,
    setItem: (name, value) => {
      writes += 1;
      values.set(name, value);
    },
    removeItem: (name) => {
      values.delete(name);
    },
  };
  const scheduler: PersistenceScheduler = {
    now: () => nowMs,
    schedule: (callback, delayMs) => (scheduled = { callback, dueAt: nowMs + delayMs }),
    cancel: () => {
      scheduled = null;
    },
  };
  return {
    storage,
    scheduler,
    writes: () => writes,
    advance(ms: number) {
      nowMs += ms;
      if (scheduled && scheduled.dueAt <= nowMs) {
        const { callback } = scheduled;
        scheduled = null;
        callback();
      }
    },
    storedAgentTabCount(workspaceKey: string): number {
      const raw = values.get("workspace-layout-state") ?? "{}";
      const parsed = JSON.parse(raw) as {
        state: { layoutByWorkspace: Record<string, WorkspaceLayout> };
      };
      const tabs = collectAllTabs(parsed.state.layoutByWorkspace[workspaceKey].root);
      return tabs.filter((tab) => tab.target.kind === "agent").length;
    },
  };
}

it("skips unchanged reconciliations and saves real layout changes", async () => {
  const persistence = createLayoutPersistence();
  const store = createWorkspaceLayoutStore(undefined, persistence.storage, persistence.scheduler);
  await store.persist.rehydrate();
  const workspaceKey = "server:workspace";
  const openAgent = (agentId: string) =>
    store.getState().openTab({
      workspaceKey,
      target: { kind: "agent", agentId },
      intent: "reveal",
    });
  openAgent("agent-1");
  const layout = store.getState().layoutByWorkspace[workspaceKey];
  const writesBefore = persistence.writes();
  expect(writesBefore).toBe(1);
  for (let index = 0; index < 50; index += 1) {
    store.getState().reconcileTabs(workspaceKey, {
      agentsHydrated: true,
      terminalsHydrated: true,
      activeAgentIds: ["agent-1"],
      autoOpenAgentIds: ["agent-1"],
      knownTerminalIds: [],
      standaloneTerminalIds: [],
    });
  }
  persistence.advance(1_000);
  await store.flushPersistence();
  expect(store.getState().layoutByWorkspace[workspaceKey]).toBe(layout);
  expect(persistence.writes()).toBe(writesBefore);

  openAgent("agent-2");
  await store.flushPersistence();
  expect(persistence.writes()).toBe(writesBefore + 1);
  const restored = createWorkspaceLayoutStore(undefined, persistence.storage);
  await restored.persist.rehydrate();
  expect(restored.getState().layoutByWorkspace[workspaceKey]).toEqual(
    store.getState().layoutByWorkspace[workspaceKey],
  );
});

it("coalesces a burst of layout changes into one write per interval", async () => {
  const persistence = createLayoutPersistence();
  const store = createWorkspaceLayoutStore(undefined, persistence.storage, persistence.scheduler);
  await store.persist.rehydrate();
  const workspaceKey = "server:workspace";

  for (let index = 0; index < 50; index += 1) {
    store.getState().openTab({
      workspaceKey,
      target: { kind: "agent", agentId: `agent-${index}` },
      intent: "reveal",
    });
  }
  expect(persistence.writes()).toBe(1);
  expect(persistence.storedAgentTabCount(workspaceKey)).toBe(1);

  persistence.advance(199);
  expect(persistence.writes()).toBe(1);
  persistence.advance(1);
  await store.flushPersistence();

  expect(persistence.writes()).toBe(2);
  expect(persistence.storedAgentTabCount(workspaceKey)).toBe(50);
});
