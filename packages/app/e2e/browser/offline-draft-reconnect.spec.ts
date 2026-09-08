import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { installDaemonWebSocketGate } from "../support/helpers/daemon-websocket-gate";
import { fillNewWorkspaceDraft, openNewWorkspaceComposer } from "../support/helpers/new-workspace";
import { seedWorkspace } from "../support/helpers/seed-client";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

const QUEUED_PROMPT = "Synthetic queued prompt preserved across the offline draft reconnect.";

test.describe("Offline draft reconnect", () => {
  test("preserves and submits a queued new-workspace draft once after reconnect", async ({
    page,
  }, testInfo) => {
    const daemonGate = await installDaemonWebSocketGate(page);
    const workspace = await seedWorkspace({ repoPrefix: "offline-draft-reconnect-" });

    try {
      await gotoAppShell(page);
      await waitForSidebarHydration(page);
      await openNewWorkspaceComposer(page, {
        projectKey: workspace.projectKey,
        projectDisplayName: workspace.projectDisplayName,
      });
      await fillNewWorkspaceDraft(page, QUEUED_PROMPT);

      const createRequestCountBefore = daemonGate.getClientRequestCount("create_agent_request");
      const dropped = daemonGate.dropAfterNextServerMessage("workspace.create.response");
      await page.getByTestId("workspace-create-submit").click();
      await dropped;
      await daemonGate.waitForBlockedConnection();

      await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
      await expect(page.getByText("Reconnecting to localhost...", { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.locator('[data-testid^="workspace-tab-draft_"]').filter({ visible: true }),
      ).toHaveCount(1);
      await expect(
        page.getByRole("textbox", { name: "Message agent..." }).filter({ visible: true }),
      ).toHaveCount(0);
      expect(daemonGate.getClientRequestCount("create_agent_request")).toBe(
        createRequestCountBefore,
      );

      const offlineScreenshot = testInfo.outputPath("offline-draft.png");
      await page.screenshot({ path: offlineScreenshot, fullPage: true });
      await testInfo.attach("offline draft", {
        path: offlineScreenshot,
        contentType: "image/png",
      });

      daemonGate.restore();

      await expect
        .poll(() => daemonGate.getClientRequestCount("create_agent_request"), {
          timeout: 30_000,
        })
        .toBe(createRequestCountBefore + 1);
      await expect(page.getByText(QUEUED_PROMPT, { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.locator('[data-testid^="workspace-tab-agent_"]').filter({ visible: true }),
      ).toHaveCount(1);
      await expect(
        page.locator('[data-testid^="workspace-tab-draft_"]').filter({ visible: true }),
      ).toHaveCount(0);

      const recoveredScreenshot = testInfo.outputPath("reconnected-submission.png");
      await page.screenshot({ path: recoveredScreenshot, fullPage: true });
      await testInfo.attach("reconnected queued submission", {
        path: recoveredScreenshot,
        contentType: "image/png",
      });
    } finally {
      daemonGate.restore();
      await workspace.cleanup();
    }
  });
});
