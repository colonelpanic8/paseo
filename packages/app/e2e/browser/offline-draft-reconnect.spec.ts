import { test } from "../support/fixtures";
import { OfflineDraftReconnectScenario } from "../support/helpers/offline-draft-reconnect";

test.describe("Offline draft reconnect", () => {
  test("preserves and submits a queued new-workspace draft once after reconnect", async ({
    page,
  }, testInfo) => {
    const scenario = await OfflineDraftReconnectScenario.open(page, testInfo);

    try {
      await scenario.queueDraftAcrossDisconnect();
      await scenario.expectDraftPreservedWhileOffline();
      await scenario.reconnectAndExpectQueuedSubmissionOnce();
    } finally {
      await scenario.cleanup();
    }
  });
});
