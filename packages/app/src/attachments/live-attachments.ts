/**
 * Attachment ids that a mounted component is currently displaying.
 *
 * Preview attachments are not rooted in drafts, queued messages, or the create flow, so
 * garbage collection falls back to an age-based lifetime for them (see gc-policy.ts). Age
 * alone cannot see a preview that is on screen right now: a thread or file pane left open
 * past the max age would have the bytes behind a rendered image deleted by the next
 * draft-triggered sweep. Hooks that resolve a preview URL retain the id here for as long as
 * they hold it, and garbage collection treats retained ids as referenced.
 */
const retainCountById = new Map<string, number>();

/** Retains `id` until the returned release function is called. Safe to call twice. */
export function retainLiveAttachment(id: string): () => void {
  retainCountById.set(id, (retainCountById.get(id) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const remaining = (retainCountById.get(id) ?? 0) - 1;
    if (remaining > 0) {
      retainCountById.set(id, remaining);
    } else {
      retainCountById.delete(id);
    }
  };
}

export function collectLiveAttachmentIds(into: Set<string>): void {
  for (const id of retainCountById.keys()) {
    into.add(id);
  }
}

/** Test-only hook to drop retentions leaked by an unmounted render tree. */
export function __resetLiveAttachmentsForTests(): void {
  retainCountById.clear();
}
