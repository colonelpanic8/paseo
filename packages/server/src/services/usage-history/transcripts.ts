import type { ProviderUsageHistoryBucket } from "../../server/messages.js";

export type UsageProvider = "claude" | "codex";
export type UsageTokenTotals = ProviderUsageHistoryBucket["totals"];

export interface UsageRecord {
  readonly provider: UsageProvider;
  readonly timestampMs: number;
  readonly model: string;
  readonly sessionId: string;
  readonly totals: UsageTokenTotals;
  readonly reportedCostUsd: number | null;
  /** Key for cross-file de-duplication, or `null` when the record is inherently unique. */
  readonly dedupeKey: string | null;
}

export const EMPTY_TOTALS: UsageTokenTotals = {
  uncachedInputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
};

function positiveInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
}

function objectField(
  record: Record<string, unknown>,
  field: string,
): Record<string, unknown> | null {
  const value = record[field];
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === "string" ? value : null;
}

export function addTotals(a: UsageTokenTotals, b: UsageTokenTotals): UsageTokenTotals {
  return {
    uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

export function totalTokens(totals: UsageTokenTotals): number {
  // reasoningTokens is a subset of outputTokens and must not be added again.
  return (
    totals.uncachedInputTokens +
    totals.cachedInputTokens +
    totals.cacheCreationTokens +
    totals.outputTokens
  );
}

/**
 * Transcripts are mostly tool output. This gate avoids parsing lines that cannot carry usage.
 */
export function mightCarryUsage(line: string, provider: UsageProvider): boolean {
  return provider === "claude" ? line.includes('"usage"') : line.includes('"token_count"');
}

/**
 * Claude writes one record per assistant content block, repeating the parent message's complete
 * usage. Callers drop repeats by `dedupeKey` and keep the first.
 */
export function parseClaudeLine(line: string): UsageRecord | null {
  const record = parseJsonObject(line);
  if (record === null) return null;
  if (record["type"] !== "assistant") return null;
  const messageRecord = objectField(record, "message");
  if (messageRecord === null) return null;
  const usageRecord = objectField(messageRecord, "usage");
  if (usageRecord === null) return null;

  const timestampMs = parseTimestampMs(record["timestamp"]);
  if (timestampMs === null) return null;

  const model = stringField(messageRecord, "model");
  if (!model) return null;

  const messageId = stringField(messageRecord, "id");
  const requestId = stringField(record, "requestId");
  // Match ccusage: prefer the message/request pair, then whichever half exists.
  const dedupeKey =
    messageId === null && requestId === null ? null : `${messageId ?? ""}:${requestId ?? ""}`;
  const cost = record["costUSD"];

  return {
    provider: "claude",
    timestampMs,
    model,
    sessionId: stringField(record, "sessionId") ?? "",
    totals: {
      uncachedInputTokens: positiveInt(usageRecord["input_tokens"]),
      cachedInputTokens: positiveInt(usageRecord["cache_read_input_tokens"]),
      cacheCreationTokens: positiveInt(usageRecord["cache_creation_input_tokens"]),
      outputTokens: positiveInt(usageRecord["output_tokens"]),
      // Anthropic folds thinking tokens into output and does not break them out.
      reasoningTokens: 0,
    },
    reportedCostUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
    dedupeKey,
  };
}

/** Codex token events carry no model, so the most recent turn context is carried forward. */
export interface CodexScanState {
  model: string;
  sessionId: string;
  lastUsageSignature: string | null;
  sawSessionMeta: boolean;
  /** While true, leading usage events are re-stamped copies of parent history. */
  suppressingForkCopies: boolean;
  forkCopyAnchorMs: number;
}

export function initialCodexScanState(): CodexScanState {
  return {
    model: "",
    sessionId: "",
    lastUsageSignature: null,
    sawSessionMeta: false,
    suppressingForkCopies: false,
    forkCopyAnchorMs: 0,
  };
}

/**
 * Forked rollouts begin with parent history re-stamped in one short burst. The first event at least
 * one second later belongs to the child; ccusage uses the same threshold.
 */
const FORK_COPY_MAX_GAP_MS = 1000;

function isForkedSessionMeta(payload: Record<string, unknown>): boolean {
  if (typeof payload["forked_from_id"] === "string") return true;
  const source = payload["source"];
  if (typeof source !== "object" || source === null) return false;
  const subagent = (source as Record<string, unknown>)["subagent"];
  if (typeof subagent !== "object" || subagent === null) return false;
  const spawn = (subagent as Record<string, unknown>)["thread_spawn"];
  if (typeof spawn !== "object" || spawn === null) return false;
  return typeof (spawn as Record<string, unknown>)["parent_thread_id"] === "string";
}

function updateCodexSessionMeta(
  record: Record<string, unknown>,
  payload: Record<string, unknown>,
  state: CodexScanState,
): void {
  if (state.sawSessionMeta) return;
  state.sawSessionMeta = true;
  const id = payload["id"] ?? payload["session_id"];
  if (typeof id === "string") state.sessionId = id;
  const metaTimestampMs = parseTimestampMs(record["timestamp"]);
  if (metaTimestampMs !== null && isForkedSessionMeta(payload)) {
    state.suppressingForkCopies = true;
    state.forkCopyAnchorMs = metaTimestampMs;
  }
}

function readCodexLastUsage(payload: Record<string, unknown>): Record<string, unknown> | null {
  if (payload["type"] !== "token_count") return null;
  const info = objectField(payload, "info");
  return info === null ? null : objectField(info, "last_token_usage");
}

function suppressForkCopy(timestampMs: number, state: CodexScanState): boolean {
  if (!state.suppressingForkCopies) return false;
  if (timestampMs - state.forkCopyAnchorMs < FORK_COPY_MAX_GAP_MS) {
    state.forkCopyAnchorMs = timestampMs;
    return true;
  }
  state.suppressingForkCopies = false;
  return false;
}

/**
 * Codex deltas come from `last_token_usage`. Consecutive duplicates are stream-boundary repeats,
 * and must be dropped for their sum to reconcile with the session total.
 */
export function parseCodexLine(line: string, state: CodexScanState): UsageRecord | null {
  const record = parseJsonObject(line);
  if (record === null) return null;
  const payloadRecord = objectField(record, "payload");
  if (payloadRecord === null) return null;

  if (record["type"] === "session_meta") {
    // Forked rollouts repeat ancestor metadata after their own. The first meta owns the file.
    updateCodexSessionMeta(record, payloadRecord, state);
    return null;
  }

  if (record["type"] === "turn_context") {
    if (typeof payloadRecord["model"] === "string") state.model = payloadRecord["model"];
    return null;
  }

  const lastRecord = readCodexLastUsage(payloadRecord);
  if (lastRecord === null) return null;

  // An otherwise ineligible event must not consume the duplicate signature. Codex can re-emit it
  // once the model is known, and that later copy must count.
  const timestampMs = parseTimestampMs(record["timestamp"]);
  if (timestampMs === null || state.model.length === 0) return null;

  const signature = JSON.stringify(lastRecord);
  if (signature === state.lastUsageSignature) return null;
  state.lastUsageSignature = signature;

  // Parent history was already counted in its own file. Suppression ends permanently at the first
  // event separated from the copied burst by a real turn's worth of time.
  if (suppressForkCopy(timestampMs, state)) return null;

  const inputTokens = positiveInt(lastRecord["input_tokens"]);
  const cachedInputTokens = positiveInt(lastRecord["cached_input_tokens"]);
  const cacheCreationTokens = positiveInt(lastRecord["cache_write_input_tokens"]);
  const outputTokens = positiveInt(lastRecord["output_tokens"]);
  const totals: UsageTokenTotals = {
    // Codex input_tokens includes both cached portions.
    uncachedInputTokens: Math.max(0, inputTokens - cachedInputTokens - cacheCreationTokens),
    cachedInputTokens,
    cacheCreationTokens,
    outputTokens,
    // Reported inside output_tokens, surfaced separately for the token mix.
    reasoningTokens: Math.min(outputTokens, positiveInt(lastRecord["reasoning_output_tokens"])),
  };
  if (totalTokens(totals) === 0) return null;

  return {
    provider: "codex",
    timestampMs,
    model: state.model,
    sessionId: state.sessionId,
    totals,
    reportedCostUsd: null,
    // Events surviving fork-copy suppression are unique to this rollout.
    dedupeKey: null,
  };
}
