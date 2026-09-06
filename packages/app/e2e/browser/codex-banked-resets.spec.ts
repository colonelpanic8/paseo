import { openBankedResetManagement } from "../support/helpers/banked-resets";
import { test } from "../support/fixtures";
test.describe("banked reset management", () => {
  test.setTimeout(120_000);

  test("confirms, prevents duplicate submissions, and refreshes usage", async ({
    page,
  }, testInfo) => {
    const resets = await openBankedResetManagement(page);
    await resets.expectAvailable();
    await resets.capture(testInfo, "banked-resets-before");
    await resets.cancelRedemption();
    await resets.redeem();
    await resets.expectPending();
    await resets.completeRedemption();
    await resets.expectUsed();
    await resets.capture(testInfo, "banked-resets-after");
  });

  test("retries failed resets with the same idempotency key", async ({ page }, testInfo) => {
    const resets = await openBankedResetManagement(page, { failure: "reset" });
    await resets.redeem();
    await resets.expectRetryableError();
    await resets.capture(testInfo, "banked-resets-error");
    await resets.retry();
    await resets.expectRetryReusesAttempt();
  });

  test("expired and unsupported resets cannot be used", async ({ page }) => {
    const resets = await openBankedResetManagement(page, { unavailableCredits: true });
    await resets.expectUnavailableCredits();
  });

  test("hosts without the capability never offer redemption", async ({ page }) => {
    const resets = await openBankedResetManagement(page, { supportsBankedResets: false });
    await resets.expectHostUpdateRequired();
  });

  test("redemption errors stay actionable when refreshing usage also fails", async ({ page }) => {
    const resets = await openBankedResetManagement(page, { failure: "reset-and-usage" });
    await resets.redeem();
    await resets.expectRetryableError();
  });

  test("reset details remain readable and redemption works on a narrow screen", async ({
    page,
  }, testInfo) => {
    const resets = await openBankedResetManagement(page, { narrow: true });
    await resets.expectAvailable();
    await resets.expectReadableResetControls();
    await resets.capture(testInfo, "banked-resets-narrow");
    await resets.redeem();
    await resets.expectPending();
    await resets.completeRedemption();
    await resets.expectUsed();
  });
});
