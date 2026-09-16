import type { TFunction } from "i18next";
import type { VoiceThread } from "@getpaseo/protocol/voice-profiles";

/** A thread is untitled until its first user utterance names it. */
export function resolveVoiceThreadTitle(thread: Pick<VoiceThread, "title">, t: TFunction): string {
  return thread.title.trim() || t("voiceProfiles.thread.untitled");
}
