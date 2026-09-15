import path from "node:path";
import { GUARD_LENGTH, type TranscriptParsePosition } from "./transcript-reader.js";
import type { CodexScanState, UsageProvider, UsageRecord } from "./transcripts.js";

export const USAGE_SCAN_CACHE_VERSION = 3;

export interface CachedFile {
  readonly size: number;
  readonly mtimeMs: number;
  readonly provider: UsageProvider;
  /** Newline-terminated records through `position.resumeOffset`. */
  readonly records: readonly UsageRecord[];
  /** Unterminated tail records remain separate because a resumed parse re-reads them. */
  readonly tailRecords: readonly UsageRecord[];
  readonly position: TranscriptParsePosition;
}

export type ScanCache = Map<string, CachedFile>;

/** Positional rows and interned strings keep a real 30-day cache to a few megabytes. */
type SerializedRecord = readonly [
  timestampMs: number,
  modelIndex: number,
  sessionIndex: number,
  uncachedInputTokens: number,
  cachedInputTokens: number,
  cacheCreationTokens: number,
  outputTokens: number,
  reasoningTokens: number,
  dedupeKey: string | null,
  reportedCostUsd: number | null,
];

interface SerializedFile {
  readonly s: number;
  readonly m: number;
  readonly p: UsageProvider;
  readonly r: readonly SerializedRecord[];
  readonly t: readonly SerializedRecord[];
  readonly o: number;
  readonly gl: number;
  readonly gh: number;
  readonly cs: CodexScanState | null;
}

export interface SerializedScanCache {
  readonly version: number;
  readonly models: readonly string[];
  readonly sessions: readonly string[];
  readonly files: Readonly<Record<string, SerializedFile>>;
}

export function encodeScanCache(cache: ScanCache): SerializedScanCache {
  const models: string[] = [];
  const sessions: string[] = [];
  const modelIndexes = new Map<string, number>();
  const sessionIndexes = new Map<string, number>();

  function intern(table: string[], indexes: Map<string, number>, value: string): number {
    const existing = indexes.get(value);
    if (existing !== undefined) return existing;
    const next = table.length;
    table.push(value);
    indexes.set(value, next);
    return next;
  }

  function serializeRecord(record: UsageRecord): SerializedRecord {
    return [
      record.timestampMs,
      intern(models, modelIndexes, record.model),
      intern(sessions, sessionIndexes, record.sessionId),
      record.totals.uncachedInputTokens,
      record.totals.cachedInputTokens,
      record.totals.cacheCreationTokens,
      record.totals.outputTokens,
      record.totals.reasoningTokens,
      record.dedupeKey,
      record.reportedCostUsd,
    ];
  }

  const files: Record<string, SerializedFile> = {};
  for (const [filePath, entry] of cache) {
    files[filePath] = {
      s: entry.size,
      m: entry.mtimeMs,
      p: entry.provider,
      r: entry.records.map(serializeRecord),
      t: entry.tailRecords.map(serializeRecord),
      o: entry.position.resumeOffset,
      gl: entry.position.guardLength,
      gh: entry.position.guardHash,
      cs: entry.position.codexState,
    };
  }
  return { version: USAGE_SCAN_CACHE_VERSION, models, sessions, files };
}

function isArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

interface DecodedRoot {
  models: readonly string[];
  sessions: readonly string[];
  files: Readonly<Record<string, unknown>>;
}

function decodeRoot(document: unknown): DecodedRoot | null {
  if (typeof document !== "object" || document === null) return null;
  const root = document as Partial<SerializedScanCache>;
  if (root.version !== USAGE_SCAN_CACHE_VERSION) return null;
  if (!isArray(root.models) || !root.models.every((value) => typeof value === "string")) {
    return null;
  }
  if (!isArray(root.sessions) || !root.sessions.every((value) => typeof value === "string")) {
    return null;
  }
  if (typeof root.files !== "object" || root.files === null) return null;
  return {
    models: root.models as readonly string[],
    sessions: root.sessions as readonly string[],
    files: root.files,
  };
}

function areFiniteNumbers(values: readonly unknown[]): values is readonly number[] {
  return values.every((value) => typeof value === "number" && Number.isFinite(value));
}

function decodeRecords(
  rows: readonly unknown[],
  provider: UsageProvider,
  models: readonly string[],
  sessions: readonly string[],
): UsageRecord[] | null {
  const records: UsageRecord[] = [];
  for (const row of rows) {
    if (!isArray(row) || row.length < 10) return null;
    const [
      timestampMs,
      modelIndex,
      sessionIndex,
      uncached,
      cached,
      cacheCreation,
      output,
      reasoning,
      dedupeKey,
      reportedCostUsd,
    ] = row;
    const model = typeof modelIndex === "number" ? models[modelIndex] : undefined;
    const tokenCounts = [uncached, cached, cacheCreation, output, reasoning];
    if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs) || model === undefined) {
      return null;
    }
    if (!areFiniteNumbers(tokenCounts)) return null;
    const [uncachedTokens, cachedTokens, cacheCreationTokens, outputTokens, reasoningTokens] =
      tokenCounts;

    records.push({
      provider,
      timestampMs,
      model,
      sessionId: (typeof sessionIndex === "number" ? sessions[sessionIndex] : undefined) ?? "",
      totals: {
        uncachedInputTokens: uncachedTokens ?? 0,
        cachedInputTokens: cachedTokens ?? 0,
        cacheCreationTokens: cacheCreationTokens ?? 0,
        outputTokens: outputTokens ?? 0,
        reasoningTokens: reasoningTokens ?? 0,
      },
      reportedCostUsd:
        typeof reportedCostUsd === "number" && Number.isFinite(reportedCostUsd)
          ? reportedCostUsd
          : null,
      dedupeKey: typeof dedupeKey === "string" ? dedupeKey : null,
    });
  }
  return records;
}

function hasValidPosition(entry: Partial<SerializedFile>): entry is Partial<SerializedFile> & {
  o: number;
  gl: number;
  gh: number;
} {
  return (
    typeof entry.o === "number" &&
    Number.isSafeInteger(entry.o) &&
    entry.o >= 0 &&
    typeof entry.gl === "number" &&
    Number.isSafeInteger(entry.gl) &&
    entry.gl >= 0 &&
    entry.gl <= GUARD_LENGTH &&
    entry.gl <= entry.o &&
    typeof entry.gh === "number" &&
    Number.isFinite(entry.gh)
  );
}

function decodeFile(
  raw: unknown,
  models: readonly string[],
  sessions: readonly string[],
): CachedFile | null {
  if (typeof raw !== "object" || raw === null) return null;
  const entry = raw as Partial<SerializedFile>;
  if (typeof entry.s !== "number" || typeof entry.m !== "number") return null;
  if (entry.p !== "claude" && entry.p !== "codex") return null;
  if (!isArray(entry.r) || !isArray(entry.t) || !hasValidPosition(entry)) return null;
  const codexState = decodeCodexState(entry.cs);
  if (codexState === undefined) return null;
  const records = decodeRecords(entry.r, entry.p, models, sessions);
  const tailRecords = decodeRecords(entry.t, entry.p, models, sessions);
  if (records === null || tailRecords === null) return null;
  return {
    size: entry.s,
    mtimeMs: entry.m,
    provider: entry.p,
    records,
    tailRecords,
    position: {
      resumeOffset: entry.o,
      guardLength: entry.gl,
      guardHash: entry.gh,
      codexState,
    },
  };
}

/** A corrupt cache costs one cold scan and never breaks a usage read. */
export function decodeScanCache(document: unknown): ScanCache {
  const cache: ScanCache = new Map();
  const root = decodeRoot(document);
  if (root === null) return cache;
  for (const [filePath, raw] of Object.entries(root.files)) {
    const entry = decodeFile(raw, root.models, root.sessions);
    if (entry !== null) cache.set(filePath, entry);
  }
  return cache;
}

/** A bad reducer state can misattribute appended usage, so it invalidates the whole file entry. */
function decodeCodexState(value: unknown): CodexScanState | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const state = value as Partial<CodexScanState>;
  if (
    typeof state.model !== "string" ||
    typeof state.sessionId !== "string" ||
    (state.lastUsageSignature !== null && typeof state.lastUsageSignature !== "string") ||
    typeof state.sawSessionMeta !== "boolean" ||
    typeof state.suppressingForkCopies !== "boolean" ||
    typeof state.forkCopyAnchorMs !== "number" ||
    !Number.isFinite(state.forkCopyAnchorMs)
  ) {
    return undefined;
  }
  return {
    model: state.model,
    sessionId: state.sessionId,
    lastUsageSignature: state.lastUsageSignature ?? null,
    sawSessionMeta: state.sawSessionMeta,
    suppressingForkCopies: state.suppressingForkCopies,
    forkCopyAnchorMs: state.forkCopyAnchorMs,
  };
}

export interface PruneOptions {
  readonly livePaths: ReadonlySet<string>;
  readonly walkedRoots: readonly string[];
  readonly windowStartMs: number;
  readonly retentionCutoffMs: number;
}

/**
 * Absence proves deletion only under a root that was successfully walked and inside that walk's
 * time window. A seven-day read must not evict still-valid 30-day entries it never inspected.
 */
export function pruneScanCache(cache: ScanCache, options: PruneOptions): number {
  let removed = 0;
  for (const [filePath, entry] of cache) {
    const agedOut = entry.mtimeMs < options.retentionCutoffMs;
    const underWalkedRoot = options.walkedRoots.some((root) => {
      const relative = path.relative(root, filePath);
      return (
        relative === "" ||
        (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
      );
    });
    const deleted =
      underWalkedRoot && entry.mtimeMs >= options.windowStartMs && !options.livePaths.has(filePath);
    if (agedOut || deleted) {
      cache.delete(filePath);
      removed += 1;
    }
  }
  return removed;
}

/** A shared set lets resumed base, appended lines, and tail dedupe as one file. */
export function dedupeWithinFile(
  records: readonly UsageRecord[],
  seen: Set<string> = new Set(),
): readonly UsageRecord[] {
  const kept: UsageRecord[] = [];
  for (const record of records) {
    if (record.dedupeKey !== null) {
      if (seen.has(record.dedupeKey)) continue;
      seen.add(record.dedupeKey);
    }
    kept.push(record);
  }
  return kept;
}
