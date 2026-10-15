import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * What the global launcher starts on each host: which profile configures the
 * call and which thread it continues.
 *
 * Keyed by server id because profiles and threads live on the daemon that owns
 * them. A missing profile entry means "the daemon's default"; a missing thread
 * entry means "open a new thread". Only ids are stored; `reconcile` drops an id
 * the host no longer lists, and a thread that belongs to another profile.
 */
export interface VoiceSelection {
  profileId: string | null;
  threadId: string | null;
}

interface VoiceSelectionState {
  profileByServerId: Record<string, string>;
  threadByServerId: Record<string, string>;
  selectProfile: (serverId: string, profileId: string | null) => void;
  selectThread: (serverId: string, threadId: string | null) => void;
  reconcile: (
    serverId: string,
    existing: { profileIds?: readonly string[]; threads?: readonly VoiceThreadRef[] },
  ) => void;
}

export interface VoiceThreadRef {
  id: string;
  profileId: string | null;
}

function without(record: Record<string, string>, key: string): Record<string, string> {
  const next = { ...record };
  delete next[key];
  return next;
}

export const useVoiceSelectionStore = create<VoiceSelectionState>()(
  persist(
    (set) => ({
      profileByServerId: {},
      threadByServerId: {},
      selectProfile: (serverId, profileId) =>
        set((state) => {
          if ((state.profileByServerId[serverId] ?? null) === profileId) return state;
          return {
            profileByServerId: profileId
              ? { ...state.profileByServerId, [serverId]: profileId }
              : without(state.profileByServerId, serverId),
            // A thread belongs to a profile; changing profile means a fresh thread.
            threadByServerId: without(state.threadByServerId, serverId),
          };
        }),
      selectThread: (serverId, threadId) =>
        set((state) => {
          if ((state.threadByServerId[serverId] ?? null) === threadId) return state;
          return {
            threadByServerId: threadId
              ? { ...state.threadByServerId, [serverId]: threadId }
              : without(state.threadByServerId, serverId),
          };
        }),
      reconcile: (serverId, existing) =>
        set((state) => {
          let profileByServerId = state.profileByServerId;
          let threadByServerId = state.threadByServerId;
          const profileId = profileByServerId[serverId];
          if (profileId && existing.profileIds && !existing.profileIds.includes(profileId)) {
            profileByServerId = without(profileByServerId, serverId);
          }
          const threadId = threadByServerId[serverId];
          if (threadId && existing.threads) {
            const thread = existing.threads.find((candidate) => candidate.id === threadId);
            const selectedProfile = profileByServerId[serverId] ?? null;
            if (!thread || (thread.profileId !== null && thread.profileId !== selectedProfile)) {
              threadByServerId = without(threadByServerId, serverId);
            }
          }
          if (
            profileByServerId === state.profileByServerId &&
            threadByServerId === state.threadByServerId
          ) {
            return state;
          }
          return { profileByServerId, threadByServerId };
        }),
    }),
    {
      name: "paseo-voice-selection",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        profileByServerId: state.profileByServerId,
        threadByServerId: state.threadByServerId,
      }),
    },
  ),
);

/** Read outside React: the Live Voice runtime starts calls from event handlers. */
export function getVoiceSelection(serverId: string): VoiceSelection {
  const state = useVoiceSelectionStore.getState();
  return {
    profileId: state.profileByServerId[serverId] ?? null,
    threadId: state.threadByServerId[serverId] ?? null,
  };
}

export function useVoiceSelection(serverId: string | null): VoiceSelection {
  const profileId = useVoiceSelectionStore((state) =>
    serverId ? (state.profileByServerId[serverId] ?? null) : null,
  );
  const threadId = useVoiceSelectionStore((state) =>
    serverId ? (state.threadByServerId[serverId] ?? null) : null,
  );
  return { profileId, threadId };
}
