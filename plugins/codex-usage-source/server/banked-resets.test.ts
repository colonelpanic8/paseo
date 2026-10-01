import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fetchUsage } from "./usage.js";
import { consumeBankedReset } from "./banked-resets.js";

let home: string;
beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "codex-resets-"));
  vi.stubEnv("CODEX_HOME", home);
  await writeFile(
    join(home, "auth.json"),
    JSON.stringify({
      tokens: { access_token: "test-token", account_id: "test-account" },
    }),
  );
});
afterEach(async () => {
  vi.unstubAllEnvs();
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
  const usage = await fetchUsage({}, fetchApi);
  expect(usage.bankedResets).toEqual({
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
        { usageInput: {}, creditId: "reset-1", idempotencyKey: "attempt-1" },
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

test("detail failures preserve the reset count and quota windows", async () => {
  const fetchApi = vi.fn<typeof fetch>(async (url) => {
    if (url.toString().endsWith("/usage")) {
      return Response.json({
        rate_limit: { primary_window: { used_percent: 42 } },
        rate_limit_reset_credits: { available_count: 2 },
      });
    }
    return new Response("unavailable", { status: 503 });
  });
  const usage = await fetchUsage({}, fetchApi);
  expect(usage.status).toBe("available");
  expect(usage.windows[0].usedPct).toBe(42);
  expect(usage.bankedResets).toEqual({
    availableCount: 2,
    credits: null,
    error: "Could not load banked reset details. Refresh usage to try again.",
  });
});

test("consume failure is surfaced without a second POST", async () => {
  const fetchApi = vi.fn<typeof fetch>(async () => new Response("unavailable", { status: 503 }));
  await expect(
    consumeBankedReset(
      { usageInput: {}, creditId: "reset-1", idempotencyKey: "attempt-1" },
      fetchApi,
    ),
  ).rejects.toThrow("Codex banked reset API returned 503");
  expect(fetchApi).toHaveBeenCalledTimes(1);
});

test("invalid reset details propagate the schema error", async () => {
  const fetchApi: typeof fetch = async (url) => {
    if (url.toString().endsWith("/usage")) {
      return Response.json({ rate_limit_reset_credits: { available_count: 1 } });
    }
    return Response.json({ available_count: 1, credits: "invalid" });
  };
  await expect(fetchUsage({}, fetchApi)).rejects.toThrow("Invalid input: expected array");
});

test.each([
  new TypeError("fetch failed"),
  new DOMException("Request timed out", "TimeoutError"),
  new DOMException("Request aborted", "AbortError"),
])("expected reset transport failures preserve quota: %s", async (error) => {
  const fetchApi: typeof fetch = async (url) => {
    if (url.toString().endsWith("/usage")) {
      return Response.json({
        rate_limit: { primary_window: { used_percent: 75 } },
        rate_limit_reset_credits: { available_count: 1 },
      });
    }
    throw error;
  };
  const usage = await fetchUsage({}, fetchApi);
  expect(usage.windows[0].usedPct).toBe(75);
  expect(usage.bankedResets).toEqual({
    availableCount: 1,
    credits: null,
    error: "Could not load banked reset details. Refresh usage to try again.",
  });
});

test("redemption uses the selected account and never falls back to default credentials", async () => {
  const accountHome = await mkdtemp(join(tmpdir(), "codex-reset-account-"));
  try {
    await writeFile(
      join(accountHome, "auth.json"),
      JSON.stringify({ tokens: { access_token: "work-token", account_id: "work-account" } }),
    );
    const fetchApi = vi.fn<typeof fetch>(async () => Response.json({ code: "reset" }));
    await expect(
      consumeBankedReset(
        {
          usageInput: { providerId: "codex-work", label: "Work", codexHome: accountHome },
          creditId: "work-reset",
          idempotencyKey: "work-attempt",
        },
        fetchApi,
      ),
    ).resolves.toBe("reset");
    expect(fetchApi).toHaveBeenCalledWith(
      expect.stringContaining("/consume"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer work-token",
          "ChatGPT-Account-Id": "work-account",
        }),
      }),
    );
    fetchApi.mockClear();
    await expect(
      consumeBankedReset(
        {
          usageInput: { providerId: "codex-unavailable", label: "Unavailable" },
          creditId: "unavailable-reset",
          idempotencyKey: "unavailable-attempt",
        },
        fetchApi,
      ),
    ).rejects.toThrow("Sign in to Codex");
    expect(fetchApi).not.toHaveBeenCalled();
  } finally {
    await rm(accountHome, { recursive: true, force: true });
  }
});
