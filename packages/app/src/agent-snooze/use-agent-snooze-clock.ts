import { useEffect, useState } from "react";
import type { Agent } from "@/stores/session-store";
import { getNextAgentSnoozeWakeAt } from "@/agent-snooze/model";

const MAX_TIMEOUT_MS = 2_147_483_647;

export function useAgentSnoozeClock(agentMaps: Iterable<Map<string, Agent> | undefined>): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const nextWakeAt = getNextAgentSnoozeWakeAt(agentMaps, nowMs);

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
