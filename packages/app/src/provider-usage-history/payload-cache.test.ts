/**
 * @vitest-environment jsdom
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, it } from "vitest";
import { readCachedUsageHistory, writeCachedUsageHistory } from "./payload-cache";
import type { ProviderUsageHistoryPayload } from "./types";
import type { ProviderUsageHistoryWindow } from "./window";

const WINDOW: ProviderUsageHistoryWindow = {
  timeZone: "America/Los_Angeles",
  sinceDay: "2026-08-19",
  untilDay: "2026-09-16",
};

function payload(costUsd: number, untilDay = WINDOW.untilDay): ProviderUsageHistoryPayload {
  return {
    requestId: "req-1",
    readAt: "2026-09-16T12:00:00.000Z",
    timeZone: WINDOW.timeZone,
    sinceDay: WINDOW.sinceDay,
    untilDay,
    buckets: [
      {
        day: untilDay,
        provider: "codex",
        model: "gpt-5",
        totals: {
          uncachedInputTokens: 1,
          cachedInputTokens: 2,
          cacheCreationTokens: 3,
          outputTokens: 4,
          reasoningTokens: 0,
        },
        costUsd,
        cacheSavingsUsd: 0,
        costSource: "modelPriced",
        records: 1,
        unpricedRecords: 0,
        sessions: 1,
      },
    ],
    sources: [],
    pricing: { status: "cached", source: "litellm", fetchedAt: null, knownModels: 400 },
    scanDurationMs: 10,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("usage history payload cache", () => {
  it("returns the payload the host last reported for that window", async () => {
    await writeCachedUsageHistory("host-a", WINDOW, payload(3));

    expect(await readCachedUsageHistory("host-a", WINDOW)).toEqual(payload(3));
    expect(await readCachedUsageHistory("host-b", WINDOW)).toBeNull();
    expect(
      await readCachedUsageHistory("host-a", { ...WINDOW, sinceDay: "2026-09-10" }),
    ).toBeNull();
    expect(await readCachedUsageHistory("host-a", { ...WINDOW, timeZone: "UTC" })).toBeNull();
  });

  it("drops windows that ended before the one being written, since nothing asks for them again", async () => {
    const yesterday: ProviderUsageHistoryWindow = { ...WINDOW, untilDay: "2026-09-15" };
    await writeCachedUsageHistory("host-a", yesterday, payload(3, "2026-09-15"));
    expect(await readCachedUsageHistory("host-a", yesterday)).not.toBeNull();

    await writeCachedUsageHistory("host-a", WINDOW, payload(5));

    expect(await readCachedUsageHistory("host-a", yesterday)).toBeNull();
    expect(await readCachedUsageHistory("host-a", WINDOW)).toEqual(payload(5));
  });

  it("reads a corrupt entry as a miss", async () => {
    await writeCachedUsageHistory("host-a", WINDOW, payload(3));
    const key = (await AsyncStorage.getAllKeys()).find((candidate) =>
      candidate.startsWith("@paseo/usage-history/"),
    );
    if (key === undefined) throw new Error("expected a cached entry to corrupt");
    await AsyncStorage.setItem(key, '{"payload":{"buckets":');

    expect(await readCachedUsageHistory("host-a", WINDOW)).toBeNull();
  });
});
