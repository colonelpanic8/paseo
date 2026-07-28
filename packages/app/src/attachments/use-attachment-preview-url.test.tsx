// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentMetadata } from "@/attachments/types";

const resolveAttachmentPreviewUrl = vi.fn<(attachment: AttachmentMetadata) => Promise<string>>();
const releaseAttachmentPreviewUrl =
  vi.fn<(input: { attachment: AttachmentMetadata; url: string }) => Promise<void>>();

vi.mock("@/attachments/service", () => ({
  resolveAttachmentPreviewUrl: (attachment: AttachmentMetadata) =>
    resolveAttachmentPreviewUrl(attachment),
  releaseAttachmentPreviewUrl: (input: { attachment: AttachmentMetadata; url: string }) =>
    releaseAttachmentPreviewUrl(input),
}));

const { useAttachmentPreviewUrlState } = await import("@/attachments/use-attachment-preview-url");

const ATTACHMENT: AttachmentMetadata = {
  id: "preview_4_abc",
  mimeType: "image/png",
  storageType: "web-indexeddb",
  storageKey: "preview_4_abc",
  fileName: "shot.png",
  byteSize: 4,
  createdAt: 0,
};

describe("useAttachmentPreviewUrlState", () => {
  beforeEach(() => {
    resolveAttachmentPreviewUrl.mockReset();
    releaseAttachmentPreviewUrl.mockReset();
    releaseAttachmentPreviewUrl.mockResolvedValue(undefined);
  });

  it("reports resolving before the url lands so callers do not paint a failure", async () => {
    resolveAttachmentPreviewUrl.mockResolvedValue("blob:ready");

    const { result } = renderHook(() => useAttachmentPreviewUrlState(ATTACHMENT));

    expect(result.current).toEqual({ status: "resolving" });
    await waitFor(() => expect(result.current).toEqual({ status: "ready", url: "blob:ready" }));
  });

  it("retries a failed resolve when the reload key changes", async () => {
    resolveAttachmentPreviewUrl.mockRejectedValueOnce(new Error("not found"));
    resolveAttachmentPreviewUrl.mockResolvedValueOnce("blob:recovered");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { result, rerender } = renderHook(
      ({ reloadKey }: { reloadKey: number }) =>
        useAttachmentPreviewUrlState(ATTACHMENT, { reloadKey }),
      { initialProps: { reloadKey: 1 } },
    );

    await waitFor(() => expect(result.current).toEqual({ status: "failed" }));

    rerender({ reloadKey: 2 });

    await waitFor(() => expect(result.current).toEqual({ status: "ready", url: "blob:recovered" }));
    expect(resolveAttachmentPreviewUrl).toHaveBeenCalledTimes(2);
  });

  it("keeps a resolved url when the reload key changes after success", async () => {
    resolveAttachmentPreviewUrl.mockResolvedValue("blob:ready");

    const { result, rerender } = renderHook(
      ({ reloadKey }: { reloadKey: number }) =>
        useAttachmentPreviewUrlState(ATTACHMENT, { reloadKey }),
      { initialProps: { reloadKey: 1 } },
    );

    await waitFor(() => expect(result.current).toEqual({ status: "ready", url: "blob:ready" }));

    rerender({ reloadKey: 2 });

    expect(result.current).toEqual({ status: "ready", url: "blob:ready" });
    expect(resolveAttachmentPreviewUrl).toHaveBeenCalledTimes(1);
  });
});
