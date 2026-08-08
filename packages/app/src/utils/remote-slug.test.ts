import { describe, expect, it } from "vitest";
import { deriveRemoteSlug } from "./remote-slug";

describe("deriveRemoteSlug", () => {
  it("parses scp-like ssh remotes", () => {
    expect(deriveRemoteSlug("git@github.com:acme/app.git")).toBe("acme/app");
    expect(deriveRemoteSlug("git@github.com:acme/app")).toBe("acme/app");
  });

  it("parses https remotes with and without the .git suffix", () => {
    expect(deriveRemoteSlug("https://github.com/acme/app.git")).toBe("acme/app");
    expect(deriveRemoteSlug("https://github.com/acme/app")).toBe("acme/app");
    expect(deriveRemoteSlug("https://github.com/acme/app/")).toBe("acme/app");
  });

  it("parses ssh:// remotes", () => {
    expect(deriveRemoteSlug("ssh://git@github.com/acme/app.git")).toBe("acme/app");
    expect(deriveRemoteSlug("ssh://git@self-hosted.example.com:2222/acme/app")).toBe("acme/app");
  });

  it("keeps only the last two segments of a nested namespace", () => {
    expect(deriveRemoteSlug("https://gitlab.com/group/subgroup/app.git")).toBe("subgroup/app");
    expect(deriveRemoteSlug("git@gitlab.com:group/subgroup/app.git")).toBe("subgroup/app");
  });

  it("trims surrounding whitespace", () => {
    expect(deriveRemoteSlug("  https://github.com/acme/app.git  ")).toBe("acme/app");
  });

  it("returns null when there is no slug to derive", () => {
    expect(deriveRemoteSlug(null)).toBeNull();
    expect(deriveRemoteSlug("")).toBeNull();
    expect(deriveRemoteSlug("   ")).toBeNull();
    expect(deriveRemoteSlug("https://github.com/app.git")).toBeNull();
    expect(deriveRemoteSlug("/local/path/to/repo")).toBeNull();
    expect(deriveRemoteSlug("not-a-remote")).toBeNull();
  });
});
