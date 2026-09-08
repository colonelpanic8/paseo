import { describe, expect, it } from "vitest";
import { createDispatchSilenceTracker } from "@/dispatch/dispatch-silence";

const config = {
  silenceMs: 2_000,
  noSpeechTimeoutMs: 8_000,
  maxDurationMs: 90_000,
  speechVolume: 0.12,
};

describe("createDispatchSilenceTracker", () => {
  it("keeps listening while the transcript is still growing", () => {
    const tracker = createDispatchSilenceTracker(0, config);
    expect(tracker.observe({ now: 500, partialTranscript: "make", volume: 0 })).toBe("listen");
    expect(tracker.observe({ now: 2_400, partialTranscript: "make a", volume: 0 })).toBe("listen");
    expect(tracker.observe({ now: 4_300, partialTranscript: "make a", volume: 0 })).toBe("listen");
  });

  it("sends once transcript and microphone have both been quiet", () => {
    const tracker = createDispatchSilenceTracker(0, config);
    tracker.observe({ now: 500, partialTranscript: "ship it", volume: 0.5 });
    expect(tracker.observe({ now: 2_000, partialTranscript: "ship it", volume: 0.5 })).toBe(
      "listen",
    );
    // Loud room noise after the words keeps the window open.
    expect(tracker.observe({ now: 3_900, partialTranscript: "ship it", volume: 0 })).toBe("listen");
    expect(tracker.observe({ now: 4_000, partialTranscript: "ship it", volume: 0 })).toBe("send");
  });

  it("gives up when nothing is ever heard", () => {
    const tracker = createDispatchSilenceTracker(0, config);
    expect(tracker.observe({ now: 7_999, partialTranscript: "", volume: 0.3 })).toBe("listen");
    expect(tracker.observe({ now: 8_000, partialTranscript: "", volume: 0 })).toBe("give_up");
  });

  it("does not treat a hot microphone as speech before any words arrive", () => {
    const tracker = createDispatchSilenceTracker(0, config);
    for (let now = 0; now < 8_000; now += 500) {
      expect(tracker.observe({ now, partialTranscript: "", volume: 0.9 })).toBe("listen");
    }
    expect(tracker.observe({ now: 8_000, partialTranscript: "", volume: 0.9 })).toBe("give_up");
  });

  it("sends what it has at the hard limit", () => {
    const tracker = createDispatchSilenceTracker(0, config);
    for (let now = 0; now < 90_000; now += 1_000) {
      expect(tracker.observe({ now, partialTranscript: `word ${now}`, volume: 0.9 })).toBe(
        "listen",
      );
    }
    expect(tracker.observe({ now: 90_000, partialTranscript: "word 90000", volume: 0.9 })).toBe(
      "send",
    );
  });
});
