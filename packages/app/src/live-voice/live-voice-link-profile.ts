import type { VoiceProfile } from "@getpaseo/protocol/voice-profiles";

/**
 * Match a link's `profile` parameter against the host's profiles. An id wins
 * outright; otherwise the name, compared case-insensitively, since a shortcut
 * URL is typed once by hand. Ambiguous names resolve to nothing rather than to
 * whichever record happened to sort first.
 */
export function matchLinkProfile(
  profiles: readonly Pick<VoiceProfile, "id" | "name">[],
  reference: string,
): string | null {
  const wanted = reference.trim();
  if (!wanted) {
    return null;
  }
  const byId = profiles.find((profile) => profile.id === wanted);
  if (byId) {
    return byId.id;
  }
  const lowered = wanted.toLowerCase();
  const byName = profiles.filter((profile) => profile.name.trim().toLowerCase() === lowered);
  return byName.length === 1 ? byName[0].id : null;
}
