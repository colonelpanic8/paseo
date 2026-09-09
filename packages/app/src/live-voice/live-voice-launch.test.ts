import { describe, expect, it } from "vitest";
import { LiveVoiceStartError, type LiveVoiceStartOptions } from "./live-voice-runtime";
import { startLiveVoiceCall } from "./live-voice-launch";

interface Call {
  serverId: string;
  options: LiveVoiceStartOptions | undefined;
}

describe("startLiveVoiceCall", () => {
  it("opens the launcher when a shortcut call fails so its error and retry action are visible", async () => {
    let launcherRequests = 0;

    await startLiveVoiceCall({
      serverId: "host-a",
      start: async () => {
        throw new LiveVoiceStartError({ code: "background_unavailable", message: null });
      },
      showLauncher: () => {
        launcherRequests += 1;
      },
    });

    expect(launcherRequests).toBe(1);
  });

  it("starts the requested assistant without opening the launcher after success", async () => {
    const calls: Call[] = [];
    let launcherRequests = 0;

    await startLiveVoiceCall({
      serverId: "host-a",
      options: { assistantId: "assistant-a" },
      start: async (serverId, options) => {
        calls.push({ serverId, options });
      },
      showLauncher: () => {
        launcherRequests += 1;
      },
    });

    expect(calls).toEqual([{ serverId: "host-a", options: { assistantId: "assistant-a" } }]);
    expect(launcherRequests).toBe(0);
  });
});
