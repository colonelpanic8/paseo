import { describe, expect, it } from "vitest";
import { matchLinkAssistant } from "@/live-voice/live-voice-link-assistant";

const assistants = [
  { id: "ast_" + "a".repeat(32), name: "Chief of staff" },
  { id: "ast_" + "b".repeat(32), name: "Reviewer" },
  { id: "ast_" + "c".repeat(32), name: "reviewer" },
];

describe("matchLinkAssistant", () => {
  it("matches an id exactly", () => {
    expect(matchLinkAssistant(assistants, assistants[1].id)).toBe(assistants[1].id);
  });

  it("matches a unique name regardless of case and padding", () => {
    expect(matchLinkAssistant(assistants, "  chief OF staff ")).toBe(assistants[0].id);
  });

  it("refuses an ambiguous name instead of picking one", () => {
    expect(matchLinkAssistant(assistants, "Reviewer")).toBeNull();
  });

  it("returns null for an empty or unknown reference", () => {
    expect(matchLinkAssistant(assistants, "")).toBeNull();
    expect(matchLinkAssistant(assistants, "Nobody")).toBeNull();
  });
});
