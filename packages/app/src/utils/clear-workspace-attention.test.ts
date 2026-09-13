import { describe, expect, it } from "vitest";
import { hasClearableWorkspaceAttention } from "./clear-workspace-attention";

describe("hasClearableWorkspaceAttention", () => {
  it("allows dismissal while another agent keeps the workspace running", () => {
    expect(
      hasClearableWorkspaceAttention({ workspaceStatus: "running", readyToReview: true }),
    ).toBe(true);
  });

  it("does not offer dismissal for ordinary running or done workspaces", () => {
    expect(
      hasClearableWorkspaceAttention({ workspaceStatus: "running", readyToReview: false }),
    ).toBe(false);
    expect(hasClearableWorkspaceAttention({ workspaceStatus: "done", readyToReview: false })).toBe(
      false,
    );
  });
});
