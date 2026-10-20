import { describe, expect, it } from "vitest";
import { buildAgentPurposePresentation } from "./agent-purpose-presentation";

describe("buildAgentPurposePresentation", () => {
  it("uses the summary in pane chrome and keeps the model detail in the tooltip", () => {
    expect(
      buildAgentPurposePresentation({
        label: "Agent summaries",
        summary: "Propagating summaries through app state",
        fallback: "Codex · GPT-6 Sol · High",
      }),
    ).toEqual({
      subtitle: "Propagating summaries through app state",
      tooltip: "Agent summaries\nPropagating summaries through app state\nCodex · GPT-6 Sol · High",
    });
  });

  it("falls back to the model subtitle when no summary is available", () => {
    expect(
      buildAgentPurposePresentation({
        label: "Agent summaries",
        summary: null,
        fallback: "Codex · GPT-6 Sol · High",
      }),
    ).toEqual({
      subtitle: "Codex · GPT-6 Sol · High",
      tooltip: "Agent summaries\nCodex · GPT-6 Sol · High",
    });
  });

  it("omits a generic provider subtitle from the tooltip", () => {
    expect(
      buildAgentPurposePresentation({
        label: "Agent summaries",
        summary: "Propagating summaries through app state",
        fallback: "Codex agent",
      }),
    ).toEqual({
      subtitle: "Propagating summaries through app state",
      tooltip: "Agent summaries\nPropagating summaries through app state",
    });
  });
});
