import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { CodexUsageInput } from "../shared/input.js";
import { fetchUsage } from "./usage.js";
import { consumeBankedReset } from "./banked-resets.js";

let home: string;
let codexLogin: CodexUsageInput;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "codex-resets-"));
  codexLogin = { route: { store: "codex", path: join(home, "auth.json") } };
  await writeFile(
    join(home, "auth.json"),
    JSON.stringify({
      tokens: { access_token: "test-token", account_id: "test-account" },
    }),
  );
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

test("loads banked reset details alongside usage", async () => {
  const fetchApi = vi.fn<typeof fetch>(async (url) => {
    if (url.toString().endsWith("/usage")) {
      return Response.json({ rate_limit_reset_credits: { available_count: 1 } });
    }
    return Response.json({
      available_count: 1,
      credits: [
        {
          id: "reset-1",
          reset_type: "codex_rate_limits",
          status: "available",
          granted_at: "2026-09-01T00:00:00Z",
          expires_at: "2026-10-01T00:00:00Z",
          title: "Referral reward",
          description: null,
        },
      ],
    });
  });
  const usage = await fetchUsage(codexLogin, fetchApi);
  expect(usage).toMatchObject({
    status: "available",
    bankedResets: {
      availableCount: 1,
      error: null,
      credits: [
        {
          id: "reset-1",
          resetType: "codex_rate_limits",
          supportedByPlan: null,
          status: "available",
          grantedAt: "2026-09-01T00:00:00Z",
          expiresAt: "2026-10-01T00:00:00Z",
          title: "Referral reward",
          description: null,
        },
      ],
    },
  });
  expect(fetchApi).toHaveBeenLastCalledWith(
    "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits",
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer test-token",
        "ChatGPT-Account-Id": "test-account",
      }),
    }),
  );
});

test.each(["reset", "nothing_to_reset", "no_credit", "already_redeemed"])(
  "redeems a selected reset and returns %s without retrying",
  async (code) => {
    const fetchApi = vi.fn<typeof fetch>(async () => Response.json({ code }));
    await expect(
      consumeBankedReset(
        { usageInputs: [codexLogin], creditId: "reset-1", idempotencyKey: "attempt-1" },
        fetchApi,
      ),
    ).resolves.toBe(code);
    expect(fetchApi).toHaveBeenCalledTimes(1);
    expect(fetchApi).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ credit_id: "reset-1", redeem_request_id: "attempt-1" }),
      }),
    );
  },
);

test("redemption skips missing and expired logins without sending them", async () => {
  const piPath = join(home, "pi-auth.json");
  await writeFile(
    piPath,
    JSON.stringify({ "openai-codex": { type: "oauth", access: "expired-token", expires: 500 } }),
  );
  const fetchApi = vi.fn<typeof fetch>(async () => Response.json({ code: "reset" }));
  await consumeBankedReset(
    {
      usageInputs: [
        { route: { store: "codex", path: join(home, "missing.json") } },
        { route: { store: "pi", path: piPath } },
        codexLogin,
      ],
      creditId: "reset-1",
      idempotencyKey: "attempt-1",
    },
    fetchApi,
    { now: () => 1000 },
  );
  expect(fetchApi).toHaveBeenCalledTimes(1);
  expect(new Headers(fetchApi.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
    "Bearer test-token",
  );
});

test("detail failures preserve the reset count and quota windows", async () => {
  const fetchApi = vi.fn<typeof fetch>(async (url) => {
    if (url.toString().endsWith("/usage")) {
      return Response.json({
        rate_limit: { primary_window: { used_percent: 42, limit_window_seconds: 18000 } },
        rate_limit_reset_credits: { available_count: 2 },
      });
    }
    return new Response("unavailable", { status: 503 });
  });
  const usage = await fetchUsage(codexLogin, fetchApi);
  expect(usage).toMatchObject({
    status: "available",
    windows: [{ usedPct: 42 }],
    bankedResets: {
      availableCount: 2,
      credits: null,
      error: "Could not load banked reset details. Refresh usage to try again.",
    },
  });
});

test("consume failure is surfaced without a second POST", async () => {
  const fetchApi = vi.fn<typeof fetch>(async () => new Response("unavailable", { status: 503 }));
  await expect(
    consumeBankedReset(
      { usageInputs: [codexLogin], creditId: "reset-1", idempotencyKey: "attempt-1" },
      fetchApi,
    ),
  ).rejects.toThrow("Codex banked reset API returned 503");
  expect(fetchApi).toHaveBeenCalledTimes(1);
});

test.each([
  new TypeError("Unexpected reset adapter defect"),
  new SyntaxError("Invalid reset response JSON"),
])("unexpected reset detail errors propagate: %s", async (error) => {
  const fetchApi: typeof fetch = async (url) => {
    if (url.toString().endsWith("/usage")) {
      return Response.json({ rate_limit_reset_credits: { available_count: 1 } });
    }
    throw error;
  };
  await expect(fetchUsage(codexLogin, fetchApi)).rejects.toBe(error);
});

test("invalid reset details propagate the schema error", async () => {
  const fetchApi: typeof fetch = async (url) => {
    if (url.toString().endsWith("/usage")) {
      return Response.json({ rate_limit_reset_credits: { available_count: 1 } });
    }
    return Response.json({ available_count: 1, credits: "invalid" });
  };
  await expect(fetchUsage(codexLogin, fetchApi)).rejects.toThrow("Invalid input: expected array");
});

test.each([
  new TypeError("fetch failed"),
  new DOMException("Request timed out", "TimeoutError"),
  new DOMException("Request aborted", "AbortError"),
])("expected reset transport failures preserve quota: %s", async (error) => {
  const fetchApi: typeof fetch = async (url) => {
    if (url.toString().endsWith("/usage")) {
      return Response.json({
        rate_limit: { primary_window: { used_percent: 75, limit_window_seconds: 18000 } },
        rate_limit_reset_credits: { available_count: 1 },
      });
    }
    throw error;
  };
  expect(await fetchUsage(codexLogin, fetchApi)).toMatchObject({
    status: "available",
    windows: [{ usedPct: 75 }],
    bankedResets: {
      availableCount: 1,
      credits: null,
      error: "Could not load banked reset details. Refresh usage to try again.",
    },
  });
});
