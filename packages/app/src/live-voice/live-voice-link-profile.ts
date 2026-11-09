import type { VoiceProfile } from "@getpaseo/protocol/voice-profiles";

export function matchLinkProfile(
  profiles: readonly Pick<VoiceProfile, "id" | "name">[],
  reference: string,
): string | null {
  const wanted = reference.trim();
  if (!wanted) return null;
  const byId = profiles.find((profile) => profile.id === wanted);
  if (byId) return byId.id;
  const lowered = wanted.toLowerCase();
  const byName = profiles.filter((profile) => profile.name.trim().toLowerCase() === lowered);
  return byName.length === 1 ? byName[0].id : null;
}
