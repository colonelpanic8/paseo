import { isPreviewAttachmentId } from "@/attachments/utils";

// Preview attachments are never rooted in drafts, queued messages, or the create flow, so
// reference-based collection would delete them the moment anything touches a draft — which
// is every keystroke in the composer. They are a cache of bytes the daemon still owns, so
// they expire on age instead. Anything without a usable timestamp is kept: a preview whose
// age we cannot establish is cheaper to keep than to delete out from under a mounted image.
export const PREVIEW_ATTACHMENT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldDeleteAttachmentDuringGc(input: {
  id: string;
  isReferenced: boolean;
  createdAtMs: number | null;
  nowMs: number;
}): boolean {
  if (input.isReferenced) {
    return false;
  }
  if (!isPreviewAttachmentId(input.id)) {
    return true;
  }
  if (input.createdAtMs === null || !Number.isFinite(input.createdAtMs)) {
    return false;
  }
  return input.nowMs - input.createdAtMs > PREVIEW_ATTACHMENT_MAX_AGE_MS;
}
