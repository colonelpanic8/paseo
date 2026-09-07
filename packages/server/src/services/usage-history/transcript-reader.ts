import { promises as fs } from "node:fs";
import path from "node:path";
import {
  initialCodexScanState,
  mightCarryUsage,
  parseClaudeLine,
  parseCodexLine,
  type CodexScanState,
  type UsageProvider,
  type UsageRecord,
} from "./transcripts.js";

export interface TranscriptFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/**
 * The guard hashes bytes immediately before the resume offset. It catches replaced or rewritten
 * append-only transcripts without paying for a full-prefix hash on every warm scan.
 */
export interface TranscriptParsePosition {
  readonly resumeOffset: number;
  readonly guardLength: number;
  readonly guardHash: number;
  readonly codexState: CodexScanState | null;
}

export interface TranscriptParseResult {
  readonly records: readonly UsageRecord[];
  /** Unterminated last-line records are returned but not consumed, so the next scan re-reads them. */
  readonly tailRecords: readonly UsageRecord[];
  readonly position: TranscriptParsePosition;
  readonly resumed: boolean;
}

export const GUARD_LENGTH = 64;
const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

function fnv1a(buffer: Buffer): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < buffer.length; index += 1) {
    hash ^= buffer[index] ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Individual entries may rotate during a walk; only failure to read the root is fatal. */
export async function listTranscriptFiles(
  root: string,
  sinceMs: number,
): Promise<readonly TranscriptFile[]> {
  const found: TranscriptFile[] = [];

  async function walk(dir: string, isRoot: boolean): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isRoot) throw error;
      return;
    }
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(child, false);
        continue;
      }
      if (!entry.name.endsWith(".jsonl")) continue;
      try {
        const stats = await fs.stat(child);
        if (stats.mtimeMs >= sinceMs) {
          found.push({ path: child, size: stats.size, mtimeMs: stats.mtimeMs });
        }
      } catch {
        // The file vanished between readdir and stat.
      }
    }
  }

  await walk(root, true);
  return found;
}

async function guardMatches(
  handle: fs.FileHandle,
  position: TranscriptParsePosition,
): Promise<boolean> {
  if (position.guardLength <= 0 || position.guardLength > GUARD_LENGTH) return false;
  try {
    const window = Buffer.alloc(position.guardLength);
    const { bytesRead } = await handle.read(
      window,
      0,
      position.guardLength,
      position.resumeOffset - position.guardLength,
    );
    return bytesRead === position.guardLength && fnv1a(window) === position.guardHash;
  } catch {
    return false;
  }
}

interface ParseStart {
  start: number;
  resumed: boolean;
  codexState: CodexScanState;
}

async function resolveParseStart(
  handle: fs.FileHandle,
  provider: UsageProvider,
  resumeFrom?: TranscriptParsePosition,
): Promise<ParseStart> {
  const initial = { start: 0, resumed: false, codexState: initialCodexScanState() };
  if (resumeFrom === undefined || resumeFrom.resumeOffset <= 0) return initial;
  if (provider === "codex" && resumeFrom.codexState === null) return initial;
  if (!(await guardMatches(handle, resumeFrom))) return initial;
  return {
    start: resumeFrom.resumeOffset,
    resumed: true,
    codexState: resumeFrom.codexState === null ? initial.codexState : { ...resumeFrom.codexState },
  };
}

function parseProviderLine(
  line: string,
  provider: UsageProvider,
  state: CodexScanState,
  records: UsageRecord[],
): void {
  if (provider === "codex") {
    const carriesState = line.includes('"turn_context"') || line.includes('"session_meta"');
    if (!mightCarryUsage(line, provider) && !carriesState) return;
    const record = parseCodexLine(line, state);
    if (record !== null) records.push(record);
    return;
  }
  if (!mightCarryUsage(line, provider)) return;
  const record = parseClaudeLine(line);
  if (record !== null) records.push(record);
}

function toLineString(lineBuffer: Buffer): string {
  const endsWithCarriageReturn =
    lineBuffer.length > 0 && lineBuffer[lineBuffer.length - 1] === CARRIAGE_RETURN;
  const content = endsWithCarriageReturn ? lineBuffer.subarray(0, -1) : lineBuffer;
  return content.toString("utf8");
}

interface StreamedLines {
  records: UsageRecord[];
  pendingChunks: Buffer[];
  resumeOffset: number;
}

async function streamLines(
  handle: fs.FileHandle,
  provider: UsageProvider,
  start: number,
  codexState: CodexScanState,
): Promise<StreamedLines> {
  const records: UsageRecord[] = [];
  let resumeOffset = start;
  let pendingChunks: Buffer[] = [];
  const stream = handle.createReadStream({ start, autoClose: false }) as AsyncIterable<Buffer>;
  for await (const chunk of stream) {
    if (!chunk.includes(NEWLINE)) {
      pendingChunks.push(chunk);
      continue;
    }
    const buffer = pendingChunks.length === 0 ? chunk : Buffer.concat([...pendingChunks, chunk]);
    pendingChunks = [];
    let lineStart = 0;
    for (;;) {
      const newlineIndex = buffer.indexOf(NEWLINE, lineStart);
      if (newlineIndex === -1) break;
      parseProviderLine(
        toLineString(buffer.subarray(lineStart, newlineIndex)),
        provider,
        codexState,
        records,
      );
      lineStart = newlineIndex + 1;
    }
    resumeOffset += lineStart;
    if (lineStart < buffer.length) pendingChunks.push(buffer.subarray(lineStart));
  }
  return { records, pendingChunks, resumeOffset };
}

function parseTail(
  chunks: readonly Buffer[],
  provider: UsageProvider,
  codexState: CodexScanState,
): readonly UsageRecord[] {
  if (chunks.length === 0) return [];
  const pending = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
  if (!pending || pending.length === 0) return [];
  const records: UsageRecord[] = [];
  parseProviderLine(toLineString(pending), provider, { ...codexState }, records);
  return records;
}

async function makePosition(
  handle: fs.FileHandle,
  provider: UsageProvider,
  resumeOffset: number,
  codexState: CodexScanState,
): Promise<TranscriptParsePosition> {
  const guardLength = Math.min(GUARD_LENGTH, resumeOffset);
  let guardHash = 0;
  if (guardLength > 0) {
    const window = Buffer.alloc(guardLength);
    await handle.read(window, 0, guardLength, resumeOffset - guardLength);
    guardHash = fnv1a(window);
  }
  return {
    resumeOffset,
    guardLength,
    guardHash,
    codexState: provider === "codex" ? codexState : null,
  };
}

/**
 * Streams a transcript, resuming only when the cached guard still matches. A read failure returns
 * null so callers never cache a transient failure as a stable empty transcript.
 */
export async function readTranscriptRecords(
  filePath: string,
  provider: UsageProvider,
  resumeFrom?: TranscriptParsePosition,
): Promise<TranscriptParseResult | null> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(filePath, "r");
  } catch {
    return null;
  }

  try {
    const parseStart = await resolveParseStart(handle, provider, resumeFrom);
    // Buffer-level splitting keeps resume offsets byte-exact. Chunk arrays avoid repeatedly copying
    // a multi-megabyte JSON line before its newline arrives.
    const streamed = await streamLines(handle, provider, parseStart.start, parseStart.codexState);
    const tailRecords = parseTail(streamed.pendingChunks, provider, parseStart.codexState);
    const position = await makePosition(
      handle,
      provider,
      streamed.resumeOffset,
      parseStart.codexState,
    );

    return {
      records: streamed.records,
      tailRecords,
      position,
      resumed: parseStart.resumed,
    };
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}
