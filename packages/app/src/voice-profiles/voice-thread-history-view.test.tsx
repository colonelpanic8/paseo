/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceThread } from "@getpaseo/protocol/voice-profiles";
import { VoiceThreadHistoryView } from "./voice-thread-history-view";

const state = vi.hoisted(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  return { thread: null as VoiceThread | null, loadOlder: vi.fn() };
});
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./voice-profile-queries", () => ({
  useVoiceThreadHistory: () => ({
    thread: state.thread,
    entries: [],
    hasMore: true,
    isLoading: false,
    isLoadingOlder: false,
    error: null,
    loadOlder: state.loadOlder,
  }),
}));

vi.stubGlobal("React", React);
afterEach(cleanup);

const original: VoiceThread = {
  id: `thr_${"a".repeat(32)}`,
  profileId: "cfg_work",
  title: "Release planning",
  revision: 1,
  createdAt: "now",
  updatedAt: "now",
  summary: "",
  summaryThroughSeq: 0,
  lastSeq: 10,
};
beforeEach(() => {
  state.thread = original;
  state.loadOlder.mockReset();
});

describe("voice thread history editing", () => {
  it("keeps the summary's original checkpoint while new history and a conflicting revision arrive", async () => {
    state.thread = original;
    const onCompact = vi.fn().mockRejectedValue(new Error("Reload before saving"));
    const screen = render(
      <VoiceThreadHistoryView
        serverId="host"
        threadId={original.id}
        disabled={false}
        onCompact={onCompact}
      />,
    );
    fireEvent.change(screen.getByLabelText("voiceProfiles.history.summary.label"), {
      target: { value: "Iris releases Monday" },
    });
    state.thread = { ...original, revision: 2, lastSeq: 20 };
    screen.rerender(
      <VoiceThreadHistoryView
        serverId="host"
        threadId={original.id}
        disabled={false}
        onCompact={onCompact}
      />,
    );
    fireEvent.click(screen.getByText("voiceProfiles.history.summary.save"));
    await waitFor(() =>
      expect(onCompact).toHaveBeenCalledWith({
        thread: original,
        summary: "Iris releases Monday",
        throughSeq: 10,
      }),
    );
    expect(await screen.findByText("Reload before saving")).toBeTruthy();
    expect(
      (screen.getByLabelText("voiceProfiles.history.summary.label") as HTMLTextAreaElement).value,
    ).toBe("Iris releases Monday");
  });

  it("shows a failed older-history request in the current view", async () => {
    state.loadOlder.mockRejectedValue(new Error("Host disconnected"));
    const screen = render(
      <VoiceThreadHistoryView
        serverId="host"
        threadId={state.thread!.id}
        disabled={false}
        onCompact={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("voiceProfiles.history.loadOlder"));
    expect(await screen.findByText("Host disconnected")).toBeTruthy();
  });
});
