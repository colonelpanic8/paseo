// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttachmentMetadata, AttachmentStore } from "@/attachments/types";
import { __setAttachmentStoreForTests } from "@/attachments/store";
import { garbageCollectAttachments } from "@/attachments/service";
import { __resetLiveAttachmentsForTests } from "@/attachments/live-attachments";
import { useAttachmentPreviewUrlState } from "@/attachments/use-attachment-preview-url";

const ATTACHMENT: AttachmentMetadata = {
  id: "preview_4_abc",
  mimeType: "image/png",
  storageType: "web-indexeddb",
  storageKey: "preview_4_abc",
  fileName: "shot.png",
  byteSize: 4,
  createdAt: 0,
};

interface FakeAttachmentStore {
  store: AttachmentStore;
  /** Ids whose bytes are present, i.e. what a `resolvePreviewUrl` read would find. */
  storedIds: Set<string>;
  releasedUrls: string[];
  gcReferencedIds: Array<Set<string>>;
  resolveCount: () => number;
  /** Holds the next resolve open so a reload can land while it is in flight. */
  blockNextResolve: () => { release: () => void };
}

/**
 * In-memory stand-in for a real attachment store: bytes either exist or they do not, and
 * garbage collection deletes whatever the caller did not mark as referenced. The hook is
 * driven through the real `@/attachments/service` functions on top of it, so a break in the
 * service/store integration or the preview-URL release lifecycle fails these tests.
 */
function createFakeAttachmentStore(): FakeAttachmentStore {
  const storedIds = new Set<string>();
  const releasedUrls: string[] = [];
  const gcReferencedIds: Array<Set<string>> = [];
  let resolveCount = 0;
  let urlSequence = 0;
  let gate: { promise: Promise<void>; release: () => void } | null = null;

  const store: AttachmentStore = {
    storageType: "web-indexeddb",
    async save() {
      throw new Error("save is not exercised by these tests");
    },
    async encodeBase64() {
      throw new Error("encodeBase64 is not exercised by these tests");
    },
    async resolvePreviewUrl({ attachment }) {
      resolveCount += 1;
      // Presence is captured when the read starts, as in a real store: bytes that land after
      // an attempt is already in flight do not rescue that attempt.
      const found = storedIds.has(attachment.storageKey);
      const pending = gate;
      gate = null;
      if (pending) {
        await pending.promise;
      }
      if (!found) {
        throw new Error(`No attachment bytes for ${attachment.storageKey}`);
      }
      urlSequence += 1;
      return `blob:${attachment.storageKey}#${urlSequence}`;
    },
    async releasePreviewUrl({ url }) {
      releasedUrls.push(url);
    },
    async delete({ attachment }) {
      storedIds.delete(attachment.storageKey);
    },
    async garbageCollect({ referencedIds }) {
      gcReferencedIds.push(new Set(referencedIds));
      const collected = [...storedIds].filter((id) => !referencedIds.has(id));
      for (const id of collected) {
        storedIds.delete(id);
      }
    },
  };

  return {
    store,
    storedIds,
    releasedUrls,
    gcReferencedIds,
    resolveCount: () => resolveCount,
    blockNextResolve: () => {
      let release = (): void => {};
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      gate = { promise, release };
      return { release: () => release() };
    },
  };
}

/** The hook logs every failed resolve; these tests provoke failures on purpose. */
function expectResolveFailures(): void {
  vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("useAttachmentPreviewUrlState", () => {
  afterEach(() => {
    __setAttachmentStoreForTests(null);
    __resetLiveAttachmentsForTests();
    vi.restoreAllMocks();
  });

  it("reports resolving before the url lands so callers do not paint a failure", async () => {
    const fake = createFakeAttachmentStore();
    fake.storedIds.add(ATTACHMENT.id);
    __setAttachmentStoreForTests(fake.store);

    const { result } = renderHook(() => useAttachmentPreviewUrlState(ATTACHMENT));

    expect(result.current).toEqual({ status: "resolving" });
    await waitFor(() =>
      expect(result.current).toEqual({ status: "ready", url: "blob:preview_4_abc#1" }),
    );
  });

  it("retries a failed resolve when the reload key changes", async () => {
    const fake = createFakeAttachmentStore();
    __setAttachmentStoreForTests(fake.store);
    expectResolveFailures();

    const { result, rerender } = renderHook(
      ({ reloadKey }: { reloadKey: number }) =>
        useAttachmentPreviewUrlState(ATTACHMENT, { reloadKey }),
      { initialProps: { reloadKey: 1 } },
    );

    await waitFor(() => expect(result.current).toEqual({ status: "failed" }));

    fake.storedIds.add(ATTACHMENT.id);
    rerender({ reloadKey: 2 });

    await waitFor(() =>
      expect(result.current).toEqual({ status: "ready", url: "blob:preview_4_abc#1" }),
    );
    expect(fake.resolveCount()).toBe(2);
  });

  it("retries when a reload lands while the resolve that fails is still in flight", async () => {
    const fake = createFakeAttachmentStore();
    __setAttachmentStoreForTests(fake.store);
    expectResolveFailures();
    const blocked = fake.blockNextResolve();

    const { result, rerender } = renderHook(
      ({ reloadKey }: { reloadKey: number }) =>
        useAttachmentPreviewUrlState(ATTACHMENT, { reloadKey }),
      { initialProps: { reloadKey: 1 } },
    );

    // Wait for the read to reach the store, so it has already missed the bytes.
    await waitFor(() => expect(fake.resolveCount()).toBe(1));
    expect(result.current).toEqual({ status: "resolving" });

    // The refetch lands while the first read is still open, so the reload signal arrives
    // before the failure it should answer.
    fake.storedIds.add(ATTACHMENT.id);
    rerender({ reloadKey: 2 });
    blocked.release();

    await waitFor(() =>
      expect(result.current).toEqual({ status: "ready", url: "blob:preview_4_abc#1" }),
    );
    expect(fake.resolveCount()).toBe(2);
  });

  it("keeps a resolved url when the reload key changes after success", async () => {
    const fake = createFakeAttachmentStore();
    fake.storedIds.add(ATTACHMENT.id);
    __setAttachmentStoreForTests(fake.store);

    const { result, rerender } = renderHook(
      ({ reloadKey }: { reloadKey: number }) =>
        useAttachmentPreviewUrlState(ATTACHMENT, { reloadKey }),
      { initialProps: { reloadKey: 1 } },
    );

    await waitFor(() =>
      expect(result.current).toEqual({ status: "ready", url: "blob:preview_4_abc#1" }),
    );

    rerender({ reloadKey: 2 });

    expect(result.current).toEqual({ status: "ready", url: "blob:preview_4_abc#1" });
    expect(fake.resolveCount()).toBe(1);
  });

  it("releases the resolved preview url when the caller unmounts", async () => {
    const fake = createFakeAttachmentStore();
    fake.storedIds.add(ATTACHMENT.id);
    __setAttachmentStoreForTests(fake.store);

    const { result, unmount } = renderHook(() => useAttachmentPreviewUrlState(ATTACHMENT));

    await waitFor(() =>
      expect(result.current).toEqual({ status: "ready", url: "blob:preview_4_abc#1" }),
    );

    unmount();

    await waitFor(() => expect(fake.releasedUrls).toEqual(["blob:preview_4_abc#1"]));
  });

  it("keeps a displayed preview out of an unreferenced sweep until it unmounts", async () => {
    const fake = createFakeAttachmentStore();
    fake.storedIds.add(ATTACHMENT.id);
    __setAttachmentStoreForTests(fake.store);

    const { result, unmount } = renderHook(() => useAttachmentPreviewUrlState(ATTACHMENT));
    await waitFor(() =>
      expect(result.current).toEqual({ status: "ready", url: "blob:preview_4_abc#1" }),
    );

    // A composer keystroke sweeps with no preview in its roots; the mounted image is still
    // reachable, so its bytes must survive regardless of how old the preview is.
    await garbageCollectAttachments({ referencedIds: new Set<string>() });
    expect(fake.gcReferencedIds.at(-1)?.has(ATTACHMENT.id)).toBe(true);
    expect(fake.storedIds.has(ATTACHMENT.id)).toBe(true);

    unmount();

    await garbageCollectAttachments({ referencedIds: new Set<string>() });
    expect(fake.gcReferencedIds.at(-1)?.has(ATTACHMENT.id)).toBe(false);
    expect(fake.storedIds.has(ATTACHMENT.id)).toBe(false);
  });
});
