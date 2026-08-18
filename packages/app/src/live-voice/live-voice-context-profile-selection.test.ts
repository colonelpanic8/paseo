import { describe, expect, it } from "vitest";
import {
  getLiveVoiceContextProfileHostInfo,
  resolveLiveVoiceContextProfileId,
} from "./live-voice-context-profile-selection";

const profiles = [
  { id: "full-org", label: "Full org" },
  { id: "lean", label: "Lean" },
];

describe("Live Voice context profile selection", () => {
  it("prefers a valid per-host selection, then the daemon default, then the first profile", () => {
    expect(
      resolveLiveVoiceContextProfileId({
        profiles,
        persistedProfileId: "full-org",
        defaultProfileId: "lean",
      }),
    ).toBe("full-org");
    expect(
      resolveLiveVoiceContextProfileId({
        profiles,
        persistedProfileId: "removed",
        defaultProfileId: "lean",
      }),
    ).toBe("lean");
    expect(
      resolveLiveVoiceContextProfileId({
        profiles,
        persistedProfileId: null,
        defaultProfileId: null,
      }),
    ).toBe("full-org");
    expect(
      resolveLiveVoiceContextProfileId({
        profiles: [],
        persistedProfileId: "lean",
        defaultProfileId: "lean",
      }),
    ).toBeUndefined();
  });

  it("hides profile metadata from an older daemon without the feature", () => {
    expect(
      getLiveVoiceContextProfileHostInfo({
        serverId: "old-host",
        hostname: "old-host",
        version: "0.3.9",
        features: { liveVoice: true },
        capabilities: {
          liveVoice: { contextProfiles: profiles, defaultContextProfileId: "lean" },
        },
      }),
    ).toEqual({ profiles: [], defaultProfileId: null });
  });

  it("returns advertised profiles when the daemon feature is present", () => {
    expect(
      getLiveVoiceContextProfileHostInfo({
        serverId: "new-host",
        hostname: "new-host",
        version: "0.4.0",
        features: { liveVoice: true, liveVoiceContextProfiles: true },
        capabilities: {
          liveVoice: { contextProfiles: profiles, defaultContextProfileId: "lean" },
        },
      }),
    ).toEqual({ profiles, defaultProfileId: "lean" });
  });
});
