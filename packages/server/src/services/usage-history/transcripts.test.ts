import { describe, expect, it } from "vitest";
import {
  initialCodexScanState,
  parseClaudeLine,
  parseCodexLine,
  totalTokens,
} from "./transcripts.js";

function claudeLine(overrides: {
  messageId: string;
  contentType: string;
  model?: string;
  outputTokens?: number;
}): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-08-07T04:05:13.944Z",
    sessionId: "5a128faa-8253-489e-b935-6c08e8e670c0",
    message: {
      id: overrides.messageId,
      role: "assistant",
      model: overrides.model ?? "claude-fable-5",
      content: [{ type: overrides.contentType }],
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 66_818,
        cache_read_input_tokens: 1000,
        output_tokens: overrides.outputTokens ?? 286,
      },
    },
  });
}

describe("parseClaudeLine", () => {
  it("extracts token totals and a dedupe key", () => {
    const record = parseClaudeLine(claudeLine({ messageId: "msg_1", contentType: "text" }));

    expect(record).not.toBeNull();
    expect(record?.provider).toBe("claude");
    expect(record?.model).toBe("claude-fable-5");
    expect(record?.totals).toEqual({
      uncachedInputTokens: 2,
      cachedInputTokens: 1000,
      cacheCreationTokens: 66_818,
      outputTokens: 286,
      reasoningTokens: 0,
    });
    expect(record?.dedupeKey).toBe("msg_1:");
  });

  it("gives every content block of one message the same dedupe key", () => {
    const text = parseClaudeLine(claudeLine({ messageId: "msg_2", contentType: "text" }));
    const toolUse = parseClaudeLine(claudeLine({ messageId: "msg_2", contentType: "tool_use" }));

    expect(text?.dedupeKey).toBe(toolUse?.dedupeKey);
    expect(text?.totals).toEqual(toolUse?.totals);
  });

  it("combines the message and request ids when both are present", () => {
    const line = JSON.parse(claudeLine({ messageId: "msg_3", contentType: "text" }));
    line.requestId = "req_3";
    expect(parseClaudeLine(JSON.stringify(line))?.dedupeKey).toBe("msg_3:req_3");
  });

  it("uses provider-reported cost when present", () => {
    const line = JSON.parse(claudeLine({ messageId: "msg_4", contentType: "text" }));
    line.costUSD = 0.25;
    expect(parseClaudeLine(JSON.stringify(line))?.reportedCostUsd).toBe(0.25);
  });

  it("ignores malformed and non-assistant records", () => {
    expect(parseClaudeLine(JSON.stringify({ type: "user", message: {} }))).toBeNull();
    expect(parseClaudeLine("not json")).toBeNull();
  });
});

describe("parseCodexLine", () => {
  const sessionMeta = JSON.stringify({
    type: "session_meta",
    timestamp: "2026-08-01T05:17:41.289Z",
    payload: { type: "session_meta", id: "019fbbc1-b12c-7360-a685-28c181f0025f" },
  });
  const turnContext = JSON.stringify({
    type: "turn_context",
    timestamp: "2026-08-01T05:17:42.694Z",
    payload: { type: "turn_context", model: "gpt-5.6-sol" },
  });

  function tokenCount(
    inputTokens: number,
    cached: number,
    output: number,
    reasoning: number,
  ): string {
    return JSON.stringify({
      type: "event_msg",
      timestamp: "2026-08-01T05:17:49.919Z",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: inputTokens,
            cached_input_tokens: cached,
            cache_write_input_tokens: 0,
            output_tokens: output,
            reasoning_output_tokens: reasoning,
          },
        },
      },
    });
  }

  it("attributes usage to the preceding turn context", () => {
    const state = initialCodexScanState();
    parseCodexLine(sessionMeta, state);
    parseCodexLine(turnContext, state);
    const record = parseCodexLine(tokenCount(19_239, 11_008, 299, 116), state);

    expect(record?.provider).toBe("codex");
    expect(record?.model).toBe("gpt-5.6-sol");
    expect(record?.sessionId).toBe("019fbbc1-b12c-7360-a685-28c181f0025f");
    expect(record?.totals.uncachedInputTokens).toBe(19_239 - 11_008);
    expect(record?.totals.cachedInputTokens).toBe(11_008);
    expect(record?.totals.reasoningTokens).toBe(116);
  });

  it("skips consecutive duplicate token counts", () => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).not.toBeNull();
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).toBeNull();
  });

  it("does not let a pre-model event poison duplicate suppression", () => {
    const state = initialCodexScanState();
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).toBeNull();
    parseCodexLine(turnContext, state);
    expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)).not.toBeNull();
  });

  describe("forked rollouts", () => {
    function meta(overrides: {
      id: string;
      timestamp: string;
      forkedFromId?: string;
      spawnParentId?: string;
    }): string {
      return JSON.stringify({
        type: "session_meta",
        timestamp: overrides.timestamp,
        payload: {
          type: "session_meta",
          id: overrides.id,
          ...(overrides.forkedFromId ? { forked_from_id: overrides.forkedFromId } : {}),
          ...(overrides.spawnParentId
            ? {
                source: {
                  subagent: { thread_spawn: { parent_thread_id: overrides.spawnParentId } },
                },
              }
            : {}),
        },
      });
    }

    function stamped(timestamp: string, line: string): string {
      const parsed = JSON.parse(line);
      parsed.timestamp = timestamp;
      return JSON.stringify(parsed);
    }

    it("keeps the child session id over copied ancestor metadata", () => {
      const state = initialCodexScanState();
      parseCodexLine(meta({ id: "child", timestamp: "2026-08-01T05:00:00.000Z" }), state);
      parseCodexLine(meta({ id: "parent", timestamp: "2026-08-01T05:00:00.000Z" }), state);
      parseCodexLine(turnContext, state);
      expect(parseCodexLine(tokenCount(100, 0, 10, 0), state)?.sessionId).toBe("child");
    });

    it("drops the copied burst and keeps the first real event", () => {
      const state = initialCodexScanState();
      const forkInstant = "2026-08-01T05:00:00.000Z";
      parseCodexLine(meta({ id: "child", timestamp: forkInstant, forkedFromId: "parent" }), state);
      parseCodexLine(stamped(forkInstant, turnContext), state);

      expect(
        parseCodexLine(stamped("2026-08-01T05:00:00.001Z", tokenCount(100, 0, 10, 0)), state),
      ).toBeNull();
      expect(
        parseCodexLine(stamped("2026-08-01T05:00:00.002Z", tokenCount(200, 0, 20, 0)), state),
      ).toBeNull();
      expect(
        parseCodexLine(stamped("2026-08-01T05:00:06.000Z", tokenCount(300, 0, 30, 0)), state)
          ?.totals.outputTokens,
      ).toBe(30);
      expect(
        parseCodexLine(stamped("2026-08-01T05:00:06.100Z", tokenCount(400, 0, 40, 0)), state),
      ).not.toBeNull();
    });

    it("recognizes subagent spawns without forked_from_id", () => {
      const state = initialCodexScanState();
      const spawnInstant = "2026-08-01T05:00:00.000Z";
      parseCodexLine(
        meta({ id: "child", timestamp: spawnInstant, spawnParentId: "parent" }),
        state,
      );
      parseCodexLine(stamped(spawnInstant, turnContext), state);
      expect(
        parseCodexLine(stamped("2026-08-01T05:00:00.001Z", tokenCount(100, 0, 10, 0)), state),
      ).toBeNull();
    });

    it("does not suppress an ordinary rollout", () => {
      const state = initialCodexScanState();
      parseCodexLine(meta({ id: "root", timestamp: "2026-08-01T05:00:00.000Z" }), state);
      parseCodexLine(stamped("2026-08-01T05:00:00.100Z", turnContext), state);
      expect(
        parseCodexLine(stamped("2026-08-01T05:00:00.200Z", tokenCount(100, 0, 10, 0)), state),
      ).not.toBeNull();
    });
  });
});

describe("totalTokens", () => {
  it("does not add reasoning on top of output", () => {
    expect(
      totalTokens({
        uncachedInputTokens: 10,
        cachedInputTokens: 20,
        cacheCreationTokens: 30,
        outputTokens: 40,
        reasoningTokens: 25,
      }),
    ).toBe(100);
  });
});
