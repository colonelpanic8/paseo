import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listTranscriptFiles, readTranscriptRecords } from "./transcript-reader.js";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "usage-reader-test-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function claudeLine(id: number, outputTokens: number): string {
  return `${JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-01T10:00:00Z",
    requestId: `req_${id}`,
    sessionId: "session-1",
    message: {
      id: `msg_${id}`,
      model: "claude-fable-5",
      usage: { input_tokens: 10, output_tokens: outputTokens },
    },
  })}\n`;
}

function codexMetaLine(): string {
  return `${JSON.stringify({
    type: "session_meta",
    timestamp: "2026-08-01T10:00:00Z",
    payload: { type: "session_meta", id: "codex-session-1" },
  })}\n`;
}

function codexModelLine(model: string): string {
  return `${JSON.stringify({
    type: "turn_context",
    timestamp: "2026-08-01T10:00:01Z",
    payload: { type: "turn_context", model },
  })}\n`;
}

function codexUsageLine(outputTokens: number, secondsOffset: number): string {
  return `${JSON.stringify({
    type: "event_msg",
    timestamp: `2026-08-01T10:00:${String(secondsOffset).padStart(2, "0")}Z`,
    payload: {
      type: "token_count",
      info: { last_token_usage: { input_tokens: 100, output_tokens: outputTokens } },
    },
  })}\n`;
}

describe("listTranscriptFiles", () => {
  it("walks recursively, filters extensions, and prefilters by mtime", async () => {
    const nested = path.join(dir, "nested");
    await fs.mkdir(nested);
    const recent = path.join(nested, "recent.jsonl");
    const old = path.join(dir, "old.jsonl");
    await fs.writeFile(recent, "{}\n");
    await fs.writeFile(old, "{}\n");
    await fs.writeFile(path.join(dir, "ignored.txt"), "{}\n");
    await fs.utimes(old, new Date(1000), new Date(1000));

    const files = await listTranscriptFiles(dir, 2000);
    expect(files.map((file) => file.path)).toEqual([recent]);
  });

  it("rejects when the root cannot be walked", async () => {
    await expect(listTranscriptFiles(path.join(dir, "missing"), 0)).rejects.toThrow();
  });
});

describe("readTranscriptRecords resume", () => {
  it("parses only appended lines when resuming a grown file", async () => {
    const filePath = path.join(dir, "claude.jsonl");
    await fs.writeFile(filePath, claudeLine(1, 5) + claudeLine(2, 7));
    const first = await readTranscriptRecords(filePath, "claude");
    expect(first?.records).toHaveLength(2);
    expect(first?.resumed).toBe(false);
    if (!first) throw new Error("expected initial parse");

    await fs.appendFile(filePath, claudeLine(3, 11));
    const second = await readTranscriptRecords(filePath, "claude", first.position);
    expect(second?.resumed).toBe(true);
    expect(second?.records.map((record) => record.totals.outputTokens)).toEqual([11]);
  });

  it("carries Codex reducer state across the resume boundary", async () => {
    const filePath = path.join(dir, "rollout.jsonl");
    await fs.writeFile(filePath, codexMetaLine() + codexModelLine("gpt-5.2-codex"));
    const first = await readTranscriptRecords(filePath, "codex");
    if (!first) throw new Error("expected initial parse");

    await fs.appendFile(filePath, codexUsageLine(9, 5));
    const second = await readTranscriptRecords(filePath, "codex", first.position);
    expect(second?.resumed).toBe(true);
    expect(second?.records[0]?.model).toBe("gpt-5.2-codex");
    expect(second?.records[0]?.sessionId).toBe("codex-session-1");
  });

  it("suppresses a Codex duplicate that straddles the boundary", async () => {
    const filePath = path.join(dir, "rollout.jsonl");
    await fs.writeFile(
      filePath,
      codexMetaLine() + codexModelLine("gpt-5.2-codex") + codexUsageLine(9, 5),
    );
    const first = await readTranscriptRecords(filePath, "codex");
    if (!first) throw new Error("expected initial parse");

    await fs.appendFile(filePath, codexUsageLine(9, 5) + codexUsageLine(21, 8));
    const second = await readTranscriptRecords(filePath, "codex", first.position);
    expect(second?.records.map((record) => record.totals.outputTokens)).toEqual([21]);
  });

  it("defers an unterminated line, then consumes it once terminated", async () => {
    const filePath = path.join(dir, "claude.jsonl");
    await fs.writeFile(filePath, claudeLine(1, 5) + claudeLine(2, 7).trimEnd());
    const first = await readTranscriptRecords(filePath, "claude");
    expect(first?.records).toHaveLength(1);
    expect(first?.tailRecords[0]?.totals.outputTokens).toBe(7);
    if (!first) throw new Error("expected initial parse");

    await fs.appendFile(filePath, `\n${claudeLine(3, 11)}`);
    const second = await readTranscriptRecords(filePath, "claude", first.position);
    expect(second?.records.map((record) => record.totals.outputTokens)).toEqual([7, 11]);
    expect(second?.tailRecords).toHaveLength(0);
  });

  it("re-parses from the start when guard bytes no longer match", async () => {
    const filePath = path.join(dir, "claude.jsonl");
    await fs.writeFile(filePath, claudeLine(1, 5));
    const first = await readTranscriptRecords(filePath, "claude");
    if (!first) throw new Error("expected initial parse");

    await fs.writeFile(filePath, claudeLine(4, 13) + claudeLine(5, 17));
    const second = await readTranscriptRecords(filePath, "claude", first.position);
    expect(second?.resumed).toBe(false);
    expect(second?.records.map((record) => record.totals.outputTokens)).toEqual([13, 17]);
  });

  it("re-parses from the start when the file shrank", async () => {
    const filePath = path.join(dir, "claude.jsonl");
    await fs.writeFile(filePath, claudeLine(1, 5) + claudeLine(2, 7));
    const first = await readTranscriptRecords(filePath, "claude");
    if (!first) throw new Error("expected initial parse");

    await fs.writeFile(filePath, claudeLine(3, 11));
    const second = await readTranscriptRecords(filePath, "claude", first.position);
    expect(second?.resumed).toBe(false);
    expect(second?.records.map((record) => record.totals.outputTokens)).toEqual([11]);
  });

  it("parses a line larger than one stream chunk", async () => {
    const filePath = path.join(dir, "claude.jsonl");
    const bigLine = `${JSON.stringify({
      type: "assistant",
      timestamp: "2026-08-01T10:00:00Z",
      requestId: "req_big",
      sessionId: "session-1",
      padding: "x".repeat(512 * 1024),
      message: {
        id: "msg_big",
        model: "claude-fable-5",
        usage: { input_tokens: 10, output_tokens: 42 },
      },
    })}\n`;
    await fs.writeFile(filePath, bigLine + claudeLine(2, 7));

    const parsed = await readTranscriptRecords(filePath, "claude");
    expect(parsed?.records.map((record) => record.totals.outputTokens)).toEqual([42, 7]);
  });

  it("returns null for an unreadable file", async () => {
    expect(await readTranscriptRecords(path.join(dir, "missing.jsonl"), "claude")).toBeNull();
  });
});
