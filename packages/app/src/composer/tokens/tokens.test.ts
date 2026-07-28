import { describe, expect, it } from "vitest";

import { DEFAULT_COMPOSER_SIGILS } from "./sigils";
import {
  collectComposerTokens,
  collectSubmittedComposerTokens,
  getComposerTokenDisplayText,
  normalizeComposerTokensForSubmission,
  segmentComposerText,
} from "./tokens";

const sigils = DEFAULT_COMPOSER_SIGILS;

describe("collectComposerTokens", () => {
  it("finds a skill token mid-sentence", () => {
    expect(collectComposerTokens("please run $release-beta now", sigils)).toEqual([
      { type: "skill", name: "release-beta", start: 11, end: 24 },
    ]);
  });

  it("finds a command token only at the start of the prompt", () => {
    expect(collectComposerTokens("/review", sigils)).toEqual([
      { type: "command", name: "review", start: 0, end: 7 },
    ]);
    expect(collectComposerTokens("first\n/review", sigils)).toEqual([
      { type: "skill", name: "review", start: 6, end: 13 },
    ]);
  });

  it("treats the command trigger as a skill trigger inline", () => {
    expect(collectComposerTokens("and/or, read a/b", sigils)).toEqual([]);
    expect(collectComposerTokens("use /review here", sigils)).toEqual([
      { type: "skill", name: "review", start: 4, end: 11 },
    ]);
  });

  it("does not treat slash-delimited paths as tokens", () => {
    expect(collectComposerTokens("read /tmp/project", sigils)).toEqual([]);
  });

  it("ignores a skill sigil glued to a preceding word", () => {
    expect(collectComposerTokens("cost is 40$usd", sigils)).toEqual([]);
  });

  it("ignores a bare sigil with no name", () => {
    expect(collectComposerTokens("$ / $1 /2", sigils)).toEqual([]);
  });

  it("collects several tokens in one draft", () => {
    const text = "/plan then $release-beta and $release-stable";
    expect(collectComposerTokens(text, sigils).map((token) => token.name)).toEqual([
      "plan",
      "release-beta",
      "release-stable",
    ]);
  });

  it("follows remapped sigils", () => {
    const remapped = { command: "!", skill: "#" } as const;
    expect(collectComposerTokens("!plan and #release-beta", remapped).map((t) => t.name)).toEqual([
      "plan",
      "release-beta",
    ]);
    // The defaults carry no meaning once remapped away.
    expect(collectComposerTokens("/plan and $release-beta", remapped)).toEqual([]);
  });

  it("stops a name at the first character outside the token charset", () => {
    expect(collectComposerTokens("$release-beta, then", sigils)).toEqual([
      { type: "skill", name: "release-beta", start: 0, end: 13 },
    ]);
  });
});

describe("normalizeComposerTokensForSubmission", () => {
  it("converts the dedicated skill trigger to the provider-compatible slash form", () => {
    expect(normalizeComposerTokensForSubmission("please run $release-beta", sigils)).toBe(
      "please run /release-beta",
    );
  });

  it("normalizes remapped command and skill triggers", () => {
    const remapped = { command: "!", skill: "#" } as const;
    expect(normalizeComposerTokensForSubmission("!plan then #release-beta", remapped)).toBe(
      "/plan then /release-beta",
    );
  });

  it("leaves ordinary prose, prices, and paths unchanged", () => {
    expect(
      normalizeComposerTokensForSubmission("important! cost 40$usd; read /tmp/project", sigils),
    ).toBe("important! cost 40$usd; read /tmp/project");
  });
});

describe("submitted composer token presentation", () => {
  it("recovers command and skill tokens from canonical slash syntax", () => {
    expect(collectSubmittedComposerTokens("/plan then /release-beta")).toEqual([
      { type: "command", name: "plan", start: 0, end: 5 },
      { type: "skill", name: "release-beta", start: 11, end: 24 },
    ]);
  });

  it("maps canonical tokens back to the active display sigils", () => {
    const remapped = { command: "#", skill: "!" } as const;
    expect(getComposerTokenDisplayText({ type: "command", name: "plan" }, remapped)).toBe("#plan");
    expect(getComposerTokenDisplayText({ type: "skill", name: "release-beta" }, remapped)).toBe(
      "!release-beta",
    );
  });

  it("keeps paths and ordinary slash prose out of sent-message pills", () => {
    expect(collectSubmittedComposerTokens("read /tmp/project and/or continue")).toEqual([]);
  });
});

describe("segmentComposerText", () => {
  it("covers the whole string in order", () => {
    const text = "please run $release-beta now";
    const segments = segmentComposerText(text, collectComposerTokens(text, sigils));

    expect(segments).toEqual([
      { kind: "text", text: "please run ", start: 0 },
      {
        kind: "token",
        text: "$release-beta",
        start: 11,
        token: { type: "skill", name: "release-beta", start: 11, end: 24 },
      },
      { kind: "text", text: " now", start: 24 },
    ]);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
  });

  it("returns a single text segment when there are no tokens", () => {
    expect(segmentComposerText("plain draft", [])).toEqual([
      { kind: "text", text: "plain draft", start: 0 },
    ]);
  });

  it("returns nothing for an empty draft", () => {
    expect(segmentComposerText("", [])).toEqual([]);
  });

  it("keeps adjacent tokens contiguous", () => {
    const text = "$one $two";
    const segments = segmentComposerText(text, collectComposerTokens(text, sigils));
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
  });
});
