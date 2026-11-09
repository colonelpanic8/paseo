import { expect, test } from "vitest";
import { collectAgentMessageActivity } from "./message-activity.js";

test("live agents with missing message activity preserve persisted user-message timestamps", () => {
  const lastUserMessageAt = "2026-09-09T10:00:00.000Z";
  const result = collectAgentMessageActivity([
    { id: "agent", lastMessageAt: null, lastUserMessageAt },
    { id: "agent", lastMessageAt: null, lastUserMessageAt: null },
  ]);
  expect([...result]).toEqual([["agent", lastUserMessageAt]]);
});

test("the newest actual message wins across persisted and live state", () => {
  const result = collectAgentMessageActivity([
    {
      id: "prompt",
      lastMessageAt: "2026-09-08T10:00:00.000Z",
      lastUserMessageAt: "2026-09-09T10:00:00.000Z",
    },
    {
      id: "prompt",
      lastMessageAt: new Date("2026-09-08T10:00:00.000Z"),
      lastUserMessageAt: new Date("2026-09-09T10:00:00.000Z"),
    },
    { id: "reply", lastMessageAt: null, lastUserMessageAt: "2026-09-09T10:00:00.000Z" },
    {
      id: "reply",
      lastMessageAt: new Date("2026-09-09T10:05:00.000Z"),
      lastUserMessageAt: new Date("2026-09-09T10:00:00.000Z"),
    },
  ]);
  expect([...result]).toEqual([
    ["prompt", "2026-09-09T10:00:00.000Z"],
    ["reply", "2026-09-09T10:05:00.000Z"],
  ]);
});

test("agents without messages have no activity timestamp", () => {
  expect([...collectAgentMessageActivity([{ id: "empty", lastMessageAt: null }])]).toEqual([]);
});
