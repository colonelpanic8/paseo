/**
 * @vitest-environment jsdom
 */
import { i18n as testI18n } from "@/i18n/i18next";
import React, { type ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProviderUsageHistoryBucket,
  ProviderUsageHistoryPayload,
  ProviderUsageHistorySource,
} from "./types";

void testI18n;

interface FakeHost {
  serverId: string;
  label: string;
  connectionStatus: "online" | "offline";
  supported: boolean;
  payload?: ProviderUsageHistoryPayload;
}

const runtime = vi.hoisted(() => ({ hosts: [] as unknown[] }));

function fakeHosts(): FakeHost[] {
  return runtime.hosts as FakeHost[];
}

vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => fakeHosts().map((host) => ({ serverId: host.serverId, label: host.label })),
  useHostRuntimeConnectionStatuses: (serverIds: readonly string[]) =>
    new Map(
      serverIds.map((serverId) => [
        serverId,
        fakeHosts().find((host) => host.serverId === serverId)?.connectionStatus ?? "offline",
      ]),
    ),
  getHostRuntimeStore: () => ({
    getClient: (serverId: string) => {
      const host = fakeHosts().find((candidate) => candidate.serverId === serverId);
      const hostPayload = host?.payload;
      if (!hostPayload) return null;
      return { readProviderUsageHistory: async () => hostPayload } as unknown as DaemonClient;
    },
  }),
}));

vi.mock("@/runtime/host-features", () => ({
  useHostFeatureMap: (serverIds: readonly string[]) =>
    new Map(
      serverIds.map((serverId) => [
        serverId,
        fakeHosts().find((host) => host.serverId === serverId)?.supported === true,
      ]),
    ),
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

import { ProviderUsageHistorySection } from "./section";

function source(overrides: Partial<ProviderUsageHistorySource> = {}): ProviderUsageHistorySource {
  return {
    provider: "codex",
    path: "/home/dev/.codex",
    status: "ok",
    scannedFiles: 1,
    skippedFiles: 0,
    distinctSessions: 2,
    message: null,
    ...overrides,
  };
}

function bucket(costUsd: number): ProviderUsageHistoryBucket {
  return {
    day: "2026-09-06",
    provider: "codex",
    model: "gpt-5",
    totals: {
      uncachedInputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 1_000,
      reasoningTokens: 0,
    },
    costUsd,
    cacheSavingsUsd: 0,
    costSource: "modelPriced",
    records: 1,
    unpricedRecords: 0,
    sessions: 1,
  };
}

function payload(costUsd: number, hostId: string): ProviderUsageHistoryPayload {
  return {
    requestId: "req-1",
    readAt: "2026-09-07T12:00:00.000Z",
    timeZone: "UTC",
    sinceDay: "2026-09-05",
    untilDay: "2026-09-07",
    buckets: [bucket(costUsd)],
    sources: [source({ hostId, volumeId: "66306:1" })],
    pricing: { status: "cached", source: "litellm", fetchedAt: null, knownModels: 400 },
    scanDurationMs: 10,
  };
}

function renderSection(hosts: FakeHost[]): void {
  runtime.hosts = hosts;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const element: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <ProviderUsageHistorySection />
    </QueryClientProvider>
  );
  render(element);
}

describe("ProviderUsageHistorySection", () => {
  beforeEach(() => {
    vi.stubGlobal("React", React);
    runtime.hosts = [];
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the hosts that answered and names the one that did not", async () => {
    renderSection([
      {
        serverId: "host-a",
        label: "ryzen-shine",
        connectionStatus: "online",
        supported: true,
        payload: payload(3, "ryzen-shine"),
      },
      { serverId: "host-b", label: "jay-lenovo", connectionStatus: "offline", supported: true },
    ]);

    expect((await screen.findByTestId("usage-history-headline")).textContent).toBe("$3.00");
    expect(screen.getByTestId("usage-history-coverage").textContent).toBe("jay-lenovo is offline");
  });

  it("renders one empty card when no selected host is reachable", async () => {
    renderSection([
      { serverId: "host-a", label: "ryzen-shine", connectionStatus: "offline", supported: true },
      { serverId: "host-b", label: "jay-lenovo", connectionStatus: "offline", supported: true },
    ]);

    expect(await screen.findByText("Connect a host to see usage history")).toBeDefined();
    expect(screen.queryByTestId("usage-history-headline")).toBeNull();
  });

  it("offers the Host breakdown only once more than one host contributes", async () => {
    const online = (serverId: string, label: string, cost: number): FakeHost => ({
      serverId,
      label,
      connectionStatus: "online",
      supported: true,
      payload: payload(cost, label),
    });

    renderSection([online("host-a", "ryzen-shine", 3)]);
    await screen.findByTestId("usage-history-headline");
    expect(screen.queryByRole("button", { name: "Host" })).toBeNull();
    cleanup();

    renderSection([online("host-a", "ryzen-shine", 3), online("host-b", "jimi-hendnix", 1)]);
    expect((await screen.findByTestId("usage-history-headline")).textContent).toBe("$4.00");
    expect(screen.getByRole("button", { name: "Host" })).toBeDefined();
  });
});
