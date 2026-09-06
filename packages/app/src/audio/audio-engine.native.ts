import type { AudioEngine, AudioEngineCallbacks, AudioPlaybackSource } from "./audio-engine-types";

import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { createPlaybackQueue } from "./playback";
import { playFile } from "./file-playback";
import { playPcm16 } from "./pcm";

export type NativeAudioModule = Pick<
  typeof import("@getpaseo/expo-two-way-audio"),
  | "initialize"
  | "tearDown"
  | "toggleRecording"
  | "releaseAudioSession"
  | "addExpoTwoWayAudioEventListener"
  | "resumePlayback"
  | "playPCMData"
  | "stopPlayback"
> & {
  getMicrophonePermissionsAsync(): Promise<NativeMicrophonePermission>;
  requestMicrophonePermissionsAsync(): Promise<NativeMicrophonePermission>;
};

interface NativeMicrophonePermission {
  granted: boolean;
}

const captureOwners = new WeakMap<NativeAudioModule, object>();
const playbackOwners = new WeakMap<NativeAudioModule, object>();
const nativeModuleUsers = new WeakMap<NativeAudioModule, number>();

interface AudioEngineTraceOptions {
  nativeModule?: NativeAudioModule;
  traceLabel?: string;
}

export function createAudioEngine(
  callbacks: AudioEngineCallbacks,
  options: AudioEngineTraceOptions = {},
): AudioEngine {
  const native: NativeAudioModule = options.nativeModule ?? require("@getpaseo/expo-two-way-audio");
  nativeModuleUsers.set(native, (nativeModuleUsers.get(native) ?? 0) + 1);

  const refs: {
    initialized: boolean;
    captureActive: boolean;
    muted: boolean;
    destroyed: boolean;
  } = {
    initialized: false,
    captureActive: false,
    muted: false,
    destroyed: false,
  };

  const microphoneSubscription = native.addExpoTwoWayAudioEventListener(
    "onMicrophoneData",
    (event: { data: Uint8Array }) => {
      if (captureOwners.get(native) !== refs || !refs.captureActive || refs.muted) {
        return;
      }
      const pcm = event.data;
      callbacks.onCaptureData(pcm);
    },
  );
  const volumeSubscription = native.addExpoTwoWayAudioEventListener(
    "onInputVolumeLevelData",
    (event: { data: number }) => {
      if (captureOwners.get(native) !== refs || !refs.captureActive) {
        return;
      }
      const level = refs.muted ? 0 : event.data;
      callbacks.onVolumeLevel(level);
    },
  );
  const interruptionSubscription = native.addExpoTwoWayAudioEventListener(
    "onAudioInterruption",
    (event: { data: string }) => {
      if (event.data !== "blocked") {
        return;
      }
      const wasCaptureActive = refs.captureActive;
      refs.captureActive = false;
      if (captureOwners.get(native) === refs) captureOwners.delete(native);
      refs.muted = false;
      callbacks.onVolumeLevel(0);
      if (wasCaptureActive) {
        callbacks.onInterruption?.();
      }
    },
  );

  async function ensureInitialized(): Promise<void> {
    if (refs.destroyed) throw new Error("Audio engine was destroyed");
    const success = await native.initialize();
    if (refs.destroyed) {
      if (nativeModuleUsers.get(native) === 0) native.tearDown();
      else if (!captureOwners.has(native) && !playbackOwners.has(native)) native.releaseAudioSession();
      throw new Error("Audio engine was destroyed");
    }
    if (!success) {
      throw new Error("expo-two-way-audio: native initialize() returned false");
    }
    refs.initialized = true;
  }

  /**
   * Release the OS audio session as soon as we are neither capturing nor playing.
   * Holding it keeps the user's background music paused — on iOS the non-mixing
   * `.playAndRecord` category survives backgrounding and is re-asserted on every
   * foreground, so an unreleased session means their music never comes back.
   */
  function releaseSessionIfIdle(): void {
    if (!refs.initialized || refs.destroyed) {
      return;
    }
    if (refs.captureActive || playback.isPlaying()) {
      return;
    }
    if (playbackOwners.get(native) === refs) {
      native.stopPlayback();
      playbackOwners.delete(native);
    }
    if (captureOwners.has(native) || playbackOwners.has(native)) return;
    // The wrapper no-ops on binaries whose native module predates this function.
    native.releaseAudioSession();
  }

  async function ensureMicrophonePermission(): Promise<void> {
    let permission = await native.getMicrophonePermissionsAsync().catch(() => null);
    if (!permission?.granted) {
      permission = await native.requestMicrophonePermissionsAsync().catch(() => null);
    }
    if (!permission?.granted) {
      throw new Error(
        "Microphone permission is required to capture audio. Please enable microphone access in system settings.",
      );
    }
  }

  let nextFileId = 0;
  async function playAudio(audio: AudioPlaybackSource, signal: AbortSignal): Promise<number> {
    const bytes = new Uint8Array(await audio.arrayBuffer());
    if (signal.aborted) throw new Error("Playback stopped");
    if (audio.type.startsWith("audio/pcm")) {
      await ensureInitialized();
      if (signal.aborted || refs.destroyed) throw new Error("Playback stopped");
      playbackOwners.set(native, refs);
      return playPcm16(bytes, audio.type, signal, native);
    }
    // Capture owns its audio session while active. File playback alone must not
    // initialize the microphone or the native two-way engine.
    if (!captureOwners.has(native)) {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
        interruptionMode: "duckOthers",
        interruptionModeAndroid: "duckOthers",
      });
    }
    if (signal.aborted) throw new Error("Playback stopped");
    // AVPlayer needs a file extension to recognize local encoded audio on iOS.
    const extension =
      {
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/wave": "wav",
        "audio/mpeg": "mp3",
        "audio/mp3": "mp3",
        "audio/mp4": "m4a",
        "audio/aac": "aac",
        "audio/ogg": "ogg",
        "audio/flac": "flac",
      }[audio.type.split(";")[0].trim()] ?? "audio";
    const file = new File(Paths.cache, `paseo-audio-${Date.now()}-${nextFileId++}.${extension}`);
    try {
      file.write(bytes);
      const player = createAudioPlayer(file.uri, {
        updateInterval: 100,
        keepAudioSessionActive: refs.captureActive,
      });
      return await playFile(player, signal);
    } finally {
      if (file.exists) file.delete();
    }
  }
  const playback = createPlaybackQueue(playAudio, releaseSessionIfIdle);

  return {
    async initialize() {
      await ensureInitialized();
    },

    async destroy() {
      if (refs.destroyed) {
        return;
      }
      refs.destroyed = true;
      playback.destroy();
      if (captureOwners.get(native) === refs) {
        native.toggleRecording(false);
        captureOwners.delete(native);
        refs.captureActive = false;
      }
      refs.muted = false;
      callbacks.onVolumeLevel(0);
      const ownedPlayback = playbackOwners.get(native) === refs;
      if (ownedPlayback) {
        native.stopPlayback();
        playbackOwners.delete(native);
      }
      const remainingUsers = (nativeModuleUsers.get(native) ?? 1) - 1;
      nativeModuleUsers.set(native, remainingUsers);
      if (remainingUsers === 0) native.tearDown();
      else if (ownedPlayback && !captureOwners.has(native)) native.releaseAudioSession();
      refs.initialized = false;
      microphoneSubscription.remove();
      volumeSubscription.remove();
      interruptionSubscription.remove();
    },

    async startCapture() {
      if (refs.captureActive) {
        return;
      }

      try {
        await ensureMicrophonePermission();
        await ensureInitialized();
        const isRecording = native.toggleRecording(true);
        if (!isRecording) {
          throw new Error(
            "Microphone capture could not start because Android audio focus is unavailable.",
          );
        }
        captureOwners.set(native, refs);
        refs.captureActive = true;
      } catch (error) {
        const wrapped = error instanceof Error ? error : new Error(String(error));
        callbacks.onError?.(wrapped);
        throw wrapped;
      }
    },

    async stopCapture() {
      if (captureOwners.get(native) === refs) {
        native.toggleRecording(false);
        captureOwners.delete(native);
      }
      refs.captureActive = false;
      refs.muted = false;
      callbacks.onVolumeLevel(0);
      releaseSessionIfIdle();
    },

    toggleMute() {
      refs.muted = !refs.muted;
      if (refs.muted) {
        callbacks.onVolumeLevel(0);
      }
      return refs.muted;
    },

    isMuted() {
      return refs.muted;
    },

    play: playback.play,
    stop: playback.stop,
    clearQueue: playback.clearQueue,
    isPlaying: playback.isPlaying,
  };
}
