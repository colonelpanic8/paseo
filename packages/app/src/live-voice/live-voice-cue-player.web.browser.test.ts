import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { createLiveVoiceCuePlayer } from "./live-voice-cue-player.web";

const cleanup: Array<() => void> = [];

afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
});

function createHarness() {
  const context = new AudioContext();
  const sources: AudioBufferSourceNode[] = [];
  let contextRequests = 0;
  const player = createLiveVoiceCuePlayer(() => {
    contextRequests += 1;
    return {
      get state() {
        return context.state;
      },
      destination: context.destination,
      resume: () => context.resume(),
      close: () => context.close(),
      createBuffer: (channels, length, rate) => context.createBuffer(channels, length, rate),
      createBufferSource() {
        const source = context.createBufferSource();
        sources.push(source);
        return source;
      },
    };
  });
  cleanup.push(() => {
    player.dispose();
    if (context.state !== "closed") void context.close();
  });
  const button = document.createElement("button");
  button.textContent = "Prepare call audio";
  button.addEventListener("click", () => player.prepare());
  document.body.append(button);
  cleanup.push(() => button.remove());
  return { context, player, sources, contextRequests: () => contextRequests };
}

describe("Live Voice browser call cues", () => {
  it("unlocks audio during the start gesture and plays the short cue when requested", async () => {
    const { context, player, sources, contextRequests } = createHarness();
    await context.suspend();
    expect(contextRequests()).toBe(0);

    await page.getByRole("button", { name: "Prepare call audio" }).click();
    await expect.poll(() => context.state).toBe("running");
    expect(contextRequests()).toBe(1);
    expect(sources).toHaveLength(0);

    player.play("connected");
    expect(sources).toHaveLength(1);
    expect(sources[0].buffer?.duration).toBe(0.25);
    await new Promise<void>((resolve) => sources[0].addEventListener("ended", () => resolve()));
  });

  it("drops a suspended cue instead of replaying it after a later gesture", async () => {
    const { context, player, sources } = createHarness();
    await context.suspend();
    player.play("connected");
    expect(sources).toHaveLength(0);

    await page.getByRole("button", { name: "Prepare call audio" }).click();
    await expect.poll(() => context.state).toBe("running");
    expect(sources).toHaveLength(0);
    player.play("connected");
    expect(sources).toHaveLength(1);
  });

  it("releases audio and never recreates it after disposal", async () => {
    const { context, player, sources, contextRequests } = createHarness();
    await page.getByRole("button", { name: "Prepare call audio" }).click();
    await expect.poll(() => context.state).toBe("running");
    player.dispose();
    await expect.poll(() => context.state).toBe("closed");
    player.prepare();
    player.play("connected");
    expect(contextRequests()).toBe(1);
    expect(sources).toHaveLength(0);
  });

  it("keeps call startup safe when browser audio is unavailable", () => {
    const unavailable = createLiveVoiceCuePlayer(() => null);
    const failed = createLiveVoiceCuePlayer(() => {
      throw new Error("Audio device unavailable");
    });
    for (const player of [unavailable, failed]) {
      expect(() => player.prepare()).not.toThrow();
      expect(() => player.play("connected")).not.toThrow();
      player.dispose();
    }
  });
});
