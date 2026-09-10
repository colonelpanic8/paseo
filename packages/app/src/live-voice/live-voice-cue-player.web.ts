/**
 * Web/Electron Live Voice cue playback.
 *
 * Web Audio rather than an `<audio>` element: the samples are synthesized in
 * `live-voice-cue-tones`, so there is nothing to fetch, and a `AudioBufferSource`
 * mixes with the WebRTC `<audio>` element carrying the assistant's speech
 * instead of competing with it for the element's playback state.
 *
 * Prepare the context during the start gesture, before async call negotiation
 * can consume browser user activation. Blocked cues are dropped, never queued.
 */

import {
  LIVE_VOICE_CUE_SAMPLE_RATE,
  renderLiveVoiceCue,
  type LiveVoiceCue,
} from "@/live-voice/live-voice-cue-tones";
import type { LiveVoiceCuePlayer } from "@/live-voice/live-voice-cue-player";

export type { LiveVoiceCue } from "@/live-voice/live-voice-cue-tones";
export type { LiveVoiceCuePlayer } from "@/live-voice/live-voice-cue-player";

type CueAudioContext = Pick<
  AudioContext,
  "state" | "resume" | "close" | "destination" | "createBuffer" | "createBufferSource"
>;

function createCueAudioContext(): CueAudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  const browserWindow = window as typeof window & {
    webkitAudioContext?: typeof AudioContext;
  };
  const Context = browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
  return Context ? new Context({ sampleRate: LIVE_VOICE_CUE_SAMPLE_RATE }) : null;
}

export function createLiveVoiceCuePlayer(
  createContext: () => CueAudioContext | null = createCueAudioContext,
): LiveVoiceCuePlayer {
  const buffers = new Map<LiveVoiceCue, AudioBuffer>();
  let context: CueAudioContext | null = null;
  let disposed = false;

  function getContext(): CueAudioContext | null {
    if (disposed) {
      return null;
    }
    if (!context) {
      context = createContext();
    }
    return context;
  }

  function getBuffer(target: CueAudioContext, cue: LiveVoiceCue): AudioBuffer {
    const cached = buffers.get(cue);
    if (cached) {
      return cached;
    }
    const samples = renderLiveVoiceCue(cue);
    const buffer = target.createBuffer(1, samples.length, LIVE_VOICE_CUE_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    buffers.set(cue, buffer);
    return buffer;
  }

  return {
    prepare() {
      try {
        const target = getContext();
        if (target?.state === "suspended") {
          void target.resume().catch(() => undefined);
        }
      } catch {
        // Audio availability must not affect call startup.
      }
    },

    play(cue) {
      try {
        const target = getContext();
        if (!target || target.state !== "running") {
          return;
        }
        const source = target.createBufferSource();
        source.buffer = getBuffer(target, cue);
        source.connect(target.destination);
        source.addEventListener("ended", () => source.disconnect(), { once: true });
        source.start();
      } catch {
        // A cue is never worth failing a call over.
      }
    },

    dispose() {
      disposed = true;
      buffers.clear();
      const target = context;
      context = null;
      void target?.close().catch(() => undefined);
    },
  };
}
