import { useEffect, useRef, useState } from "react";
import type { AttachmentMetadata } from "@/attachments/types";
import { releaseAttachmentPreviewUrl, resolveAttachmentPreviewUrl } from "@/attachments/service";
import { retainLiveAttachment } from "@/attachments/live-attachments";

export type AttachmentPreviewUrlState =
  | { status: "idle" }
  | { status: "resolving" }
  | { status: "ready"; url: string }
  | { status: "failed" };

export interface UseAttachmentPreviewUrlOptions {
  /**
   * Signals that the bytes behind the attachment may have been rewritten. Preview attachment
   * ids are content-derived and therefore stable, so without this a single failed resolve
   * would stick until the component remounted — refetching the bytes could not clear it.
   * Only a *failed* resolve is retried, so a routine refetch never drops a rendered image
   * back to a spinner. Callers driven by a query can pass `dataUpdatedAt`.
   */
  reloadKey?: number | string;
}

export function useAttachmentPreviewUrlState(
  attachment: AttachmentMetadata | null | undefined,
  options?: UseAttachmentPreviewUrlOptions,
): AttachmentPreviewUrlState {
  const [state, setState] = useState<AttachmentPreviewUrlState>({ status: "idle" });
  const [retryAttempt, setRetryAttempt] = useState(0);
  const activeAttachmentRef = useRef<AttachmentMetadata | null>(null);
  const attachmentRef = useRef(attachment);
  attachmentRef.current = attachment;
  const stateRef = useRef(state);
  stateRef.current = state;

  const id = attachment?.id;
  const storageType = attachment?.storageType;
  const storageKey = attachment?.storageKey;
  const mimeType = attachment?.mimeType;
  const reloadKey = options?.reloadKey;
  const hasSeenReloadKeyRef = useRef(false);
  // A reload signal that arrived while a resolve was still in flight. That attempt read the
  // store before the refreshed bytes landed, so its failure says nothing about them — retry
  // instead of latching "failed", which nothing else would clear once the caller's key stops
  // changing.
  const pendingReloadRef = useRef(false);

  // Garbage collection may not delete bytes we are displaying. Retaining by id (rather than
  // waiting for a resolved URL) also covers the window where the resolve is still in flight.
  useEffect(() => {
    if (!id) {
      return;
    }
    return retainLiveAttachment(id);
  }, [id]);

  useEffect(() => {
    if (!hasSeenReloadKeyRef.current) {
      hasSeenReloadKeyRef.current = true;
      return;
    }
    if (stateRef.current.status === "failed") {
      setRetryAttempt((attempt) => attempt + 1);
      return;
    }
    if (stateRef.current.status === "resolving") {
      pendingReloadRef.current = true;
    }
  }, [reloadKey]);

  useEffect(() => {
    let disposed = false;
    let currentUrl: string | null = null;
    const current = attachmentRef.current;

    activeAttachmentRef.current = current ?? null;
    // A fresh attempt supersedes any reload that arrived during the previous one.
    pendingReloadRef.current = false;
    if (!current) {
      setState({ status: "idle" });
      return;
    }

    setState({ status: "resolving" });

    void (async () => {
      try {
        const resolved = await resolveAttachmentPreviewUrl(current);
        if (disposed) {
          await releaseAttachmentPreviewUrl({ attachment: current, url: resolved });
          return;
        }
        currentUrl = resolved;
        setState({ status: "ready", url: resolved });
      } catch (error) {
        console.error("[attachments] Failed to resolve preview URL", {
          attachmentId: current.id,
          error,
        });
        if (disposed) {
          return;
        }
        if (pendingReloadRef.current) {
          pendingReloadRef.current = false;
          setRetryAttempt((attempt) => attempt + 1);
          return;
        }
        setState({ status: "failed" });
      }
    })();

    return () => {
      disposed = true;
      const activeAttachment = activeAttachmentRef.current;
      if (!currentUrl || !activeAttachment) {
        return;
      }
      void releaseAttachmentPreviewUrl({
        attachment: activeAttachment,
        url: currentUrl,
      });
    };
  }, [id, storageType, storageKey, mimeType, retryAttempt]);

  return state;
}

export function useAttachmentPreviewUrl(
  attachment: AttachmentMetadata | null | undefined,
  options?: UseAttachmentPreviewUrlOptions,
): string | null {
  const state = useAttachmentPreviewUrlState(attachment, options);
  return state.status === "ready" ? state.url : null;
}
