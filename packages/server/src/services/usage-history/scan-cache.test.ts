import { describe, expect, it } from "vitest";
import {
  decodeScanCache,
  dedupeWithinFile,
  encodeScanCache,
  pruneScanCache,
  type CachedFile,
  type ScanCache,
} from "./scan-cache.js";
import type { UsageRecord } from "./transcripts.js";

function record(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    provider: "claude",
    timestampMs: 1_786_000_000_000,
    model: "claude-fable-5",
    sessionId: "session-a",
    totals: {
      uncachedInputTokens: 2,
      cachedInputTokens: 1000,
      cacheCreationTokens: 10,
      outputTokens: 50,
      reasoningTokens: 0,
    },
    reportedCostUsd: null,
    dedupeKey: "msg_1:",
    ...overrides,
  };
}

function position(overrides: Partial<CachedFile["position"]> = {}): CachedFile["position"] {
  return {
    resumeOffset: 120,
    guardLength: 64,
    guardHash: 0xdeadbeef,
    codexState: null,
    ...overrides,
  };
}

function cacheWith(entries: readonly [string, number, readonly UsageRecord[]][]): ScanCache {
  const cache: ScanCache = new Map();
  for (const [filePath, mtimeMs, records] of entries) {
    cache.set(filePath, {
      size: records.length * 10,
      mtimeMs,
      provider: "claude",
      records,
      tailRecords: [],
      position: position(),
    });
  }
  return cache;
}

describe("scan cache round trip", () => {
  it("restores Claude and Codex records and parse state unchanged", () => {
    const original = cacheWith([
      ["/a.jsonl", 100, [record(), record({ dedupeKey: "msg_2:", model: "claude-opus-5" })]],
      ["/b.jsonl", 200, [record({ sessionId: "session-b", reportedCostUsd: 1.5 })]],
    ]);
    original.set("/codex.jsonl", {
      size: 80,
      mtimeMs: 400,
      provider: "codex",
      records: [record({ provider: "codex", model: "gpt-5.2-codex", dedupeKey: null })],
      tailRecords: [],
      position: position({
        codexState: {
          model: "gpt-5.2-codex",
          sessionId: "session-c",
          lastUsageSignature: '{"input_tokens":1}',
          sawSessionMeta: true,
          suppressingForkCopies: false,
          forkCopyAnchorMs: 0,
        },
      }),
    });

    const restored = decodeScanCache(JSON.parse(JSON.stringify(encodeScanCache(original))));
    expect(restored.size).toBe(3);
    expect(restored.get("/a.jsonl")).toEqual(original.get("/a.jsonl"));
    expect(restored.get("/b.jsonl")).toEqual(original.get("/b.jsonl"));
    expect(restored.get("/codex.jsonl")).toEqual(original.get("/codex.jsonl"));
  });

  it("drops entries with corrupt reducer state or guard length", () => {
    const encoded = encodeScanCache(cacheWith([["/a.jsonl", 100, [record()]]]));
    const badState = {
      ...encoded,
      files: { "/a.jsonl": { ...encoded.files["/a.jsonl"], cs: { model: 42 } } },
    };
    const badGuard = {
      ...encoded,
      files: { "/a.jsonl": { ...encoded.files["/a.jsonl"], gl: 1e20 } },
    };
    expect(decodeScanCache(JSON.parse(JSON.stringify(badState))).has("/a.jsonl")).toBe(false);
    expect(decodeScanCache(JSON.parse(JSON.stringify(badGuard))).has("/a.jsonl")).toBe(false);
  });

  it("rejects previous versions and corrupt or foreign documents", () => {
    const encoded = encodeScanCache(cacheWith([["/a.jsonl", 100, [record()]]]));
    expect(decodeScanCache({ ...encoded, version: 2 }).size).toBe(0);
    expect(decodeScanCache(null).size).toBe(0);
    expect(decodeScanCache("nonsense").size).toBe(0);
  });

  it("interns repeated model and session strings", () => {
    const encoded = encodeScanCache(
      cacheWith([["/a.jsonl", 100, [record(), record({ dedupeKey: "msg_2:" }), record()]]]),
    );
    expect(encoded.models).toEqual(["claude-fable-5"]);
    expect(encoded.sessions).toEqual(["session-a"]);
  });

  it("skips malformed file entries while keeping good entries", () => {
    const encoded = encodeScanCache(cacheWith([["/good.jsonl", 100, [record()]]]));
    const withJunk = {
      ...encoded,
      files: {
        ...encoded.files,
        "/bad.jsonl": { s: "nope", m: 1, p: "claude", r: [], t: [] },
      },
    };
    expect([...decodeScanCache(JSON.parse(JSON.stringify(withJunk))).keys()]).toEqual([
      "/good.jsonl",
    ]);
  });

  it("rejects non-string intern tables", () => {
    const encoded = encodeScanCache(cacheWith([["/a.jsonl", 100, [record()]]]));
    expect(decodeScanCache({ ...encoded, models: [1] }).size).toBe(0);
  });

  it("drops a whole entry when any positional row is corrupt", () => {
    const encoded = encodeScanCache(
      cacheWith([["/a.jsonl", 100, [record(), record({ dedupeKey: "msg_2:" })]]]),
    );
    const rows = encoded.files["/a.jsonl"]?.r ?? [];
    const poisoned = {
      ...encoded,
      files: {
        "/a.jsonl": {
          ...encoded.files["/a.jsonl"],
          r: [rows[0], [...(rows[1]?.slice(0, 3) ?? []), "bad", ...(rows[1]?.slice(4) ?? [])]],
        },
      },
    };
    expect(decodeScanCache(JSON.parse(JSON.stringify(poisoned))).has("/a.jsonl")).toBe(false);
  });
});

describe("pruneScanCache", () => {
  it("drops entries older than retention", () => {
    const cache = cacheWith([["/old.jsonl", 500, [record()]]]);
    expect(
      pruneScanCache(cache, {
        livePaths: new Set(),
        walkedRoots: ["/"],
        windowStartMs: 400,
        retentionCutoffMs: 1000,
      }),
    ).toBe(1);
    expect(cache.size).toBe(0);
  });

  it("drops disappeared in-window entries under a walked root", () => {
    const cache = cacheWith([["/root/gone.jsonl", 5000, [record()]]]);
    pruneScanCache(cache, {
      livePaths: new Set(),
      walkedRoots: ["/root"],
      windowStartMs: 4000,
      retentionCutoffMs: 1000,
    });
    expect(cache.size).toBe(0);
  });

  it("keeps entries outside the walk window", () => {
    const cache = cacheWith([["/root/older.jsonl", 2000, [record()]]]);
    pruneScanCache(cache, {
      livePaths: new Set(),
      walkedRoots: ["/root"],
      windowStartMs: 4000,
      retentionCutoffMs: 1000,
    });
    expect(cache.size).toBe(1);
  });

  it("prunes under every walked root while leaving an unwalked sibling home alone", () => {
    const cache = cacheWith([
      ["/codex/sessions/gone.jsonl", 5000, [record()]],
      ["/codex-ben/sessions/gone.jsonl", 5000, [record()]],
      ["/codex-colonel/sessions/kept.jsonl", 5000, [record()]],
    ]);
    pruneScanCache(cache, {
      livePaths: new Set(),
      walkedRoots: ["/codex/sessions", "/codex-ben/sessions"],
      windowStartMs: 4000,
      retentionCutoffMs: 1000,
    });
    expect([...cache.keys()]).toEqual(["/codex-colonel/sessions/kept.jsonl"]);
  });

  it("keeps entries for unwalked and prefix-sibling roots", () => {
    const cache = cacheWith([
      ["/codex/sessions/a.jsonl", 5000, [record()]],
      ["/claude/projects-copy/a.jsonl", 5000, [record()]],
    ]);
    pruneScanCache(cache, {
      livePaths: new Set(),
      walkedRoots: ["/claude/projects"],
      windowStartMs: 4000,
      retentionCutoffMs: 1000,
    });
    expect(cache.size).toBe(2);
  });
});

describe("dedupeWithinFile", () => {
  it("keeps the first record per dedupe key", () => {
    const kept = dedupeWithinFile([
      record({ totals: { ...record().totals, outputTokens: 1 } }),
      record({ totals: { ...record().totals, outputTokens: 999 } }),
      record({ dedupeKey: "msg_2:" }),
    ]);
    expect(kept).toHaveLength(2);
    expect(kept[0]?.totals.outputTokens).toBe(1);
  });

  it("keeps every record without a dedupe key", () => {
    expect(
      dedupeWithinFile([record({ dedupeKey: null }), record({ dedupeKey: null })]),
    ).toHaveLength(2);
  });
});
