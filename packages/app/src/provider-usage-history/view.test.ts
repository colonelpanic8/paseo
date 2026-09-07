import { describe, expect, it } from "vitest";
import { usageHistoryView, type UsageHistoryViewInput } from "./view";
import type { ProviderUsageHistoryPayload } from "./types";

const payload: ProviderUsageHistoryPayload = {
  requestId: "req-1",
  readAt: "2026-09-07T12:00:00Z",
  timeZone: "UTC",
  sinceDay: "2026-09-01",
  untilDay: "2026-09-07",
  buckets: [],
  sources: [],
  pricing: { status: "unavailable", source: "litellm", fetchedAt: null, knownModels: 0 },
  scanDurationMs: 0,
};
const connected: UsageHistoryViewInput = {
  isConnected: true,
  isSupported: true,
  isError: false,
  isFetching: false,
  payload: undefined,
};

describe("usageHistoryView", () => {
  it("asks for a host connection before showing cached data or capability state", () => {
    expect(
      usageHistoryView({ ...connected, isConnected: false, isSupported: false, payload }),
    ).toEqual({ kind: "error", messageKey: "settings.usageHistory.hostUnavailable" });
  });
  it("asks for an update when the connected host lacks the feature", () => {
    expect(usageHistoryView({ ...connected, isSupported: false, payload })).toEqual({
      kind: "unsupported",
    });
  });
  it("distinguishes loading, an empty report, and a refresh with existing data", () => {
    expect(usageHistoryView(connected)).toEqual({ kind: "loading" });
    expect(usageHistoryView({ ...connected, payload })).toEqual({
      kind: "ready",
      payload,
      isRefreshing: false,
    });
    expect(usageHistoryView({ ...connected, payload, isFetching: true })).toEqual({
      kind: "ready",
      payload,
      isRefreshing: true,
    });
  });
  it("shows localized remediation for both initial and refresh errors", () => {
    for (const data of [undefined, payload]) {
      expect(usageHistoryView({ ...connected, payload: data, isError: true })).toEqual({
        kind: "error",
        messageKey: "settings.usageHistory.readFailed",
      });
    }
  });
});
