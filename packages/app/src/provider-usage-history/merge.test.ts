import { describe, expect, it } from "vitest";
import { mergeProviderUsageHistory, type ProviderUsageHistoryHostInput } from "./merge";
import type {
  ProviderUsageHistoryBucket,
  ProviderUsageHistoryPayload,
  ProviderUsageHistorySource,
} from "./types";

interface BucketOverrides {
  day?: string;
  provider: string;
  providerId?: string;
  model?: string;
  outputTokens?: number;
  costUsd?: number;
  records?: number;
}

function bucket(overrides: BucketOverrides): ProviderUsageHistoryBucket {
  return {
    day: overrides.day ?? "2026-09-06",
    provider: overrides.provider,
    ...(overrides.providerId === undefined ? {} : { providerId: overrides.providerId }),
    model: overrides.model ?? "gpt-5",
    totals: {
      uncachedInputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: overrides.outputTokens ?? 0,
      reasoningTokens: 0,
    },
    costUsd: overrides.costUsd ?? 0,
    cacheSavingsUsd: 0,
    costSource: "modelPriced",
    records: overrides.records ?? 1,
    unpricedRecords: 0,
    sessions: 1,
  };
}

interface SourceOverrides {
  provider: string;
  providerId?: string;
  label?: string;
  path?: string;
  distinctSessions?: number;
  /** Omitted the way a daemon that predates the fingerprint omits it. */
  hostId?: string;
  volumeId?: string;
  status?: ProviderUsageHistorySource["status"];
}

function source(overrides: SourceOverrides): ProviderUsageHistorySource {
  return {
    provider: overrides.provider,
    ...(overrides.providerId === undefined ? {} : { providerId: overrides.providerId }),
    ...(overrides.label === undefined ? {} : { label: overrides.label }),
    path: overrides.path ?? `/home/dev/.${overrides.provider}`,
    ...(overrides.hostId === undefined ? {} : { hostId: overrides.hostId }),
    ...(overrides.volumeId === undefined ? {} : { volumeId: overrides.volumeId }),
    status: overrides.status ?? "ok",
    scannedFiles: 3,
    skippedFiles: 0,
    distinctSessions: overrides.distinctSessions ?? 1,
    message: null,
  };
}

function payload(
  buckets: ProviderUsageHistoryBucket[],
  sources: ProviderUsageHistorySource[],
): ProviderUsageHistoryPayload {
  return {
    requestId: "req-1",
    readAt: "2026-09-07T12:00:00.000Z",
    timeZone: "America/New_York",
    sinceDay: "2026-09-05",
    untilDay: "2026-09-07",
    buckets,
    sources,
    pricing: {
      status: "cached",
      source: "litellm",
      fetchedAt: "2026-09-07T11:00:00.000Z",
      knownModels: 400,
    },
    scanDurationMs: 120,
  };
}

function ready(
  serverId: string,
  hostName: string,
  input: ProviderUsageHistoryPayload,
): ProviderUsageHistoryHostInput {
  return { serverId, hostName, status: "ready", payload: input };
}

/** Two hosts that both see `/home/dev/.codex` on the same machine. */
const SHARED_HOME = { hostId: "ryzen-shine", volumeId: "66306:12345", path: "/home/dev/.codex" };

describe("mergeProviderUsageHistory", () => {
  it("sums activity, sessions and days across hosts", () => {
    const report = mergeProviderUsageHistory([
      ready(
        "host-a",
        "ryzen-shine",
        payload(
          [bucket({ provider: "codex", outputTokens: 1_000, costUsd: 3 })],
          [source({ provider: "codex", distinctSessions: 2 })],
        ),
      ),
      ready(
        "host-b",
        "jimi-hendnix",
        payload(
          [bucket({ day: "2026-09-07", provider: "claude", outputTokens: 500, costUsd: 1 })],
          [source({ provider: "claude", distinctSessions: 3 })],
        ),
      ),
    ]);

    expect(report.costUsd).toBe(4);
    expect(report.totalTokens).toBe(1_500);
    expect(report.sessions).toBe(5);
    expect(report.daily.map((day) => day.day)).toEqual(["2026-09-06", "2026-09-07"]);
    expect(report.providers.map((entry) => entry.provider)).toEqual(["claude", "codex"]);
    expect(report.duplicates).toEqual([]);
  });

  it("counts a directory two hosts both read once, and names the host that lost it", () => {
    const report = mergeProviderUsageHistory([
      ready(
        "host-a",
        "ryzen-shine",
        payload(
          [bucket({ provider: "codex", outputTokens: 1_000, costUsd: 3 })],
          [source({ provider: "codex", distinctSessions: 2, ...SHARED_HOME })],
        ),
      ),
      ready(
        "host-b",
        "second-daemon",
        payload(
          [bucket({ provider: "codex", outputTokens: 1_000, costUsd: 3 })],
          [source({ provider: "codex", distinctSessions: 2, ...SHARED_HOME })],
        ),
      ),
    ]);

    expect(report.costUsd).toBe(3);
    expect(report.totalTokens).toBe(1_000);
    expect(report.sessions).toBe(2);
    expect(report.duplicates).toEqual([
      { hostNames: ["second-daemon"], claimedByHostName: "ryzen-shine" },
    ]);
    // The claim goes to the first host in serverId order. The other contributed
    // nothing after dedupe, so it is named in the coverage line rather than
    // given a zero row of its own.
    expect(report.hosts.map((entry) => entry.name)).toEqual(["ryzen-shine"]);
  });

  it("summarizes every host that lost a source under the one host that claimed it", () => {
    const shared = (provider: string, path: string) =>
      source({ provider, path, hostId: "ryzen-shine", volumeId: "66306:12345" });
    const both = payload(
      [
        bucket({ provider: "codex", outputTokens: 1_000, costUsd: 3 }),
        bucket({ provider: "claude", outputTokens: 500, costUsd: 1 }),
      ],
      [shared("codex", "/home/dev/.codex"), shared("claude", "/home/dev/.claude")],
    );
    const report = mergeProviderUsageHistory([
      ready("host-a", "ryzen-shine", both),
      ready("host-b", "ryzen-b", both),
      ready("host-c", "ryzen-c", both),
    ]);

    // One entry per claimant, not one per dropped directory: the page renders
    // this as a single sentence.
    expect(report.duplicates).toEqual([
      { hostNames: ["ryzen-b", "ryzen-c"], claimedByHostName: "ryzen-shine" },
    ]);
    expect(report.costUsd).toBe(4);
    expect(report.hosts.map((entry) => entry.name)).toEqual(["ryzen-shine"]);
  });

  it("counts a source with no fingerprint twice, because nothing proves it is the same one", () => {
    const withoutVolume = payload(
      [bucket({ provider: "codex", outputTokens: 1_000, costUsd: 3 })],
      [source({ provider: "codex", distinctSessions: 2, hostId: "ryzen-shine", volumeId: "" })],
    );
    const report = mergeProviderUsageHistory([
      ready("host-a", "ryzen-shine", withoutVolume),
      ready("host-b", "second-daemon", withoutVolume),
    ]);

    expect(report.costUsd).toBe(6);
    expect(report.totalTokens).toBe(2_000);
    expect(report.sessions).toBe(4);
    expect(report.duplicates).toEqual([]);
  });

  it("leaves a host that has not answered out of the totals without blanking the ones that did", () => {
    const report = mergeProviderUsageHistory([
      ready(
        "host-a",
        "ryzen-shine",
        payload(
          [bucket({ provider: "codex", outputTokens: 1_000, costUsd: 3 })],
          [source({ provider: "codex", distinctSessions: 2 })],
        ),
      ),
      { serverId: "host-b", hostName: "jimi-hendnix", status: "pending" },
      { serverId: "host-c", hostName: "jay-lenovo", status: "offline" },
    ]);

    expect(report.costUsd).toBe(3);
    expect(report.sessions).toBe(2);
    expect(report.hosts.map((entry) => entry.name)).toEqual(["ryzen-shine"]);
    // One contributor, so the labels stay exactly what that daemon reported.
    expect(report.configuredProviders.map((entry) => [entry.id, entry.label])).toEqual([
      ["codex", "Codex"],
    ]);
  });

  it("reports each host's totals and its share of the whole", () => {
    const report = mergeProviderUsageHistory([
      ready(
        "host-a",
        "ryzen-shine",
        payload(
          [bucket({ provider: "codex", outputTokens: 3_000, costUsd: 3 })],
          [source({ provider: "codex", distinctSessions: 2 })],
        ),
      ),
      ready(
        "host-b",
        "jimi-hendnix",
        payload(
          [bucket({ provider: "codex", outputTokens: 1_000, costUsd: 1 })],
          [source({ provider: "codex", distinctSessions: 5 })],
        ),
      ),
    ]);

    expect(
      report.hosts.map((entry) => [entry.name, entry.costUsd, entry.totalTokens, entry.sessions]),
    ).toEqual([
      ["ryzen-shine", 3, 3_000, 2],
      ["jimi-hendnix", 1, 1_000, 5],
    ]);
    expect(report.hosts[0]?.costShare).toBeCloseTo(3 / 4);
    expect(report.hosts[1]?.tokenShare).toBeCloseTo(1_000 / 4_000);
  });

  it("keeps two hosts' identically named providers apart and says which host each is", () => {
    const codexHome = (hostId: string) =>
      source({
        provider: "codex",
        providerId: "codex-colonel",
        label: "Codex (Colonel)",
        distinctSessions: 1,
        hostId,
        volumeId: "66306:1",
      });
    const report = mergeProviderUsageHistory([
      ready(
        "host-a",
        "ryzen-shine",
        payload(
          [
            bucket({
              provider: "codex",
              providerId: "codex-colonel",
              outputTokens: 3_000,
              costUsd: 3,
            }),
          ],
          [codexHome("ryzen-shine")],
        ),
      ),
      ready(
        "host-b",
        "mac-demarco-mini",
        payload(
          [
            bucket({
              provider: "codex",
              providerId: "codex-colonel",
              outputTokens: 1_000,
              costUsd: 1,
            }),
          ],
          [codexHome("mac-demarco-mini")],
        ),
      ),
    ]);

    expect(
      report.configuredProviders.map((entry) => [entry.id, entry.label, entry.costUsd]),
    ).toEqual([
      ["host-a:codex-colonel", "Codex (Colonel) · ryzen-shine", 3],
      ["host-b:codex-colonel", "Codex (Colonel) · mac-demarco-mini", 1],
    ]);
    // The kind still rolls them up: one Codex row worth both hosts.
    expect(report.providers.map((entry) => [entry.provider, entry.costUsd])).toEqual([
      ["codex", 4],
    ]);
  });
});
