/**
 * @vitest-environment jsdom
 */
import { i18n as testI18n } from "@/i18n/i18next";
import React, { type ReactElement } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
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
  /** Where the host is reached, the way the runtime formats it for display. */
  endpoint?: string;
  payload?: ProviderUsageHistoryPayload;
  /** How many times the page asked this host for usage. */
  reads?: number;
}

const runtime = vi.hoisted(() => ({ hosts: [] as unknown[], isCompact: false }));
const derivations = vi.hoisted(() => ({ merges: 0 }));

vi.mock("./merge", async (importOriginal) => {
  const original = await importOriginal<typeof import("./merge")>();
  return {
    ...original,
    mergeProviderUsageHistory: (
      ...args: Parameters<typeof original.mergeProviderUsageHistory>
    ): ReturnType<typeof original.mergeProviderUsageHistory> => {
      derivations.merges += 1;
      return original.mergeProviderUsageHistory(...args);
    },
  };
});

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
  useHostRuntimeActiveConnectionLabels: (serverIds: readonly string[]) =>
    new Map(
      serverIds.flatMap((serverId) => {
        const endpoint = fakeHosts().find((host) => host.serverId === serverId)?.endpoint;
        return endpoint === undefined ? [] : [[serverId, endpoint] as const];
      }),
    ),
  getHostRuntimeStore: () => ({
    getClient: (serverId: string) => {
      const host = fakeHosts().find((candidate) => candidate.serverId === serverId);
      const hostPayload = host?.payload;
      if (!host || !hostPayload) return null;
      return {
        readProviderUsageHistory: async () => {
          host.reads = (host.reads ?? 0) + 1;
          return hostPayload;
        },
      } as unknown as DaemonClient;
    },
  }),
}));

vi.mock("@/constants/layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/constants/layout")>()),
  useIsCompactFormFactor: () => runtime.isCompact,
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
import { useProviderUsageHistory } from "./use-provider-usage-history";
import { makeWindow } from "./window";

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

function bucket(costUsd: number, unpricedRecords = 0): ProviderUsageHistoryBucket {
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
    unpricedRecords,
    sessions: 1,
  };
}

function payload(
  costUsd: number,
  hostId: string,
  unpricedRecords = 0,
): ProviderUsageHistoryPayload {
  return {
    requestId: "req-1",
    readAt: "2026-09-07T12:00:00.000Z",
    timeZone: "UTC",
    sinceDay: "2026-09-05",
    untilDay: "2026-09-07",
    buckets: [bucket(costUsd, unpricedRecords)],
    sources: [source({ hostId, volumeId: "66306:1" })],
    pricing: { status: "cached", source: "litellm", fetchedAt: null, knownModels: 400 },
    scanDurationMs: 10,
  };
}

function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

interface RenderSectionOptions {
  isCompact?: boolean;
  /** Reused across renders to stand in for the app's long-lived client. */
  queryClient?: QueryClient;
}

function renderSection(hosts: FakeHost[], options: RenderSectionOptions = {}): void {
  runtime.hosts = hosts;
  runtime.isCompact = options.isCompact ?? false;
  const queryClient = options.queryClient ?? newQueryClient();
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
    runtime.isCompact = false;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
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

  it("tells identically named hosts apart by the endpoint each is reached at", async () => {
    renderSection([
      {
        serverId: "host-a",
        label: "ryzen-shine",
        connectionStatus: "online",
        supported: true,
        endpoint: "Local",
        payload: payload(3, "ryzen-shine"),
      },
      {
        serverId: "host-b",
        label: "ryzen-shine",
        connectionStatus: "online",
        supported: true,
        endpoint: "100.64.0.2:6767",
        payload: payload(1, "second-box"),
      },
    ]);

    expect((await screen.findByTestId("usage-history-headline")).textContent).toBe("$4.00");
    expect(screen.getByTestId("usage-history-provider-sub-host-a:codex").textContent).toContain(
      "Codex · ryzen-shine (Local)",
    );
    expect(screen.getByTestId("usage-history-provider-sub-host-b:codex").textContent).toContain(
      "Codex · ryzen-shine (100.64.0.2:6767)",
    );
  });

  it("qualifies a colliding name in the coverage line too", async () => {
    renderSection([
      {
        serverId: "host-a",
        label: "ryzen-shine",
        connectionStatus: "online",
        supported: true,
        endpoint: "Local",
        payload: payload(3, "ryzen-shine"),
      },
      {
        serverId: "host-b",
        label: "ryzen-shine",
        connectionStatus: "offline",
        supported: true,
        endpoint: "100.64.0.2:6767",
      },
    ]);

    await screen.findByTestId("usage-history-headline");
    expect(screen.getByTestId("usage-history-coverage").textContent).toBe(
      "ryzen-shine (100.64.0.2:6767) is offline",
    );
  });

  it("leaves a host that is the only one of its name unqualified", async () => {
    renderSection([
      {
        serverId: "host-a",
        label: "ryzen-shine",
        connectionStatus: "online",
        supported: true,
        endpoint: "Local",
        payload: payload(3, "ryzen-shine"),
      },
      {
        serverId: "host-b",
        label: "jay-lenovo",
        connectionStatus: "offline",
        supported: true,
        endpoint: "100.64.0.2:6767",
      },
    ]);

    await screen.findByTestId("usage-history-headline");
    expect(screen.getByTestId("usage-history-coverage").textContent).toBe("jay-lenovo is offline");
  });

  it("carries the unpriced caveat as one footnote rather than on every figure", async () => {
    renderSection([
      {
        serverId: "host-a",
        label: "ryzen-shine",
        connectionStatus: "online",
        supported: true,
        payload: payload(3, "ryzen-shine", 4),
      },
    ]);

    expect((await screen.findByTestId("usage-history-headline")).textContent).toBe("$3.00");
    expect(screen.getAllByTestId("usage-history-unpriced")).toHaveLength(1);
    expect(screen.getByTestId("usage-history-unpriced").textContent).toBe(
      "Estimate excludes 4 responses with no known price",
    );
  });

  it("keeps the figures and the chart in both the two-column and the stacked layout", async () => {
    const host: FakeHost = {
      serverId: "host-a",
      label: "ryzen-shine",
      connectionStatus: "online",
      supported: true,
      payload: payload(3, "ryzen-shine"),
    };

    renderSection([host]);
    await screen.findByTestId("usage-history-headline");
    expect(screen.getByTestId("usage-history-figures")).toBeDefined();
    expect(screen.getByTestId("usage-history-chart")).toBeDefined();
    cleanup();

    renderSection([host], { isCompact: true });
    await screen.findByTestId("usage-history-headline");
    expect(screen.getByTestId("usage-history-figures")).toBeDefined();
    expect(screen.getByTestId("usage-history-chart")).toBeDefined();
  });

  it("does not ask a host again when the page remounts inside the stale window", async () => {
    const host: FakeHost = {
      serverId: "host-a",
      label: "ryzen-shine",
      connectionStatus: "online",
      supported: true,
      payload: payload(3, "ryzen-shine"),
    };
    const queryClient = newQueryClient();

    renderSection([host], { queryClient });
    expect((await screen.findByTestId("usage-history-headline")).textContent).toBe("$3.00");
    cleanup();

    renderSection([host], { queryClient });
    expect((await screen.findByTestId("usage-history-headline")).textContent).toBe("$3.00");
    expect(host.reads).toBe(1);
  });

  it("switches the metric without deriving the report again", async () => {
    renderSection([
      {
        serverId: "host-a",
        label: "ryzen-shine",
        connectionStatus: "online",
        supported: true,
        payload: payload(3, "ryzen-shine"),
      },
    ]);
    expect((await screen.findByTestId("usage-history-headline")).textContent).toBe("$3.00");
    const mergesAfterLoad = derivations.merges;

    fireEvent.click(screen.getByRole("button", { name: "Tokens" }));
    expect(screen.getByTestId("usage-history-headline").textContent).toBe("1K");
    expect(derivations.merges).toBe(mergesAfterLoad);
  });

  it("rolls the window over at local midnight while the page stays open", () => {
    vi.useFakeTimers();
    const beforeMidnight = new Date(2026, 8, 14, 23, 59, 0, 0);
    vi.setSystemTime(beforeMidnight);
    const queryClient = newQueryClient();
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }

    const { result } = renderHook(() => useProviderUsageHistory([], 30), { wrapper: Wrapper });
    const today = makeWindow(30, beforeMidnight).untilDay;
    expect(result.current.window.untilDay).toBe(today);

    act(() => {
      vi.advanceTimersByTime(2 * 60 * 1000);
    });
    const tomorrow = makeWindow(30, new Date(2026, 8, 15, 0, 1, 0, 0)).untilDay;
    expect(tomorrow).not.toBe(today);
    expect(result.current.window.untilDay).toBe(tomorrow);
  });
});
