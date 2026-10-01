import pino from "pino";
import { expect, it, test, vi } from "vitest";
import type { SessionOutboundMessage } from "../../messages.js";
import { UsageSession } from "./usage-session.js";

test("lists reports from usage sources", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const requested: Array<{ forceRefresh?: boolean; reportIds?: string[] }> = [];
  const entry = {
    id: "fixture:one",
    account: {},
    fetchedAt: "2026-01-01T00:00:00.000Z",
    sourceId: "fixture",
    sourceLabel: "Fixture",
    report: { status: "available" as const, windows: [] },
  };
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    runtime: {
      async listUsageReports(options) {
        requested.push(options);
        return [entry];
      },
      async listLegacyUsage() {
        return { fetchedAt: "2026-01-01T00:00:00.000Z", providers: [] };
      },
    },
    logger: pino({ level: "silent" }),
  });

  await usage.handleListReports({ type: "usage.list_reports.request", requestId: "list" });
  expect(requested).toEqual([{ forceRefresh: undefined, reportIds: undefined }]);
  expect(emitted).toEqual([
    { type: "usage.list_reports.response", payload: { requestId: "list", reports: [entry] } },
  ]);
});

test("surfaces a legacy usage-list failure as an rpc_error envelope", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    emit: (message) => emitted.push(message),
    runtime: {
      async listUsageReports() {
        return [];
      },
      async listLegacyUsage(): Promise<never> {
        throw new Error("quota service down");
      },
    },
    logger: pino({ level: "silent" }),
  });
  await usage.handleLegacyList({ type: "provider.usage.list.request", requestId: "u1" });
  expect(emitted[0]).toMatchObject({
    type: "rpc_error",
    payload: { requestId: "u1", code: "provider_usage_list_failed" },
  });
});

function makeResetSubsystem(options: {
  usage: {
    consumeCodexBankedReset: NonNullable<
      NonNullable<
        ConstructorParameters<typeof UsageSession>[0]["runtime"]
      >["consumeCodexBankedReset"]
    >;
  };
}) {
  const emitted: SessionOutboundMessage[] = [];
  const runtime = {
    listUsageReports: async () => [],
    listLegacyUsage: async () => ({ fetchedAt: "now", providers: [] }),
    ...options.usage,
  };
  return {
    emitted,
    subsystem: new UsageSession({
      emit: (message) => emitted.push(message),
      runtime,
      logger: pino({ level: "silent" }),
    }),
  };
}
it("returns a correlated error when banked reset redemption fails", async () => {
  const { subsystem, emitted } = makeResetSubsystem({
    usage: {
      consumeCodexBankedReset: async () => {
        throw new Error("Request timed out");
      },
    },
  });
  await subsystem.handleCodexBankedResetConsumeRequest({
    type: "provider.codex.consume_banked_reset.request",
    requestId: "request-1",
    creditId: "reset-1",
    idempotencyKey: "attempt-1",
  });
  expect(emitted).toEqual([
    {
      type: "rpc_error",
      payload: {
        requestId: "request-1",
        requestType: "provider.codex.consume_banked_reset.request",
        error: "Could not use banked reset: Request timed out",
        code: "codex_banked_reset_failed",
      },
    },
  ]);
});
it("forwards banked reset redemption and correlates the outcome", async () => {
  const consumeCodexBankedReset = vi.fn(async () => "nothing_to_reset" as const);
  const { subsystem, emitted } = makeResetSubsystem({ usage: { consumeCodexBankedReset } });
  await subsystem.handleCodexBankedResetConsumeRequest({
    type: "provider.codex.consume_banked_reset.request",
    requestId: "request-1",
    reportId: "codex:work",
    creditId: "reset-1",
    idempotencyKey: "attempt-1",
  });
  expect(consumeCodexBankedReset).toHaveBeenCalledWith({
    reportId: "codex:work",
    creditId: "reset-1",
    idempotencyKey: "attempt-1",
  });
  expect(emitted).toEqual([
    {
      type: "provider.codex.consume_banked_reset.response",
      payload: { requestId: "request-1", outcome: "nothing_to_reset" },
    },
  ]);
});

test("forwards a legacy forced refresh to the usage registry", async () => {
  const listLegacyUsage = vi.fn(async () => ({ fetchedAt: "now", providers: [] }));
  const usage = new UsageSession({
    emit: () => {},
    runtime: { listLegacyUsage, listUsageReports: async () => [] },
    logger: pino({ level: "silent" }),
  });
  await usage.handleLegacyList({
    type: "provider.usage.list.request",
    requestId: "refresh",
    forceRefresh: true,
  });
  expect(listLegacyUsage).toHaveBeenCalledWith({ forceRefresh: true });
});
