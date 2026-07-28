import { useEffect, useState } from "react";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { getNextWorkspaceSnoozeWakeAt } from "@/workspace-snooze/model";

const MAX_TIMEOUT_MS = 2_147_483_647;

// Ticks exactly when the next visible workspace snooze expires, so consumers
// re-derive and the workspace pops out of the Snoozed group without any store
// update. Returns a stable nowMs between wakes.
export function useWorkspaceSnoozeClock(
  workspaceMaps: Iterable<ReadonlyMap<string, WorkspaceDescriptor> | undefined>,
): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const nextWakeAt = getNextWorkspaceSnoozeWakeAt(workspaceMaps, nowMs);

  useEffect(() => {
    if (nextWakeAt === null) {
      return;
    }
    const delay = Math.min(Math.max(nextWakeAt - Date.now() + 50, 50), MAX_TIMEOUT_MS);
    const timeout = setTimeout(() => setNowMs(Date.now()), delay);
    return () => clearTimeout(timeout);
  }, [nextWakeAt]);

  return nowMs;
}
