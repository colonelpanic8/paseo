import type { Page } from "@playwright/test";
import type { CodexBankedReset, UsageReportEntry } from "@getpaseo/protocol/messages";
import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { getServerId } from "../support/helpers/server-id";
import { openCompactSettings, openSettingsHostSection } from "../support/helpers/settings";
import { installUsageReportsFixture } from "../support/helpers/usage-reports";
import { buildOpenProjectRoute } from "@/utils/host-routes";

const bankedReset: CodexBankedReset = {
  id: "reset-1",
  resetType: "codex_rate_limits",
  supportedByPlan: true,
  status: "available",
  grantedAt: "2026-09-01T00:00:00Z",
  expiresAt: "2099-10-01T00:00:00Z",
  title: "Referral reward",
  description: "One Codex usage reset",
};

function codexUsage(used: boolean, credits?: CodexBankedReset[]): UsageReportEntry[] {
  return [
    {
      id: "codex:default",
      sourceId: "codex",
      sourceLabel: "Codex",
      account: {},
      fetchedAt: "2026-09-06T00:00:00Z",
      report: {
        status: "available",
        planLabel: "Pro",
        windows: [{ id: "weekly", label: "Weekly", usedPct: used ? 0 : 100 }],
        bankedResets: {
          availableCount: used ? 0 : 1,
          error: null,
          credits: credits ?? [{ ...bankedReset, status: used ? "redeemed" : "available" }],
        },
      },
    },
  ];
}

async function openUsageCard(page: Page) {
  await gotoAppShell(page);
  await openSettings(page);
  await openSettingsHostSection(page, getServerId(), "usage");
  return page.getByTestId("usage-report-codex:default");
}

test.describe("banked reset management", () => {
  test.setTimeout(120_000);

  test("confirms, prevents duplicate submissions, and refreshes usage", async ({
    page,
  }, testInfo) => {
    const consumed: string[] = [];
    let consumeSettled = false;
    let finishConsume!: () => void;
    const pendingConsume = new Promise<void>((resolve) => {
      finishConsume = resolve;
    });
    const fixture = await installUsageReportsFixture(page, {
      lists: [() => codexUsage(consumeSettled)],
      consume: async ({ creditId }) => {
        consumed.push(creditId);
        await pendingConsume;
        consumeSettled = true;
        return { outcome: "reset" };
      },
    });
    const card = await openUsageCard(page);
    const useReset = card.getByRole("button", { name: "Use reset", exact: true });
    await expect(card.getByText("1 available", { exact: true })).toBeVisible();
    await expect(card.getByText("Referral reward", { exact: true })).toBeVisible();
    await expect(card.getByText(/Expires.*2099/)).toBeVisible();
    await testInfo.attach("banked-resets-before", {
      body: await card.screenshot({ path: testInfo.outputPath("banked-resets-before.png") }),
      contentType: "image/png",
    });

    page.once("dialog", (dialog) => dialog.dismiss());
    await useReset.click();
    await expect(useReset).toBeEnabled();
    expect(consumed).toEqual([]);

    page.once("dialog", (dialog) => dialog.accept());
    await useReset.click();
    await expect.poll(() => consumed).toEqual(["reset-1"]);
    await expect(useReset).toBeDisabled();
    finishConsume();
    await fixture.waitForListRequests(2);
    await expect(
      card.getByText("Banked reset used. Codex usage limits have been reset."),
    ).toBeVisible();
    await expect(card.getByText("0 available", { exact: true })).toBeVisible();
    await expect(card.getByText("Used", { exact: true })).toBeVisible();
    await testInfo.attach("banked-resets-after", {
      body: await card.screenshot({ path: testInfo.outputPath("banked-resets.png") }),
      contentType: "image/png",
    });
  });

  test("failed banked resets show an error and retry with the same idempotency key", async ({
    page,
  }) => {
    const requests: Array<{ creditId: string; idempotencyKey: string }> = [];
    await installUsageReportsFixture(page, {
      lists: [codexUsage(false)],
      consume: async (request) => {
        requests.push(request);
        if (requests.length === 1)
          return { error: "Codex request timed out. Refresh usage before retrying." };
        return { outcome: "already_redeemed" };
      },
    });
    const card = await openUsageCard(page);
    page.once("dialog", (dialog) => dialog.accept());
    await card.getByRole("button", { name: "Use reset", exact: true }).click();
    await expect(
      card.getByText("Codex request timed out. Refresh usage before retrying."),
    ).toBeVisible();
    await expect(card.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect(card.getByText(/requestType=|code=codex_banked_reset_failed/)).toHaveCount(0);
    page.once("dialog", (dialog) => dialog.accept());
    await card.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(card.getByText("This banked reset has already been used.")).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[0]?.idempotencyKey).not.toBe("");
  });

  test("expired and unsupported resets cannot be used", async ({ page }) => {
    await installUsageReportsFixture(page, {
      lists: [
        codexUsage(false, [
          { ...bankedReset, expiresAt: "2000-01-01T00:00:00Z" },
          { ...bankedReset, id: "reset-2", resetType: "future_reset" },
          { ...bankedReset, id: "reset-3", status: "redeeming" },
          { ...bankedReset, id: "reset-4", supportedByPlan: false },
        ]),
      ],
    });
    const card = await openUsageCard(page);
    for (const label of ["Expired", "Unsupported", "Processing", "Not supported by plan"]) {
      await expect(card.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(card.getByRole("button", { name: "Use reset", exact: true })).toHaveCount(0);
  });

  test("hosts without the banked reset capability never offer redemption", async ({ page }) => {
    await installUsageReportsFixture(page, {
      lists: [codexUsage(false)],
      supportsBankedResets: false,
    });
    const card = await openUsageCard(page);
    await expect(card.getByText("Update this host to manage banked resets.")).toBeVisible();
    await expect(card.getByRole("button", { name: "Use reset", exact: true })).toHaveCount(0);
  });

  test("redemption errors stay actionable when refreshing usage also fails", async ({ page }) => {
    let consumeSettled = false;
    await installUsageReportsFixture(page, {
      lists: [
        () =>
          consumeSettled
            ? [
                {
                  ...codexUsage(false)[0]!,
                  report: { status: "error", error: "Usage temporarily unavailable" },
                },
              ]
            : codexUsage(false),
      ],
      consume: async () => {
        consumeSettled = true;
        return { error: "Reset request timed out" };
      },
    });
    const card = await openUsageCard(page);
    page.once("dialog", (dialog) => dialog.accept());
    await card.getByRole("button", { name: "Use reset", exact: true }).click();
    await expect(card.getByText("Usage temporarily unavailable")).toBeVisible();
    await expect(card.getByText("Reset request timed out")).toBeVisible();
    await expect(card.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  });

  test("banked reset controls fit a narrow screen", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installUsageReportsFixture(page, { lists: [codexUsage(false)] });
    await gotoAppShell(page);
    await openCompactSettings(page, buildOpenProjectRoute());
    await openSettingsHostSection(page, getServerId(), "usage");
    const card = page.getByTestId("usage-report-codex:default");
    await expect(card.getByText("Referral reward", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Use reset", exact: true })).toBeVisible();
    const bounds = await card.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await testInfo.attach("banked-resets-narrow", {
      body: await page.screenshot({ path: testInfo.outputPath("banked-resets-narrow.png") }),
      contentType: "image/png",
    });
  });
});
