import { describe, expect, it } from "vitest";
import {
  BUILD_COMMIT_DATE_ENV_VAR,
  BUILD_COMMIT_ENV_VAR,
  BUILD_REPO_URL_ENV_VAR,
  resolveBuildInfo,
} from "./build-info.js";

const COMMIT = "0de4589d2d677bde7ef2f54343ed47b6f7f66151";

describe("resolveBuildInfo", () => {
  it("reports nothing when the build was not stamped", () => {
    expect(resolveBuildInfo({})).toBeNull();
  });

  it("reports nothing when only a date or repo was stamped", () => {
    expect(
      resolveBuildInfo({
        [BUILD_COMMIT_DATE_ENV_VAR]: "2026-07-28T12:34:56Z",
        [BUILD_REPO_URL_ENV_VAR]: "https://github.com/colonelpanic8/paseo",
      }),
    ).toBeNull();
  });

  it("ignores an empty commit left by an unset wrapper variable", () => {
    expect(resolveBuildInfo({ [BUILD_COMMIT_ENV_VAR]: "  " })).toBeNull();
  });

  it("reports the stamped commit", () => {
    expect(
      resolveBuildInfo({
        [BUILD_COMMIT_ENV_VAR]: COMMIT,
        [BUILD_COMMIT_DATE_ENV_VAR]: "2026-07-28T12:34:56Z",
        [BUILD_REPO_URL_ENV_VAR]: "https://github.com/colonelpanic8/paseo",
      }),
    ).toEqual({
      commit: COMMIT,
      commitDate: "2026-07-28T12:34:56Z",
      repoUrl: "https://github.com/colonelpanic8/paseo",
    });
  });

  it("keeps a commit that was stamped without a date or repo", () => {
    expect(resolveBuildInfo({ [BUILD_COMMIT_ENV_VAR]: COMMIT })).toEqual({
      commit: COMMIT,
      commitDate: null,
      repoUrl: null,
    });
  });
});
