import { resolve } from "node:path";
import { LRUCache } from "lru-cache";
import type { Logger } from "pino";

import { archiveIfSafe, type AutoArchiveArchiveOptions } from "./archive-if-safe.js";
import type {
  WorkspaceGitRuntimeSnapshot,
  WorkspaceGitSubscription,
} from "../workspace-git-service.js";
import type { PersistedWorkspaceRecord, WorkspaceRegistry } from "../workspace-registry.js";
import { withWorkspaceLifecycle } from "../workspace-lifecycle.js";

export interface AutoArchiveOnMergeOptions extends AutoArchiveArchiveOptions {
  logger: Logger;
  workspaceRegistry: Pick<WorkspaceRegistry, "get" | "update" | "subscribeToMutations">;
}

export interface AutoArchiveOnMergeDependencies {
  archiveIfSafe: typeof archiveIfSafe;
  resolvePath: typeof resolve;
}

const OPEN_PULL_REQUEST_LATCH_MAX = 1_024;
const RESTORE_OBSERVATION_RETRY_MS = 30_000;

interface RestoredWorkspaceObservation {
  workspace: PersistedWorkspaceRecord;
  status: "pending" | "refreshing";
  retryAt: number;
}

const defaultDependencies: AutoArchiveOnMergeDependencies = {
  archiveIfSafe,
  resolvePath: resolve,
};

export function setupAutoArchiveOnMerge(
  options: AutoArchiveOnMergeOptions,
  deps: AutoArchiveOnMergeDependencies = defaultDependencies,
): WorkspaceGitSubscription {
  const log = options.logger.child({ module: "auto-archive-on-merge" });
  const inFlightCwds = new Set<string>();
  const openPullRequestUrlsByCwd = new LRUCache<string, string>({
    max: OPEN_PULL_REQUEST_LATCH_MAX,
  });

  const pendingRestores = new Map<string, RestoredWorkspaceObservation>();
  let disposed = false;

  async function observeRestoredWorkspace(
    observation: RestoredWorkspaceObservation,
  ): Promise<void> {
    observation.status = "refreshing";
    const { workspace } = observation;
    try {
      const snapshot = await options.workspaceGitService.getSnapshot(workspace.cwd, {
        force: true,
        includeForge: true,
        queueIfBusy: true,
        reason: "workspace-restore-auto-archive-latch",
      });
      if (disposed || pendingRestores.get(workspace.workspaceId) !== observation) return;
      if (snapshot.git.isGit && (!snapshot.forge.featuresEnabled || snapshot.forge.error)) {
        observation.status = "pending";
        observation.retryAt = Date.now() + RESTORE_OBSERVATION_RETRY_MS;
        return;
      }
      const pullRequest = snapshot.forge.pullRequest;
      if (pullRequest?.isMerged) {
        await options.workspaceRegistry.update(workspace.workspaceId, (current) => {
          if (pendingRestores.get(workspace.workspaceId) !== observation || current.archivedAt) {
            return current;
          }
          return { ...current, autoArchivedChangeRequestUrl: pullRequest.url };
        });
      }
      if (pendingRestores.get(workspace.workspaceId) === observation) {
        pendingRestores.delete(workspace.workspaceId);
      }
    } catch (error) {
      observation.status = "pending";
      observation.retryAt = Date.now() + RESTORE_OBSERVATION_RETRY_MS;
      log.warn(
        { err: error, workspaceId: workspace.workspaceId },
        "Failed to observe restored workspace PR",
      );
    }
  }

  // Cached open snapshots cannot acknowledge a restore. Protect only this
  // workspace until a fresh forge read records any already-merged PR.
  const unsubscribeMutations = options.workspaceRegistry.subscribeToMutations?.((mutation) => {
    if (mutation.kind === "remove") pendingRestores.delete(mutation.workspaceId);
    if (mutation.kind === "upsert" && mutation.restored && mutation.workspace) {
      const observation: RestoredWorkspaceObservation = {
        workspace: mutation.workspace,
        status: "pending",
        retryAt: 0,
      };
      pendingRestores.set(mutation.workspaceId, observation);
      void observeRestoredWorkspace(observation);
    }
  });

  const snapshotSubscription = options.workspaceGitService.onSnapshotUpdated((snapshot) => {
    const snapshotCwd = deps.resolvePath(snapshot.cwd);
    for (const observation of pendingRestores.values()) {
      const shouldRetry = observation.status === "pending" && observation.retryAt <= Date.now();
      if (shouldRetry && deps.resolvePath(observation.workspace.cwd) === snapshotCwd) {
        void observeRestoredWorkspace(observation);
      }
    }
    if (options.daemonConfigStore.get().autoArchiveAfterMerge !== true) {
      openPullRequestUrlsByCwd.delete(snapshotCwd);
      return;
    }

    const pullRequest = snapshot.forge.pullRequest;
    if (!pullRequest?.isMerged) {
      if (pullRequest?.state.toLowerCase() === "open") {
        openPullRequestUrlsByCwd.set(snapshotCwd, pullRequest.url);
      } else {
        openPullRequestUrlsByCwd.delete(snapshotCwd);
      }
      return;
    }
    if (openPullRequestUrlsByCwd.get(snapshotCwd) !== pullRequest.url) {
      openPullRequestUrlsByCwd.delete(snapshotCwd);
      return;
    }
    if (inFlightCwds.has(snapshotCwd)) {
      return;
    }
    inFlightCwds.add(snapshotCwd);

    void (async () => {
      let freshSnapshot: WorkspaceGitRuntimeSnapshot | null;
      try {
        freshSnapshot = await options.workspaceGitService.getSnapshot(snapshot.cwd, {
          reason: "auto-archive-on-merge",
        });
      } catch (error) {
        log.warn(
          { err: error, cwd: snapshot.cwd },
          "Failed to read snapshot for auto-archive; skipping",
        );
        return;
      }
      const freshPullRequest = freshSnapshot?.forge.pullRequest;
      if (
        !freshPullRequest?.isMerged ||
        freshPullRequest.url !== pullRequest.url ||
        openPullRequestUrlsByCwd.get(snapshotCwd) !== pullRequest.url
      ) {
        if (openPullRequestUrlsByCwd.get(snapshotCwd) === pullRequest.url) {
          openPullRequestUrlsByCwd.delete(snapshotCwd);
        }
        return;
      }

      const attachedWorkspaces = (await options.listActiveWorkspaces()).filter(
        (workspace) => deps.resolvePath(workspace.cwd) === snapshotCwd,
      );
      for (const workspace of attachedWorkspaces) {
        await withWorkspaceLifecycle(
          { registry: options.workspaceRegistry, workspace },
          async () => {
            if (disposed || pendingRestores.has(workspace.workspaceId)) return;
            if (openPullRequestUrlsByCwd.get(snapshotCwd) !== pullRequest.url) return;
            if (options.daemonConfigStore.get().autoArchiveAfterMerge !== true) return;
            const current = await options.workspaceRegistry.get(workspace.workspaceId);
            if (!current || current.archivedAt || deps.resolvePath(current.cwd) !== snapshotCwd)
              return;
            await deps.archiveIfSafe({
              workspaceId: workspace.workspaceId,
              snapshot: freshSnapshot,
              options,
              log,
            });
          },
        );
      }
    })()
      .catch((error) => {
        log.warn({ err: error, cwd: snapshot.cwd }, "Failed to auto-archive attached workspaces");
      })
      .finally(() => {
        inFlightCwds.delete(snapshotCwd);
      });
  });

  return {
    unsubscribe: () => {
      disposed = true;
      pendingRestores.clear();
      snapshotSubscription.unsubscribe();
      unsubscribeMutations?.();
    },
  };
}
