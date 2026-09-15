import type { WorkspaceBucketHistoryEntry } from "./workspace-directory.js";

/**
 * Daemon-lifetime home for the per-workspace status history that anchors
 * `statusEnteredAt`. Each session builds its own `WorkspaceDirectory`, so the
 * history has to live above the session or every client reload restamps the
 * sidebar's "since when" timestamps at connection time.
 *
 * Histories are scoped because the winning bucket depends on which providers a
 * client can see: a legacy client that hides newer providers can disagree with
 * a current one about a workspace's bucket, and a single shared entry would
 * ping-pong between the two, restamping `enteredAt` on every recompute.
 */
export class WorkspaceStatusHistory {
  private readonly byScope = new Map<string, Map<string, WorkspaceBucketHistoryEntry>>();

  scoped(scopeKey: string): Map<string, WorkspaceBucketHistoryEntry> {
    let scope = this.byScope.get(scopeKey);
    if (!scope) {
      scope = new Map();
      this.byScope.set(scopeKey, scope);
    }
    return scope;
  }
}
