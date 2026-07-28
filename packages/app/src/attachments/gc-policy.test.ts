import { describe, expect, it } from "vitest";
import { PREVIEW_ATTACHMENT_MAX_AGE_MS, shouldDeleteAttachmentDuringGc } from "./gc-policy";

const NOW = 1_800_000_000_000;

describe("shouldDeleteAttachmentDuringGc", () => {
  it("keeps referenced attachments", () => {
    expect(
      shouldDeleteAttachmentDuringGc({
        id: "abc123",
        isReferenced: true,
        createdAtMs: 0,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("deletes unreferenced composer attachments", () => {
    expect(
      shouldDeleteAttachmentDuringGc({
        id: "abc123",
        isReferenced: false,
        createdAtMs: NOW,
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it("keeps unreferenced previews that are still within the max age", () => {
    expect(
      shouldDeleteAttachmentDuringGc({
        id: "preview_1024_deadbeef",
        isReferenced: false,
        createdAtMs: NOW - PREVIEW_ATTACHMENT_MAX_AGE_MS + 1,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("deletes unreferenced previews once they exceed the max age", () => {
    expect(
      shouldDeleteAttachmentDuringGc({
        id: "preview_1024_deadbeef",
        isReferenced: false,
        createdAtMs: NOW - PREVIEW_ATTACHMENT_MAX_AGE_MS - 1,
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it("keeps previews whose age cannot be established", () => {
    expect(
      shouldDeleteAttachmentDuringGc({
        id: "preview_1024_deadbeef",
        isReferenced: false,
        createdAtMs: null,
        nowMs: NOW,
      }),
    ).toBe(false);
  });
});
