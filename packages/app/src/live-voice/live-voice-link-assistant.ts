import type { Assistant } from "@getpaseo/protocol/assistants";

/**
 * Match a link's `assistant` parameter against the host's assistants. An id
 * wins outright; otherwise the name, compared case-insensitively, since a
 * shortcut URL is typed once by hand. Ambiguous names resolve to nothing rather
 * than to whichever record happened to sort first.
 */
export function matchLinkAssistant(
  assistants: readonly Pick<Assistant, "id" | "name">[],
  reference: string,
): string | null {
  const wanted = reference.trim();
  if (!wanted) {
    return null;
  }
  const byId = assistants.find((assistant) => assistant.id === wanted);
  if (byId) {
    return byId.id;
  }
  const lowered = wanted.toLowerCase();
  const byName = assistants.filter((assistant) => assistant.name.trim().toLowerCase() === lowered);
  return byName.length === 1 ? byName[0].id : null;
}
