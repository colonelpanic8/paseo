import { describe, expect, it } from "vitest";
import { matchLinkProfile } from "@/live-voice/live-voice-link-profile";

const profiles = [
  { id: "cfg_life", name: "Chief of staff" },
  { id: `prf_${"b".repeat(32)}`, name: "Work" },
  { id: `prf_${"c".repeat(32)}`, name: "Reviewer" },
  { id: `prf_${"d".repeat(32)}`, name: "reviewer" },
];

describe("matchLinkProfile", () => {
  it("prefers an exact id", () => {
    expect(matchLinkProfile(profiles, profiles[1].id)).toBe(profiles[1].id);
  });

  it("matches a name case-insensitively and ignores surrounding whitespace", () => {
    expect(matchLinkProfile(profiles, "  chief OF staff ")).toBe(profiles[0].id);
  });

  it("refuses ambiguous or unknown names", () => {
    expect(matchLinkProfile(profiles, "Reviewer")).toBeNull();
    expect(matchLinkProfile(profiles, "")).toBeNull();
    expect(matchLinkProfile(profiles, "Nobody")).toBeNull();
  });
});
