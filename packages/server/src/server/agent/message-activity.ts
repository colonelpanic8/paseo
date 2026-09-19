import type { ManagedAgent } from "./agent-manager.js";
import type { StoredAgentRecord } from "./agent-storage.js";

type AgentMessageActivity = Pick<
  ManagedAgent | StoredAgentRecord,
  "id" | "lastMessageAt" | "lastUserMessageAt"
>;

export function collectAgentMessageActivity(
  agents: Iterable<AgentMessageActivity>,
): ReadonlyMap<string, string> {
  const activityByAgentId = new Map<string, string>();
  for (const agent of agents) {
    for (const timestamp of [agent.lastMessageAt, agent.lastUserMessageAt]) {
      if (!timestamp) continue;
      const iso = timestamp instanceof Date ? timestamp.toISOString() : timestamp;
      const previous = activityByAgentId.get(agent.id);
      if (!previous || Date.parse(iso) > Date.parse(previous)) {
        activityByAgentId.set(agent.id, iso);
      }
    }
  }
  return activityByAgentId;
}
