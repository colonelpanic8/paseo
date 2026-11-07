import { beforeEach, describe, expect, it, vi } from "vitest";
import { getVoiceSelection, useVoiceSelectionStore } from "./voice-selection-store";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

const PROFILE_A = "cfg_life";
const PROFILE_B = "prf_" + "b".repeat(32);
const THREAD_A = "thr_" + "1".repeat(32);
const THREAD_B = "thr_" + "2".repeat(32);

describe("voice selection store", () => {
  beforeEach(() => {
    useVoiceSelectionStore.setState({ profileByServerId: {}, threadByServerId: {} });
  });

  it("keeps one profile and thread per host, and a profile change resets the thread", () => {
    const { selectProfile, selectThread } = useVoiceSelectionStore.getState();
    selectProfile("host-a", PROFILE_A);
    selectThread("host-a", THREAD_A);
    selectProfile("host-b", PROFILE_B);
    expect(getVoiceSelection("host-a")).toEqual({ profileId: PROFILE_A, threadId: THREAD_A });
    expect(getVoiceSelection("host-b")).toEqual({ profileId: PROFILE_B, threadId: null });
    selectProfile("host-a", PROFILE_B);
    expect(getVoiceSelection("host-a")).toEqual({ profileId: PROFILE_B, threadId: null });
    selectProfile("host-a", null);
    expect(getVoiceSelection("host-a")).toEqual({ profileId: null, threadId: null });
  });

  it("drops a selection the host no longer lists or that belongs to another profile", () => {
    const { selectProfile, selectThread, reconcile } = useVoiceSelectionStore.getState();
    selectProfile("host-a", PROFILE_A);
    selectThread("host-a", THREAD_A);
    reconcile("host-a", { profileIds: [PROFILE_B] });
    expect(getVoiceSelection("host-a").profileId).toBeNull();
    // The thread survives the profile-list reconcile; the thread list judges it.
    expect(getVoiceSelection("host-a").threadId).toBe(THREAD_A);
    reconcile("host-a", { threads: [{ id: THREAD_A, profileId: PROFILE_B }] });
    expect(getVoiceSelection("host-a").threadId).toBeNull();

    selectProfile("host-a", PROFILE_B);
    selectThread("host-a", THREAD_B);
    reconcile("host-a", { threads: [{ id: THREAD_A, profileId: PROFILE_B }] });
    expect(getVoiceSelection("host-a").threadId).toBeNull();
    // Another host's list says nothing about this host's selection.
    selectThread("host-b", THREAD_B);
    reconcile("host-a", { threads: [] });
    expect(getVoiceSelection("host-b").threadId).toBe(THREAD_B);
  });

  it("does not publish a new state when nothing changed", () => {
    const { selectProfile, selectThread, reconcile } = useVoiceSelectionStore.getState();
    selectProfile("host-a", PROFILE_A);
    selectThread("host-a", THREAD_A);
    const before = useVoiceSelectionStore.getState();
    reconcile("host-a", {
      profileIds: [PROFILE_A],
      threads: [{ id: THREAD_A, profileId: PROFILE_A }],
    });
    selectThread("host-a", THREAD_A);
    expect(useVoiceSelectionStore.getState()).toBe(before);
  });
});
