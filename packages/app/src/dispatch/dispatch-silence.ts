/**
 * Decides when a hands-free dispatch has heard enough.
 *
 * Two signals, because neither is trustworthy alone: the microphone level
 * (immediate, but earbud gain varies and room noise never fully stops) and the
 * host's partial transcript (authoritative about speech, but arrives in lumps).
 * Speech is "ongoing" while either moves; the prompt is done once both have
 * been still for `silenceMs` after something was heard.
 */
export interface DispatchSilenceConfig {
  /** Quiet after speech that ends the prompt. */
  silenceMs: number;
  /** Give up when nothing at all is heard for this long. */
  noSpeechTimeoutMs: number;
  /** Send whatever was heard by then; a shortcut must never record forever. */
  maxDurationMs: number;
  /** Normalized 0–1 microphone level counted as speech. */
  speechVolume: number;
}

export const DEFAULT_DISPATCH_SILENCE_CONFIG: DispatchSilenceConfig = {
  silenceMs: 2_000,
  noSpeechTimeoutMs: 8_000,
  maxDurationMs: 90_000,
  speechVolume: 0.12,
};

export type DispatchSilenceDecision = "listen" | "send" | "give_up";

export interface DispatchSilenceObservation {
  now: number;
  partialTranscript: string;
  volume: number;
}

export interface DispatchSilenceTracker {
  observe(observation: DispatchSilenceObservation): DispatchSilenceDecision;
}

export function createDispatchSilenceTracker(
  startedAt: number,
  config: DispatchSilenceConfig = DEFAULT_DISPATCH_SILENCE_CONFIG,
): DispatchSilenceTracker {
  let lastActivityAt = startedAt;
  let lastTranscript = "";
  let heardSpeech = false;

  return {
    observe({ now, partialTranscript, volume }) {
      const transcript = partialTranscript.trim();
      const transcriptMoved = transcript !== lastTranscript;
      lastTranscript = transcript;
      if (transcript) {
        heardSpeech = true;
      }
      if (transcriptMoved || volume >= config.speechVolume) {
        lastActivityAt = now;
      }

      if (now - startedAt >= config.maxDurationMs) {
        return heardSpeech ? "send" : "give_up";
      }
      if (!heardSpeech) {
        return now - startedAt >= config.noSpeechTimeoutMs ? "give_up" : "listen";
      }
      return now - lastActivityAt >= config.silenceMs ? "send" : "listen";
    },
  };
}
