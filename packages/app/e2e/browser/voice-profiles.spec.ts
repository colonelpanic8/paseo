import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { expect, test } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { connectDaemonClient } from "../support/helpers/daemon-client-loader";

test("creates a voice profile in the app and lists it beside the host's threads after reload", async ({
  page,
}, testInfo) => {
  const client = await connectDaemonClient<DaemonClient>({
    clientIdPrefix: "voice-profile-browser",
  });
  let profileId: string | undefined;
  try {
    await gotoAppShell(page);
    await openSettings(page);
    await page
      .getByTestId("settings-sidebar")
      .getByRole("button", { name: "Live voice", exact: true })
      .click();
    await page.getByTestId("settings-manage-voice-profiles").click();
    await page.getByTestId("voice-profiles-sheet-new-profile").click();
    await page.getByTestId("voice-profile-form-name").fill("Work profile");
    await page.getByTestId("voice-profile-form-context").fill("The project is Iris.");
    await page.getByTestId("voice-profile-form-files").fill("~/org/AGENTS.md");
    await page.screenshot({
      path: testInfo.outputPath("voice-profile-form.png"),
      fullPage: true,
    });
    await page.getByTestId("voice-profile-form-submit").click();
    await expect(page.getByText("Work profile", { exact: true })).toBeVisible();
    const profile = (await client.listVoiceProfiles()).profiles.find(
      (entry) => entry.name === "Work profile",
    );
    expect(profile).toBeDefined();
    profileId = profile!.id;
    expect(profile!.configuration).toMatchObject({
      context: "The project is Iris.",
      files: ["~/org/AGENTS.md"],
    });
    await page.reload();
    await page.getByTestId("settings-manage-voice-profiles").click();
    await expect(page.getByTestId(`voice-profile-row-${profileId}`)).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("voice-profile-restored.png"),
      fullPage: true,
    });
  } finally {
    if (profileId) await client.deleteVoiceProfile({ profileId });
    await client.close();
  }
});
