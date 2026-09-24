import { resolve, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import pino from "pino";
import type { Logger } from "pino";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  setupAutoArchiveOnMerge,
  type AutoArchiveOnMergeDependencies,
  type AutoArchiveOnMergeOptions,
} from "./index.js";
import type { WorkspaceGitRuntimeSnapshot } from "../workspace-git-service.js";
import {
  FileBackedWorkspaceRegistry,
  createPersistedWorkspaceRecord,
  createPersistedProjectRecord,
  FileBackedProjectRegistry,
} from "../workspace-registry.js";
import { createWorkspaceProvisioningService } from "../session/workspace-provisioning/workspace-provisioning-service.js";
import { createNoopWorkspaceGitService } from "../test-utils/workspace-git-service-stub.js";

let directory: string;
let workspaceRegistry: FileBackedWorkspaceRegistry;
const logger = pino({ level: "silent" });
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "auto-archive-restore-"));
  workspaceRegistry = new FileBackedWorkspaceRegistry(join(directory, "workspaces.json"), logger);
  for (const [workspaceId, cwd] of [
    ["workspace-a", "/repo/worktree"],
    ["workspace-b", "/repo/worktree"],
    ["workspace-other", "/repo/other"],
  ]) {
    await workspaceRegistry.upsert(
      createPersistedWorkspaceRecord({
        workspaceId,
        cwd,
        projectId: "project",
        kind: "worktree",
        worktreeRoot: cwd,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        displayName: workspaceId,
      }),
    );
  }
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function createSnapshot(
  cwd: string,
  state: "open" | "merged" = "merged",
): WorkspaceGitRuntimeSnapshot {
  return {
    cwd,
    git: {
      isGit: true,
      repoRoot: cwd,
      mainRepoRoot: "/repo",
      currentBranch: "feature",
      remoteUrl: "https://github.com/acme/repo.git",
      isPaseoOwnedWorktree: true,
      isDirty: false,
      baseRef: "main",
      aheadBehind: { ahead: 0, behind: 0 },
      aheadOfOrigin: 0,
      behindOfOrigin: 0,
      hasRemote: true,
      diffStat: { additions: 0, deletions: 0 },
    },
    forge: {
      featuresEnabled: true,
      authState: "authenticated",
      pullRequest: {
        url: "https://github.com/acme/repo/pull/12",
        title: "Feature",
        state,
        baseRefName: "main",
        headRefName: "feature",
        isMerged: state === "merged",
      },
      error: null,
    },
  };
}

test("fans one fresh observation out to every workspace attached to its exact cwd", async () => {
  let onSnapshotUpdated: ((snapshot: WorkspaceGitRuntimeSnapshot) => void) | null = null;
  const eventSnapshot = createSnapshot("/repo/worktree/.");
  const freshSnapshot = createSnapshot("/repo/worktree");
  const getSnapshot = vi.fn(async () => freshSnapshot);
  const options = {
    workspaceRegistry,
    logger: { child: () => ({ warn: vi.fn() }) } as unknown as Logger,
    daemonConfigStore: { get: () => ({ autoArchiveAfterMerge: true }) },
    workspaceGitService: {
      onSnapshotUpdated: (listener: (next: WorkspaceGitRuntimeSnapshot) => void) => {
        onSnapshotUpdated = listener;
        return { unsubscribe: vi.fn() };
      },
      getSnapshot,
    },
    listActiveWorkspaces: async () => [
      { workspaceId: "workspace-a", cwd: "/repo/worktree" },
      { workspaceId: "workspace-b", cwd: "/repo/worktree/child/.." },
      { workspaceId: "workspace-other", cwd: "/repo/other" },
    ],
  } as unknown as AutoArchiveOnMergeOptions;
  const calls: Array<{ workspaceId: string; pullRequest: unknown }> = [];
  let resolveFinished: (() => void) | null = null;
  const finished = new Promise<void>((resolvePromise) => {
    resolveFinished = resolvePromise;
  });
  const deps: AutoArchiveOnMergeDependencies = {
    archiveIfSafe: async (input) => {
      calls.push({
        workspaceId: input.workspaceId,
        pullRequest: input.snapshot.forge.pullRequest,
      });
      if (calls.length === 2) resolveFinished?.();
    },
    resolvePath: resolve,
  };

  setupAutoArchiveOnMerge(options, deps);
  if (!onSnapshotUpdated) throw new Error("Snapshot listener was not registered");
  onSnapshotUpdated(createSnapshot("/repo/worktree/.", "open"));
  onSnapshotUpdated(eventSnapshot);
  await finished;

  expect(getSnapshot).toHaveBeenCalledTimes(1);
  expect(calls).toEqual([
    { workspaceId: "workspace-a", pullRequest: freshSnapshot.forge.pullRequest },
    { workspaceId: "workspace-b", pullRequest: freshSnapshot.forge.pullRequest },
  ]);
});

test("serializes the complete fan-out for duplicate merge events on one cwd", async () => {
  let onSnapshotUpdated: ((snapshot: WorkspaceGitRuntimeSnapshot) => void) | null = null;
  const snapshot = createSnapshot("/repo/worktree/.");
  const options = {
    workspaceRegistry,
    logger: { child: () => ({ warn: vi.fn() }) } as unknown as Logger,
    daemonConfigStore: { get: () => ({ autoArchiveAfterMerge: true }) },
    workspaceGitService: {
      onSnapshotUpdated: (listener: (next: WorkspaceGitRuntimeSnapshot) => void) => {
        onSnapshotUpdated = listener;
        return { unsubscribe: vi.fn() };
      },
      getSnapshot: async () => snapshot,
    },
    listActiveWorkspaces: async () => [
      { workspaceId: "workspace-a", cwd: "/repo/worktree" },
      { workspaceId: "workspace-b", cwd: "/repo/worktree/child/.." },
    ],
  } as unknown as AutoArchiveOnMergeOptions;
  const archivedWorkspaceIds: string[] = [];
  let releaseFirstArchive: (() => void) | null = null;
  const firstArchivePaused = new Promise<void>((resolvePromise) => {
    releaseFirstArchive = resolvePromise;
  });
  let resolveFinished: (() => void) | null = null;
  const finished = new Promise<void>((resolvePromise) => {
    resolveFinished = resolvePromise;
  });
  const deps: AutoArchiveOnMergeDependencies = {
    archiveIfSafe: async (input) => {
      archivedWorkspaceIds.push(input.workspaceId);
      if (input.workspaceId === "workspace-a") {
        await firstArchivePaused;
      }
      if (archivedWorkspaceIds.length === 2) resolveFinished?.();
    },
    resolvePath: resolve,
  };

  setupAutoArchiveOnMerge(options, deps);
  if (!onSnapshotUpdated) throw new Error("Snapshot listener was not registered");
  onSnapshotUpdated(createSnapshot("/repo/worktree/.", "open"));
  onSnapshotUpdated(snapshot);
  await vi.waitFor(() => expect(archivedWorkspaceIds).toEqual(["workspace-a"]));

  onSnapshotUpdated(createSnapshot("/repo/worktree/child/.."));
  await Promise.resolve();
  expect(archivedWorkspaceIds).toEqual(["workspace-a"]);

  releaseFirstArchive?.();
  await finished;
  expect(archivedWorkspaceIds).toEqual(["workspace-a", "workspace-b"]);
});

test("does not fan out a stale merged event when the fresh observation has no PR", async () => {
  let onSnapshotUpdated: ((snapshot: WorkspaceGitRuntimeSnapshot) => void) | null = null;
  const eventSnapshot = createSnapshot("/repo/worktree");
  const freshSnapshot = createSnapshot("/repo/worktree");
  freshSnapshot.forge.pullRequest = null;
  const archiveIfSafe = vi.fn();
  const getSnapshot = vi.fn(async () => freshSnapshot);
  const options = {
    workspaceRegistry,
    logger: { child: () => ({ warn: vi.fn() }) } as unknown as Logger,
    daemonConfigStore: { get: () => ({ autoArchiveAfterMerge: true }) },
    workspaceGitService: {
      onSnapshotUpdated: (listener: (next: WorkspaceGitRuntimeSnapshot) => void) => {
        onSnapshotUpdated = listener;
        return { unsubscribe: vi.fn() };
      },
      getSnapshot,
    },
    listActiveWorkspaces: vi.fn(async () => [
      { workspaceId: "workspace-a", cwd: "/repo/worktree" },
    ]),
  } as unknown as AutoArchiveOnMergeOptions;

  setupAutoArchiveOnMerge(options, { archiveIfSafe, resolvePath: resolve });
  if (!onSnapshotUpdated) throw new Error("Snapshot listener was not registered");
  onSnapshotUpdated(createSnapshot("/repo/worktree", "open"));
  onSnapshotUpdated(eventSnapshot);
  await vi.waitFor(() => expect(getSnapshot).toHaveBeenCalledTimes(1));
  await Promise.resolve();
  expect(archiveIfSafe).not.toHaveBeenCalled();
  expect(options.listActiveWorkspaces).not.toHaveBeenCalled();
});

test("logs and skips when the fresh observation cannot be read", async () => {
  let onSnapshotUpdated: ((snapshot: WorkspaceGitRuntimeSnapshot) => void) | null = null;
  const warn = vi.fn();
  const archiveIfSafe = vi.fn();
  const options = {
    workspaceRegistry,
    logger: { child: () => ({ warn }) } as unknown as Logger,
    daemonConfigStore: { get: () => ({ autoArchiveAfterMerge: true }) },
    workspaceGitService: {
      onSnapshotUpdated: (listener: (next: WorkspaceGitRuntimeSnapshot) => void) => {
        onSnapshotUpdated = listener;
        return { unsubscribe: vi.fn() };
      },
      getSnapshot: async () => {
        throw new Error("snapshot failed");
      },
    },
    listActiveWorkspaces: vi.fn(),
  } as unknown as AutoArchiveOnMergeOptions;

  setupAutoArchiveOnMerge(options, { archiveIfSafe, resolvePath: resolve });
  if (!onSnapshotUpdated) throw new Error("Snapshot listener was not registered");
  onSnapshotUpdated(createSnapshot("/repo/worktree", "open"));
  onSnapshotUpdated(createSnapshot("/repo/worktree"));
  await vi.waitFor(() =>
    expect(warn).toHaveBeenCalledWith(
      { err: expect.any(Error), cwd: "/repo/worktree" },
      "Failed to read snapshot for auto-archive; skipping",
    ),
  );
  expect(archiveIfSafe).not.toHaveBeenCalled();
  expect(options.listActiveWorkspaces).not.toHaveBeenCalled();
});

test("does not read an observation when auto-archive is disabled", async () => {
  let onSnapshotUpdated: ((snapshot: WorkspaceGitRuntimeSnapshot) => void) | null = null;
  const getSnapshot = vi.fn();
  const archiveIfSafe = vi.fn();
  const options = {
    workspaceRegistry,
    logger: { child: () => ({ warn: vi.fn() }) } as unknown as Logger,
    daemonConfigStore: { get: () => ({ autoArchiveAfterMerge: false }) },
    workspaceGitService: {
      onSnapshotUpdated: (listener: (next: WorkspaceGitRuntimeSnapshot) => void) => {
        onSnapshotUpdated = listener;
        return { unsubscribe: vi.fn() };
      },
      getSnapshot,
    },
    listActiveWorkspaces: vi.fn(),
  } as unknown as AutoArchiveOnMergeOptions;

  setupAutoArchiveOnMerge(options, { archiveIfSafe, resolvePath: resolve });
  if (!onSnapshotUpdated) throw new Error("Snapshot listener was not registered");
  onSnapshotUpdated(createSnapshot("/repo/worktree"));
  expect(getSnapshot).not.toHaveBeenCalled();
  expect(archiveIfSafe).not.toHaveBeenCalled();
});

function createDeferred<T>() {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolvePromise = done;
  });
  return { promise, resolve: resolvePromise };
}

function createRestoreHarness() {
  let listener: (snapshot: WorkspaceGitRuntimeSnapshot) => void = () => {};
  const baseline = createDeferred<WorkspaceGitRuntimeSnapshot>();
  const getSnapshot = vi.fn<AutoArchiveOnMergeOptions["workspaceGitService"]["getSnapshot"]>(
    async (cwd, options) => (options?.force ? baseline.promise : createSnapshot(cwd)),
  );
  const archive = vi.fn(
    async ({
      workspaceId,
      snapshot,
    }: Parameters<AutoArchiveOnMergeDependencies["archiveIfSafe"]>[0]) => {
      const current = await workspaceRegistry.get(workspaceId);
      if (current?.autoArchivedChangeRequestUrl !== snapshot.forge.pullRequest?.url) {
        await workspaceRegistry.archive(workspaceId, new Date().toISOString());
      }
    },
  );
  const options = {
    workspaceRegistry,
    logger,
    daemonConfigStore: { get: () => ({ autoArchiveAfterMerge: true }) },
    workspaceGitService: {
      getSnapshot,
      onSnapshotUpdated: (next: typeof listener) => {
        listener = next;
        return { unsubscribe: () => {} };
      },
    },
    listActiveWorkspaces: async () =>
      (await workspaceRegistry.list()).filter((workspace) => !workspace.archivedAt),
  } as unknown as AutoArchiveOnMergeOptions;
  const subscription = setupAutoArchiveOnMerge(options, {
    archiveIfSafe: archive,
    resolvePath: resolve,
  });
  return {
    baseline,
    getSnapshot,
    archive,
    subscription,
    emit: (snapshot: WorkspaceGitRuntimeSnapshot) => listener(snapshot),
  };
}

async function restoreWorkspace(workspaceId = "workspace-a") {
  const workspace = await workspaceRegistry.get(workspaceId);
  if (!workspace) throw new Error("Missing test workspace");
  await workspaceRegistry.upsert({ ...workspace, archivedAt: null }, { restored: true });
}

test("restores immediately, ignores cached open snapshots, and persists the fresh merged PR", async () => {
  const harness = createRestoreHarness();
  await workspaceRegistry.archive("workspace-a", "2026-03-01T00:00:00Z");
  await restoreWorkspace();
  expect(harness.getSnapshot).toHaveBeenCalledWith("/repo/worktree", {
    force: true,
    includeForge: true,
    queueIfBusy: true,
    reason: "workspace-restore-auto-archive-latch",
  });
  harness.emit(createSnapshot("/repo/worktree", "open"));
  harness.emit(createSnapshot("/repo/worktree"));
  await vi.waitFor(() => expect(harness.archive).toHaveBeenCalledTimes(1));
  expect((await workspaceRegistry.get("workspace-a"))?.archivedAt).toBeNull();

  harness.baseline.resolve(createSnapshot("/repo/worktree"));
  await vi.waitFor(async () =>
    expect((await workspaceRegistry.get("workspace-a"))?.autoArchivedChangeRequestUrl).toBe(
      "https://github.com/acme/repo/pull/12",
    ),
  );
  harness.emit(createSnapshot("/repo/worktree"));
  await vi.waitFor(() => expect(harness.archive).toHaveBeenCalledTimes(2));
  expect((await workspaceRegistry.get("workspace-a"))?.archivedAt).toBeNull();
  harness.subscription.unsubscribe();
});

test("a restore leaves a same-cwd sibling eligible when the next observation is merged", async () => {
  const harness = createRestoreHarness();
  harness.emit(createSnapshot("/repo/worktree", "open"));
  await workspaceRegistry.archive("workspace-a", "2026-03-01T00:00:00Z");
  await restoreWorkspace();
  harness.emit(createSnapshot("/repo/worktree"));
  await vi.waitFor(async () =>
    expect((await workspaceRegistry.get("workspace-b"))?.archivedAt).not.toBeNull(),
  );
  expect((await workspaceRegistry.get("workspace-a"))?.archivedAt).toBeNull();
  harness.subscription.unsubscribe();
  harness.baseline.resolve(createSnapshot("/repo/worktree"));
});

test("a fresh open baseline allows the restored workspace to archive on a later merge", async () => {
  const harness = createRestoreHarness();
  await restoreWorkspace();
  harness.baseline.resolve(createSnapshot("/repo/worktree", "open"));
  await harness.baseline.promise;
  await new Promise<void>((resolveDone) => setImmediate(resolveDone));
  harness.emit(createSnapshot("/repo/worktree", "open"));
  harness.emit(createSnapshot("/repo/worktree"));
  await vi.waitFor(async () =>
    expect((await workspaceRegistry.get("workspace-a"))?.archivedAt).not.toBeNull(),
  );
  harness.subscription.unsubscribe();
});

test("CLI unarchive waits for an in-flight automatic archive before restoring the record", async () => {
  const harness = createRestoreHarness();
  const archiveStarted = createDeferred<void>();
  const finishArchive = createDeferred<void>();
  harness.archive.mockImplementation(async ({ workspaceId }) => {
    if (workspaceId !== "workspace-a") return;
    archiveStarted.resolve();
    await finishArchive.promise;
    await workspaceRegistry.archive(workspaceId, "2026-03-01T00:00:00Z");
  });
  const projectRegistry = new FileBackedProjectRegistry(join(directory, "projects.json"), logger);
  await projectRegistry.upsert(
    createPersistedProjectRecord({
      projectId: "project",
      rootPath: "/repo/worktree",
      kind: "non_git",
      displayName: "repo",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }),
  );
  const provisioning = createWorkspaceProvisioningService({
    workspaceRegistry,
    projectRegistry,
    workspaceGitService: createNoopWorkspaceGitService(),
    logger,
  });
  harness.emit(createSnapshot("/repo/worktree", "open"));
  harness.emit(createSnapshot("/repo/worktree"));
  await archiveStarted.promise;
  await workspaceRegistry.archive("workspace-a", "2026-03-01T00:00:00Z");
  const archived = await workspaceRegistry.get("workspace-a");
  if (!archived) throw new Error("Missing test workspace");
  let restored = false;
  const restore = provisioning.ensureWorkspaceRecordUnarchived(archived).then((record) => {
    restored = true;
    return record;
  });
  await Promise.resolve();
  expect(restored).toBe(false);
  finishArchive.resolve();
  await restore;
  expect((await workspaceRegistry.get("workspace-a"))?.archivedAt).toBeNull();
  harness.subscription.unsubscribe();
  harness.baseline.resolve(createSnapshot("/repo/worktree"));
});

test("keeps a restored workspace protected after a failed baseline and retries a fresh read", async () => {
  const harness = createRestoreHarness();
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  harness.getSnapshot.mockRejectedValueOnce(new Error("Forge unavailable"));
  await restoreWorkspace();
  await new Promise<void>((resolveDone) => setImmediate(resolveDone));
  harness.emit(createSnapshot("/repo/worktree", "open"));
  harness.emit(createSnapshot("/repo/worktree"));
  await vi.waitFor(async () =>
    expect((await workspaceRegistry.get("workspace-b"))?.archivedAt).not.toBeNull(),
  );
  expect((await workspaceRegistry.get("workspace-a"))?.archivedAt).toBeNull();

  now += 30_001;
  harness.emit(createSnapshot("/repo/worktree"));
  expect(harness.getSnapshot.mock.calls.filter(([, options]) => options?.force)).toHaveLength(2);
  harness.baseline.resolve(createSnapshot("/repo/worktree"));
  await vi.waitFor(async () =>
    expect((await workspaceRegistry.get("workspace-a"))?.autoArchivedChangeRequestUrl).toBe(
      "https://github.com/acme/repo/pull/12",
    ),
  );
  expect((await workspaceRegistry.get("workspace-a"))?.archivedAt).toBeNull();
  harness.subscription.unsubscribe();
});
