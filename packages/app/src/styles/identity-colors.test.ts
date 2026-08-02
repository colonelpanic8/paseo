import { describe, expect, it } from "vitest";
import {
  IDENTITY_COLOR_NAMES,
  deriveIdentityColorName,
  identityColor,
  identityTint,
} from "@/styles/identity-colors";

describe("identity colors", () => {
  it("keeps ten colors so existing derived assignments stay put", () => {
    expect(IDENTITY_COLOR_NAMES.length).toBe(10);
  });

  it("derives the same color a project key had before the palette moved", () => {
    expect(identityColor(deriveIdentityColorName("paseo"))).toBe("#368080");
    expect(identityColor(deriveIdentityColorName("my-project"))).toBe("#7a6aa8");
    expect(identityColor(deriveIdentityColorName("a"))).toBe("#b06260");
  });

  it("tints a color to ten percent alpha", () => {
    expect(identityTint("teal")).toBe("#3680801a");
  });
});
