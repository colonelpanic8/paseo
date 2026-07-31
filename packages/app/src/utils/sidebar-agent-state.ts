import {
  deriveAgentStateBucket,
  type AgentAttentionReason,
  type AgentStateBucketInput,
} from "@getpaseo/protocol/agent-state-bucket";

export type SidebarAgentStateBucket = "needs_input" | "failed" | "running" | "attention" | "done";
// "snoozed" is client-side only: agents never derive it (deriveSidebarStateBucket
// below returns the agent-level buckets), but workspace sidebar entries can carry it.
export type SidebarStateBucket = SidebarAgentStateBucket | "snoozed";
export type SidebarAttentionReason = AgentAttentionReason;

export function deriveSidebarStateBucket(input: AgentStateBucketInput): SidebarAgentStateBucket {
  return deriveAgentStateBucket(input);
}

export function isSidebarActiveAgent(input: AgentStateBucketInput): boolean {
  return deriveSidebarStateBucket(input) !== "done";
}
