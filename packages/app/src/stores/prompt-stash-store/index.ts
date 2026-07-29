import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  collectStashAttachmentIds,
  PROMPT_STASH_STORE_VERSION,
  stashEntryInQueues,
  takeEntryFromQueues,
  type PromptStashEntry,
  type PromptStashQueues,
} from "./state";

export {
  buildPromptStashScopeKey,
  countOtherScopeEntries,
  MAX_STASH_ENTRIES_PER_QUEUE,
  mergeStashRestoreAttachments,
  mergeStashRestoreText,
  PROMPT_STASH_UNSCOPED_KEY,
  type PromptStashEntry,
} from "./state";

export const EMPTY_PROMPT_STASH_QUEUE: readonly PromptStashEntry[] = [];

interface PromptStashState {
  queuesByScopeKey: PromptStashQueues;
}

interface PromptStashActions {
  /**
   * Prepends an entry to its provider's queue, evicting the oldest entry past
   * the per-queue cap. Returns the evicted entry (for messaging) if any.
   */
  stashEntry: (entry: PromptStashEntry) => { evicted: PromptStashEntry | null };
  /** Removes and returns an entry (restore + delete); null when already gone. */
  takeEntry: (scopeKey: string, entryId: string) => PromptStashEntry | null;
}

type PromptStashStore = PromptStashState & PromptStashActions;

export const usePromptStashStore = create<PromptStashStore>()(
  persist(
    (set, get) => ({
      queuesByScopeKey: {},

      stashEntry: (entry) => {
        const result = stashEntryInQueues(get().queuesByScopeKey, entry);
        set({ queuesByScopeKey: result.queues });
        return { evicted: result.evicted };
      },

      takeEntry: (scopeKey, entryId) => {
        const result = takeEntryFromQueues(get().queuesByScopeKey, scopeKey, entryId);
        if (!result.entry) {
          return null;
        }
        set({ queuesByScopeKey: result.queues });
        return result.entry;
      },
    }),
    {
      name: "paseo-prompt-stash",
      version: PROMPT_STASH_STORE_VERSION,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ queuesByScopeKey }) => ({ queuesByScopeKey }),
    },
  ),
);

/**
 * Resolves once the persisted stash has rehydrated. Attachment GC must wait
 * for this before computing its referenced-id set, or a GC pass early in
 * startup would delete blobs that only the stash still references.
 */
export function awaitPromptStashHydration(): Promise<void> {
  if (usePromptStashStore.persist.hasHydrated()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const unsubscribe = usePromptStashStore.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}

/** Image attachment ids referenced by stashed prompts, for the attachment GC. */
export function collectPromptStashAttachmentIds(): string[] {
  return Array.from(collectStashAttachmentIds(usePromptStashStore.getState().queuesByScopeKey));
}
