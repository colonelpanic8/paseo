import { describe, expect, it } from "vitest";
import type { StreamItem } from "@/types/stream";
import { computeSessionFindMatches, extractSearchableText } from "./find-in-session";

function userMessage(id: string, text: string): StreamItem {
  return { kind: "user_message", id, text, timestamp: new Date(0) };
}

function assistantMessage(id: string, text: string): StreamItem {
  return { kind: "assistant_message", id, text, timestamp: new Date(0) };
}

function thought(id: string, text: string): StreamItem {
  return { kind: "thought", id, text, timestamp: new Date(0), status: "ready" };
}

function speakToolCall(id: string, input: string): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(0),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: "speak",
        status: "completed",
        error: null,
        detail: { type: "unknown", input, output: null },
      },
    },
  };
}

function bashToolCall(id: string, input: string): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp: new Date(0),
    payload: {
      source: "agent",
      data: {
        provider: "claude",
        callId: id,
        name: "bash",
        status: "completed",
        error: null,
        detail: { type: "unknown", input, output: null },
      },
    },
  };
}

describe("extractSearchableText", () => {
  it("returns message text for user and assistant messages", () => {
    expect(extractSearchableText(userMessage("u1", "hello world"))).toBe("hello world");
    expect(extractSearchableText(assistantMessage("a1", "response text"))).toBe("response text");
  });

  it("returns activity log messages", () => {
    const item: StreamItem = {
      kind: "activity_log",
      id: "log1",
      timestamp: new Date(0),
      activityType: "error",
      message: "something failed",
    };
    expect(extractSearchableText(item)).toBe("something failed");
  });

  it("joins todo list entries", () => {
    const item: StreamItem = {
      kind: "todo_list",
      id: "todo1",
      timestamp: new Date(0),
      provider: "claude",
      items: [
        { text: "first task", completed: true },
        { text: "second task", completed: false },
      ],
    };
    expect(extractSearchableText(item)).toBe("first task\nsecond task");
  });

  it("includes speak tool calls but not other tool calls", () => {
    expect(extractSearchableText(speakToolCall("s1", "spoken message"))).toBe("spoken message");
    expect(extractSearchableText(bashToolCall("b1", "rg pattern"))).toBe("");
  });

  it("excludes collapsed reasoning text", () => {
    expect(extractSearchableText(thought("t1", "hidden reasoning"))).toBe("");
  });
});

describe("computeSessionFindMatches", () => {
  it("returns no matches for an empty query", () => {
    expect(computeSessionFindMatches([userMessage("u1", "hello")], "")).toEqual([]);
  });

  it("matches case-insensitively", () => {
    const matches = computeSessionFindMatches(
      [userMessage("u1", "Hello World"), assistantMessage("a1", "HELLO again")],
      "hello",
    );
    expect(matches).toEqual([
      { itemId: "u1", occurrenceIndex: 0 },
      { itemId: "a1", occurrenceIndex: 0 },
    ]);
  });

  it("enumerates multiple occurrences within one item in order", () => {
    const matches = computeSessionFindMatches(
      [assistantMessage("a1", "foo bar foo baz foo")],
      "foo",
    );
    expect(matches).toEqual([
      { itemId: "a1", occurrenceIndex: 0 },
      { itemId: "a1", occurrenceIndex: 1 },
      { itemId: "a1", occurrenceIndex: 2 },
    ]);
  });

  it("does not count overlapping occurrences twice", () => {
    const matches = computeSessionFindMatches([assistantMessage("a1", "aaaa")], "aa");
    expect(matches).toEqual([
      { itemId: "a1", occurrenceIndex: 0 },
      { itemId: "a1", occurrenceIndex: 1 },
    ]);
  });

  it("preserves display order across items", () => {
    const matches = computeSessionFindMatches(
      [
        userMessage("u1", "needle"),
        bashToolCall("b1", "needle inside tool args"),
        assistantMessage("a1", "a needle and another needle"),
      ],
      "needle",
    );
    expect(matches).toEqual([
      { itemId: "u1", occurrenceIndex: 0 },
      { itemId: "a1", occurrenceIndex: 0 },
      { itemId: "a1", occurrenceIndex: 1 },
    ]);
  });
});
