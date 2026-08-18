import type { DaemonServerInfo } from "@/stores/session-store";

export interface LiveVoiceContextProfileOption {
  id: string;
  label: string;
}

export interface LiveVoiceContextProfileHostInfo {
  profiles: LiveVoiceContextProfileOption[];
  defaultProfileId: string | null;
}

/** The single compatibility gate for named profiles on an app-connected host. */
export function getLiveVoiceContextProfileHostInfo(
  serverInfo: DaemonServerInfo | null | undefined,
): LiveVoiceContextProfileHostInfo {
  if (serverInfo?.features?.liveVoiceContextProfiles !== true) {
    return { profiles: [], defaultProfileId: null };
  }

  const capability = serverInfo.capabilities?.liveVoice;
  return {
    profiles:
      capability?.contextProfiles.map((profile) => ({
        id: profile.id,
        label: profile.label,
      })) ?? [],
    defaultProfileId: capability?.defaultContextProfileId ?? null,
  };
}

export function resolveLiveVoiceContextProfileId(input: {
  profiles: readonly LiveVoiceContextProfileOption[];
  persistedProfileId: string | null | undefined;
  defaultProfileId: string | null | undefined;
}): string | undefined {
  const ids = new Set(input.profiles.map((profile) => profile.id));
  if (input.persistedProfileId && ids.has(input.persistedProfileId)) {
    return input.persistedProfileId;
  }
  if (input.defaultProfileId && ids.has(input.defaultProfileId)) {
    return input.defaultProfileId;
  }
  return input.profiles[0]?.id;
}
