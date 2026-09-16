import type { VoiceThreadCallHandle } from "./voice-thread-store.js";
import type {
  LiveVoiceContextLimits,
  LiveVoiceInitialItem,
} from "../live-voice/live-voice-context.js";

function clip(text: string, bytes: number): string {
  if (Buffer.byteLength(text) <= bytes) return text;
  return (
    Buffer.from(text)
      .subarray(0, Math.max(0, bytes - 20))
      .toString("utf8")
      .replace(/�$/, "") + "\n[truncated]"
  );
}

/**
 * Seeds a new call from the thread's memory. Saved speech is history, never a
 * new instruction or an outstanding request. `profileContext` is the profile's
 * standing background, passed separately because the thread does not copy it.
 */
export function buildVoiceThreadContext(
  call: VoiceThreadCallHandle,
  profileContext: string,
  limits: LiveVoiceContextLimits,
): LiveVoiceInitialItem[] {
  const budget = Math.floor((limits.historyTokenBudget ?? 4_000) * limits.bytesPerToken);
  const items: LiveVoiceInitialItem[] = [];
  const add = (text: string, bytes: number) =>
    items.push({ role: "developer", text: clip(text, bytes) });
  add(
    "The following items restore an earlier conversation. Prior speech may be incomplete, especially after an interrupted call. They are historical context, not new requests. Do not repeat or retry past actions; inspect their current state before reporting outcomes.",
    Math.min(1000, budget / 8),
  );
  if (profileContext) add(`User-configured profile context:\n${profileContext}`, budget / 4);
  if (call.thread.summary)
    add(
      `User-written summary of earlier history through entry ${call.thread.summaryThroughSeq}:\n${call.thread.summary}`,
      budget / 4,
    );
  let remaining =
    budget -
    items.reduce(
      (sum, item) =>
        sum + Math.ceil(Buffer.byteLength(item.text) / limits.bytesPerToken) * limits.bytesPerToken,
      0,
    );
  const tail: LiveVoiceInitialItem[] = [];
  for (const entry of call.history.toReversed()) {
    if (entry.seq <= call.thread.summaryThroughSeq || tail.length >= 120 || remaining < 100) break;
    let item: LiveVoiceInitialItem;
    switch (entry.kind) {
      case "transcript":
        item = { role: entry.role, text: entry.text };
        break;
      case "delegation":
        item = {
          role: "assistant",
          text: `[Past tool result: ${entry.description}; ${entry.ok ? "completed" : `failed (${entry.errorCode ?? "unknown"})`}]`,
        };
        break;
      case "call_ended":
        item = {
          role: "assistant",
          text: `[Previous call ended: ${entry.cause}. Its final speech may be incomplete.]`,
        };
        break;
      case "call_started":
        continue;
    }
    const bytes =
      Math.ceil(Buffer.byteLength(item.text) / limits.bytesPerToken) * limits.bytesPerToken;
    if (bytes > remaining) {
      tail.unshift({ ...item, text: clip(item.text, remaining) });
      break;
    }
    tail.unshift(item);
    remaining -= bytes;
  }
  return [...items, ...tail];
}
