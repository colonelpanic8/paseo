import { describe, expect, it } from "vitest";
import { DEFAULT_REPO_URL, formatBuildStamp, resolveBuildInfo } from "./build-info";

const COMMIT = "0de4589d2d677bde7ef2f54343ed47b6f7f66151";

describe("resolveBuildInfo", () => {
  it("returns null when there is no commit to link to", () => {
    expect(resolveBuildInfo(null)).toBeNull();
    expect(resolveBuildInfo(undefined)).toBeNull();
    expect(resolveBuildInfo({ commit: "   " })).toBeNull();
  });

  it("links a commit against the default repository when none is reported", () => {
    const build = resolveBuildInfo({ commit: COMMIT });
    expect(build?.commitUrl).toBe(`${DEFAULT_REPO_URL}/commit/${COMMIT}`);
    expect(build?.shortCommit).toBe("0de4589d2");
  });

  it("links against the repository the build reports", () => {
    const build = resolveBuildInfo({
      commit: COMMIT,
      repoUrl: "https://github.com/colonelpanic8/paseo",
    });
    expect(build?.commitUrl).toBe(`https://github.com/colonelpanic8/paseo/commit/${COMMIT}`);
  });

  it("normalizes trailing slashes and .git suffixes so URLs stay clickable", () => {
    expect(
      resolveBuildInfo({ commit: COMMIT, repoUrl: "https://github.com/a/b.git" })?.commitUrl,
    ).toBe(`https://github.com/a/b/commit/${COMMIT}`);
    expect(
      resolveBuildInfo({ commit: COMMIT, repoUrl: "https://github.com/a/b/" })?.commitUrl,
    ).toBe(`https://github.com/a/b/commit/${COMMIT}`);
  });

  it("keeps the commit usable when the date is missing or unparseable", () => {
    expect(resolveBuildInfo({ commit: COMMIT })?.commitDate).toBeNull();
    expect(resolveBuildInfo({ commit: COMMIT, commitDate: "not a date" })?.commitDate).toBeNull();
  });

  it("parses an ISO-8601 commit date", () => {
    const build = resolveBuildInfo({ commit: COMMIT, commitDate: "2026-07-28T12:34:56Z" });
    expect(build?.commitDate?.toISOString()).toBe("2026-07-28T12:34:56.000Z");
  });

  it("carries the commit message through, dropping blank ones", () => {
    expect(
      resolveBuildInfo({ commit: COMMIT, commitMessage: "Fix the frobnicator" })?.commitMessage,
    ).toBe("Fix the frobnicator");
    expect(resolveBuildInfo({ commit: COMMIT, commitMessage: "   " })?.commitMessage).toBeNull();
    expect(resolveBuildInfo({ commit: COMMIT })?.commitMessage).toBeNull();
  });
});

describe("formatBuildStamp", () => {
  it("falls back to the bare commit when there is no date", () => {
    const build = resolveBuildInfo({ commit: COMMIT })!;
    expect(formatBuildStamp(build, "en-US")).toBe("0de4589d2");
  });

  it("pairs the commit with its date", () => {
    const build = resolveBuildInfo({ commit: COMMIT, commitDate: "2026-07-28T12:34:56Z" })!;
    expect(formatBuildStamp(build, "en-US")).toContain("0de4589d2 · ");
    expect(formatBuildStamp(build, "en-US")).toContain("2026");
  });
});
