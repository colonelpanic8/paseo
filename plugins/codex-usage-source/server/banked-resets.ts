import { z } from "zod";
import type { CodexBankedResets, CodexBankedResetOutcome } from "@getpaseo/protocol/messages";
import type { CodexUsageInput } from "../shared/input.js";
import { readAuth } from "./usage.js";
const CodexResetCreditsResponseSchema = z.object({
  available_count: z.number().int().nonnegative(),
  credits: z.array(
    z.object({
      id: z.string().min(1),
      reset_type: z.string(),
      is_supported_by_plan: z.boolean().nullish(),
      status: z.string(),
      granted_at: z.iso.datetime({ offset: true }),
      expires_at: z.iso.datetime({ offset: true }).nullish(),
      title: z.string().nullish(),
      description: z.string().nullish(),
    }),
  ),
});

const CodexResetConsumeResponseSchema = z.object({
  code: z.enum(["reset", "nothing_to_reset", "no_credit", "already_redeemed"]),
});

class CodexResetApiError extends Error {}

export async function consumeBankedReset(
  input: { usageInput: CodexUsageInput; creditId: string; idempotencyKey: string },
  fetchApi: typeof fetch = fetch,
): Promise<CodexBankedResetOutcome> {
  const auth = await readAuth(input.usageInput);
  if (!auth) throw new CodexResetApiError("Sign in to Codex on this host to use a banked reset.");
  const response = await callResetApi(
    {
      token: auth.token,
      accountId: auth.accountId,
      body: JSON.stringify({ credit_id: input.creditId, redeem_request_id: input.idempotencyKey }),
    },
    fetchApi,
  );
  return CodexResetConsumeResponseSchema.parse(response).code;
}
export async function fetchBankedResets(
  input: {
    token: string;
    accountId: string | undefined;
    availableCount: number;
  },
  fetchApi: typeof fetch = fetch,
): Promise<CodexBankedResets> {
  try {
    const response = await callResetApi(input, fetchApi);
    const parsed = CodexResetCreditsResponseSchema.parse(response);
    return {
      availableCount: parsed.available_count,
      credits: parsed.credits.map((credit) => ({
        id: credit.id,
        resetType: credit.reset_type,
        supportedByPlan: credit.is_supported_by_plan ?? null,
        status: credit.status,
        grantedAt: credit.granted_at,
        expiresAt: credit.expires_at ?? null,
        title: credit.title ?? null,
        description: credit.description ?? null,
      })),
      error: null,
    };
  } catch (error) {
    if (!(error instanceof CodexResetApiError)) throw error;
    // Reset details must not hide otherwise usable quota data.
    return {
      availableCount: input.availableCount,
      credits: null,
      error: "Could not load banked reset details. Refresh usage to try again.",
    };
  }
}

async function callResetApi(
  input: {
    token: string;
    accountId: string | undefined;
    body?: string;
  },
  fetchApi: typeof fetch,
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.token}`,
    Accept: "application/json",
  };
  if (input.accountId) headers["ChatGPT-Account-Id"] = input.accountId;
  const isConsume = input.body !== undefined;
  if (isConsume) headers["Content-Type"] = "application/json";
  const suffix = isConsume ? "/consume" : "";
  const response = await fetchApi(
    `https://chatgpt.com/backend-api/wham/rate-limit-reset-credits${suffix}`,
    {
      signal: AbortSignal.timeout(15_000),
      method: isConsume ? "POST" : "GET",
      headers,
      body: input.body,
    },
  ).catch((error: unknown) => {
    if (
      (error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError")) ||
      (error instanceof TypeError && error.message === "fetch failed")
    ) {
      throw new CodexResetApiError("Codex request failed. Refresh usage before retrying.", {
        cause: error,
      });
    }
    throw error;
  });
  if (response.status === 401 || response.status === 403) {
    throw new CodexResetApiError("Sign in to Codex on this host to manage banked resets.");
  }
  if (!response.ok) {
    throw new CodexResetApiError(
      `Codex banked reset API returned ${response.status}. Refresh usage before retrying.`,
    );
  }
  return response.json();
}
