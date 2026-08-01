import { useSyncExternalStore } from "react";

/**
 * Re-renders the subscribing component whenever the wall-clock minute changes,
 * so relative timestamps ("5m ago") never freeze on screen. All subscribers
 * share one interval; it only runs while at least one component is mounted.
 *
 * The interval fires more often than once a minute so a tick lands close to
 * each minute boundary instead of drifting up to a full interval past it.
 */

const listeners = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let currentMinute = Math.floor(Date.now() / 60_000);

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (intervalId === null) {
    // The ticker was stopped, so the snapshot may be minutes old. Refresh it
    // before React reads it for the new subscriber.
    currentMinute = Math.floor(Date.now() / 60_000);
    intervalId = setInterval(() => {
      const minute = Math.floor(Date.now() / 60_000);
      if (minute === currentMinute) {
        return;
      }
      currentMinute = minute;
      for (const notify of listeners) {
        notify();
      }
    }, 20_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getSnapshot(): number {
  return currentMinute;
}

export function useMinuteTick(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
