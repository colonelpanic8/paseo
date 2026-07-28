import { describe, expect, it } from "vitest";
import { PREVIEW_ATTACHMENT_MAX_AGE_MS } from "./gc-policy";
import { createLocalFileAttachmentStore } from "./local-file-attachment-store";
import { createTestAttachmentFileSystem } from "./test-attachment-file-system";

describe("local file attachment store", () => {
  it("writes raw byte sources directly to the managed file path", async () => {
    const fileSystem = createTestAttachmentFileSystem();
    const store = createLocalFileAttachmentStore({
      storageType: "native-file",
      baseDirectoryName: "preview-assets",
      fileSystem,
      resolvePreviewUrl: async (attachment) => `file://${attachment.storageKey}`,
    });

    const attachment = await store.save({
      id: "preview_8_test",
      mimeType: "image/png",
      fileName: "result.png",
      source: { kind: "bytes", bytes: new Uint8Array([0, 1, 2, 3]) },
    });

    expect(attachment).toMatchObject({
      id: "preview_8_test",
      mimeType: "image/png",
      storageType: "native-file",
      storageKey: "/cache/preview-assets/preview_8_test.png",
      fileName: "result.png",
      byteSize: 4,
    });
    expect(fileSystem.files.get("file:///cache/preview-assets/preview_8_test.png")).toEqual(
      new Uint8Array([0, 1, 2, 3]),
    );
    expect(fileSystem.directories.has("file:///cache/preview-assets")).toBe(true);
  });

  describe("garbageCollect", () => {
    function createStore() {
      const fileSystem = createTestAttachmentFileSystem();
      const store = createLocalFileAttachmentStore({
        storageType: "native-file",
        baseDirectoryName: "preview-assets",
        fileSystem,
        resolvePreviewUrl: async (attachment) => `file://${attachment.storageKey}`,
      });
      return { fileSystem, store };
    }

    it("keeps unreferenced previews so composer edits do not evict rendered images", async () => {
      const { fileSystem, store } = createStore();
      fileSystem.setFile("file:///cache/preview-assets/preview_4_abc.png", new Uint8Array([1]));
      fileSystem.setFile("file:///cache/preview-assets/att_unreferenced.png", new Uint8Array([2]));
      fileSystem.setFile("file:///cache/preview-assets/att_kept.png", new Uint8Array([3]));

      await store.garbageCollect({ referencedIds: new Set(["att_kept"]) });

      expect([...fileSystem.files.keys()].sort()).toEqual([
        "file:///cache/preview-assets/att_kept.png",
        "file:///cache/preview-assets/preview_4_abc.png",
      ]);
    });

    it("evicts previews older than the max age", async () => {
      const { fileSystem, store } = createStore();
      const freshUri = "file:///cache/preview-assets/preview_4_fresh.png";
      const staleUri = "file:///cache/preview-assets/preview_4_stale.png";
      fileSystem.setFile(freshUri, new Uint8Array([1]));
      fileSystem.setFile(staleUri, new Uint8Array([2]));
      fileSystem.setModificationTimeMs(freshUri, Date.now());
      fileSystem.setModificationTimeMs(staleUri, Date.now() - PREVIEW_ATTACHMENT_MAX_AGE_MS - 1);

      await store.garbageCollect({ referencedIds: new Set() });

      expect([...fileSystem.files.keys()]).toEqual([freshUri]);
    });
  });
});
