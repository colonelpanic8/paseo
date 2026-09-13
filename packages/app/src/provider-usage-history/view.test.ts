import { describe, expect, it } from "vitest";
import type { ProviderUsageHistoryHostInput } from "./merge";
import type { ProviderUsageHistoryPayload } from "./types";
import { usageHistoryView } from "./view";

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

function host(
  serverId: string,
  status: ProviderUsageHistoryHostInput["status"],
): ProviderUsageHistoryHostInput {
  return {
    serverId,
    hostName: serverId,
    status,
    ...(status === "ready" ? { payload } : {}),
  };
}

describe("usageHistoryView", () => {
  it("asks for a host before anything else", () => {
    expect(usageHistoryView({ hosts: [], isFetching: false })).toEqual({ kind: "noHosts" });
  });

  it("renders as soon as one host answers, however the others are doing", () => {
    for (const other of ["pending", "offline", "unsupported", "error"] as const) {
      expect(
        usageHistoryView({ hosts: [host("a", "ready"), host("b", other)], isFetching: false }),
      ).toEqual({ kind: "ready", isRefreshing: false });
    }
  });

  it("keeps the placeholder while a host is still scanning", () => {
    expect(
      usageHistoryView({ hosts: [host("a", "pending"), host("b", "offline")], isFetching: true }),
    ).toEqual({ kind: "loading" });
  });

  it("reports a refresh over data that is already on screen", () => {
    expect(usageHistoryView({ hosts: [host("a", "ready")], isFetching: true })).toEqual({
      kind: "ready",
      isRefreshing: true,
    });
  });

  it("names the reason when no host can answer, and generalizes a mixed one", () => {
    expect(usageHistoryView({ hosts: [host("a", "error")], isFetching: false })).toEqual({
      kind: "error",
    });
    expect(usageHistoryView({ hosts: [host("a", "unsupported")], isFetching: false })).toEqual({
      kind: "unavailable",
      messageKey: "settings.usageHistory.unsupported",
    });
    expect(usageHistoryView({ hosts: [host("a", "offline")], isFetching: false })).toEqual({
      kind: "unavailable",
      messageKey: "settings.usageHistory.hostUnavailable",
    });
    expect(
      usageHistoryView({ hosts: [host("a", "offline"), host("b", "error")], isFetching: false }),
    ).toEqual({ kind: "unavailable", messageKey: "settings.usageHistory.hostsUnavailable" });
  });
});
