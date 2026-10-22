import { expect, type Page, type TestInfo } from "@playwright/test";
import { gotoAppShell } from "./app";
import { installDaemonWebSocketGate } from "./daemon-websocket-gate";
import { fillNewWorkspaceDraft, openNewWorkspaceComposer } from "./new-workspace";
import { seedWorkspace, type SeededWorkspace } from "./seed-client";
import { waitForSidebarHydration } from "./workspace-ui";

const QUEUED_PROMPT = "Synthetic queued prompt preserved across the offline draft reconnect.";

export class OfflineDraftReconnectScenario {
  private createRequestCountBefore: number | null = null;

  private constructor(
    private readonly page: Page,
    private readonly testInfo: TestInfo,
    private readonly daemonGate: Awaited<ReturnType<typeof installDaemonWebSocketGate>>,
    private readonly workspace: SeededWorkspace,
  ) {}

  static async open(page: Page, testInfo: TestInfo): Promise<OfflineDraftReconnectScenario> {
    const daemonGate = await installDaemonWebSocketGate(page);
    const workspace = await seedWorkspace({ repoPrefix: "offline-draft-reconnect-" });
    return new OfflineDraftReconnectScenario(page, testInfo, daemonGate, workspace);
  }

  async queueDraftAcrossDisconnect(): Promise<void> {
    await gotoAppShell(this.page);
    await waitForSidebarHydration(this.page);
    await openNewWorkspaceComposer(this.page, {
      projectKey: this.workspace.projectKey,
      projectDisplayName: this.workspace.projectDisplayName,
    });
    await fillNewWorkspaceDraft(this.page, QUEUED_PROMPT);

    this.createRequestCountBefore = this.daemonGate.getClientRequestCount("create_agent_request");
    const dropped = this.daemonGate.dropAfterNextServerMessage("workspace.create.response");
    await this.page.getByTestId("workspace-create-submit").click();
    await dropped;
    await this.daemonGate.waitForBlockedConnection();
  }

  async expectDraftPreservedWhileOffline(): Promise<void> {
    await expect(this.page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
    await expect(this.page.getByText("Reconnecting to localhost...", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      this.page.locator('[data-testid^="workspace-tab-draft_"]').filter({ visible: true }),
    ).toHaveCount(1);
    await expect(
      this.page.getByRole("textbox", { name: "Message agent..." }).filter({ visible: true }),
    ).toHaveCount(0);
    expect(this.daemonGate.getClientRequestCount("create_agent_request")).toBe(
      this.requireCreateRequestCountBefore(),
    );
    await this.captureScreenshot("offline-draft.png", "offline draft");
  }

  async reconnectAndExpectQueuedSubmissionOnce(): Promise<void> {
    const expectedRequestCount = this.requireCreateRequestCountBefore() + 1;
    this.daemonGate.restore();

    await expect
      .poll(() => this.daemonGate.getClientRequestCount("create_agent_request"), {
        timeout: 30_000,
      })
      .toBe(expectedRequestCount);
    await expect(this.page.getByText(QUEUED_PROMPT, { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      this.page.locator('[data-testid^="workspace-tab-agent_"]').filter({ visible: true }),
    ).toHaveCount(1);
    await expect(
      this.page.locator('[data-testid^="workspace-tab-draft_"]').filter({ visible: true }),
    ).toHaveCount(0);
    expect(this.daemonGate.getClientRequestCount("create_agent_request")).toBe(
      expectedRequestCount,
    );
    await this.captureScreenshot("reconnected-submission.png", "reconnected queued submission");
  }

  async cleanup(): Promise<void> {
    this.daemonGate.restore();
    await this.workspace.cleanup();
  }

  private requireCreateRequestCountBefore(): number {
    if (this.createRequestCountBefore === null) {
      throw new Error("The offline draft has not been queued.");
    }
    return this.createRequestCountBefore;
  }

  private async captureScreenshot(fileName: string, attachmentName: string): Promise<void> {
    const screenshot = this.testInfo.outputPath(fileName);
    await this.page.screenshot({ path: screenshot, fullPage: true });
    await this.testInfo.attach(attachmentName, {
      path: screenshot,
      contentType: "image/png",
    });
  }
}
