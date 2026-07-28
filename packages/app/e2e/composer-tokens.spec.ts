import { test, expect } from "./fixtures";
import { composerLocator } from "./helpers/composer";
import { openSettings } from "./helpers/app";
import { clickSettingsBackToWorkspace } from "./helpers/settings";

const APP_SETTINGS_KEY = "@paseo:app-settings";

async function expectStoredSigils(
  page: import("@playwright/test").Page,
  expected: { command: string; skill: string },
): Promise<void> {
  await expect
    .poll(async () => {
      const raw = await page.evaluate((key) => localStorage.getItem(key), APP_SETTINGS_KEY);
      if (!raw) {
        return null;
      }
      const settings = JSON.parse(raw) as {
        commandTriggerSigil?: string;
        skillTriggerSigil?: string;
      };
      return {
        command: settings.commandTriggerSigil,
        skill: settings.skillTriggerSigil,
      };
    })
    .toEqual(expected);
}

test("composer token pills and trigger settings stay aligned", async ({
  page,
  withWorkspace,
}, testInfo) => {
  const workspace = await withWorkspace({ prefix: "composer-tokens-" });
  await workspace.navigateTo();

  const composer = composerLocator(page);
  await composer.fill("check $HOME");
  await expect(composer).not.toHaveAttribute("data-composer-tokenized", "");
  await expect(page.locator("[data-composer-token-mirror]")).toHaveCount(0);
  await composer.press("Enter");
  const shellVariableMessage = page.getByTestId("user-message").last();
  await expect(shellVariableMessage).toContainText("check $HOME");
  await expect(shellVariableMessage).not.toContainText("check /HOME");

  await composer.fill("please run $release-beta");
  await composer.press("Enter");
  await expect(composer).toHaveValue("please run /release-beta ");
  await expect(composer).toHaveAttribute("data-composer-tokenized", "");

  const mirror = page.locator("[data-composer-token-mirror]");
  await expect(mirror).toBeVisible();
  await expect(mirror.getByText("$release-beta", { exact: true })).toBeVisible();
  await expect
    .poll(() => composer.evaluate((element) => getComputedStyle(element).color))
    .toBe("rgba(0, 0, 0, 0)");

  const composerScreenshot = testInfo.outputPath("composer-token-pill.png");
  await page
    .getByTestId("message-input-root")
    .filter({ visible: true })
    .first()
    .screenshot({ path: composerScreenshot });
  await testInfo.attach("composer-token-pill", {
    path: composerScreenshot,
    contentType: "image/png",
  });

  await openSettings(page);
  const commandTrigger = page.getByTestId("settings-command-trigger");
  const skillTrigger = page.getByTestId("settings-skill-trigger");
  await expect(commandTrigger).toBeVisible();
  await expect(skillTrigger).toBeVisible();

  await commandTrigger.getByRole("button", { name: "!", exact: true }).click();
  await skillTrigger.getByRole("button", { name: "#", exact: true }).click();
  await expectStoredSigils(page, { command: "!", skill: "#" });

  await commandTrigger.getByRole("button", { name: "#", exact: true }).click();
  await expectStoredSigils(page, { command: "#", skill: "!" });

  const settingsScreenshot = testInfo.outputPath("composer-trigger-settings.png");
  await commandTrigger.locator("xpath=..").screenshot({ path: settingsScreenshot });
  await testInfo.attach("composer-trigger-settings", {
    path: settingsScreenshot,
    contentType: "image/png",
  });

  await clickSettingsBackToWorkspace(page);
  await composer.fill("please run !release-beta");
  await composer.press("Enter");
  await expect(composer).toHaveValue("please run /release-beta ");
  await expect(composer).toHaveAttribute("data-composer-tokenized", "");
  await expect(mirror.getByText("!release-beta", { exact: true })).toBeVisible();

  await composer.fill("plain draft");
  await expect(composer).not.toHaveAttribute("data-composer-tokenized", "");
  await expect(mirror).toHaveCount(0);

  await composer.fill("please run !release-beta");
  await composer.press("Tab");
  await expect(composer).toHaveValue("please run /release-beta ");
  await composer.press("Enter");
  const sentMessage = page.getByTestId("user-message").last();
  const sentToken = sentMessage.getByTestId("sent-message-token");
  await expect(sentMessage).toBeVisible();
  await expect(sentToken).toHaveText("!release-beta");
  await expect(sentMessage).not.toContainText("/release-beta");

  const sentMessageScreenshot = testInfo.outputPath("sent-message-token-pill.png");
  await sentMessage.screenshot({ path: sentMessageScreenshot });
  await testInfo.attach("sent-message-token-pill", {
    path: sentMessageScreenshot,
    contentType: "image/png",
  });

  await expect(
    page.locator("[data-nextjs-dialog], .vite-error-overlay, #webpack-dev-server-client-overlay"),
  ).toHaveCount(0);
});
