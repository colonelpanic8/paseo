import type { WearDispatchResult, WearDispatchState } from "./wear-protocol";

export interface WearDispatchTarget {
  serverId: string;
  agentId: string;
  /** Short display label resolved from current phone state. */
  label?: string;
}

export function buildWearDispatchState(
  target: WearDispatchTarget | null,
  result?: WearDispatchResult,
): WearDispatchState {
  if (!target) {
    return {
      configured: false,
      ...(result ? { result } : {}),
    };
  }
  return {
    configured: true,
    ...(target.label ? { label: target.label } : {}),
    ...(result ? { result } : {}),
  };
}
