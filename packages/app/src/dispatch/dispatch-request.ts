import { useSyncExternalStore } from "react";
import type { DispatchLink } from "@/dispatch/dispatch-link";

/**
 * Hand-off from the link listener to the dispatch surface. Every link opening
 * is a distinct request — `seq` advances even when the parameters repeat — so
 * the surface can tell a second press apart from a re-render and treat it as
 * "send what you have".
 */
export interface DispatchRequest {
  seq: number;
  link: DispatchLink;
}

let current: DispatchRequest | null = null;
let nextSeq = 1;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): DispatchRequest | null {
  return current;
}

export function requestDispatch(link: DispatchLink): void {
  current = { seq: nextSeq++, link };
  emit();
}

export function useDispatchRequest(): DispatchRequest | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Test seam. */
export function resetDispatchRequests(): void {
  current = null;
  nextSeq = 1;
  emit();
}
