import { describe, expect, it } from "vitest";
import { paseoDarkTint, paseoLightTint } from "@/styles/theme";
import { materialDarkTint, materialLightTint } from "./material-tint";
import type { DynamicColorPalette } from "./palette";
import { contrastRatio, pin, tone } from "./tone";

// Android's ladder, shaped like a real one: thirteen tones of a single hue. These are the
// Android 12 defaults for a blue-ish wallpaper, which is enough to exercise the bracketing.
function ladder(entries: Record<number, string>) {
  return new Map(Object.entries(entries).map(([rung, hex]) => [Number(rung), hex]));
}

const PALETTE: DynamicColorPalette = {
  neutral1: ladder({
    100: "#ffffff",
    99: "#fffbff",
    95: "#f4eeff",
    90: "#e5e0ec",
    80: "#c9c5d0",
    70: "#adaab4",
    60: "#928f9a",
    50: "#787680",
    40: "#5f5d67",
    30: "#47464f",
    20: "#313036",
    10: "#1c1b1f",
    0: "#000000",
  }),
  neutral2: ladder({
    100: "#ffffff",
    99: "#fffbff",
    95: "#f5eefa",
    90: "#e7e0ec",
    80: "#cac4d0",
    70: "#aea9b4",
    60: "#938f99",
    50: "#79747e",
    40: "#605d66",
    30: "#49454e",
    20: "#322f37",
    10: "#1d1a22",
    0: "#000000",
  }),
  accent1: ladder({
    100: "#ffffff",
    99: "#fffbff",
    95: "#f6eeff",
    90: "#eaddff",
    80: "#d0bcff",
    70: "#b69df8",
    60: "#9a82db",
    50: "#7f67be",
    40: "#6750a4",
    30: "#4f378b",
    20: "#381e72",
    10: "#21005d",
    0: "#000000",
  }),
};

const SURFACES = ["surface0", "surface1", "surface2", "surface3", "surface4"] as const;

// Rounding a pinned color back to 8-bit channels moves it by up to about a tenth of a tone.
// A quarter tone is a comfortable bound and still four times finer than the eye resolves.
function expectSameTone(actual: string, expected: string) {
  expect(Math.abs(tone(actual) - tone(expected))).toBeLessThan(0.25);
}

describe("pin", () => {
  it("lands on the reference's lightness, not the nearest rung", () => {
    // #1E2120 sits between the ladder's tone 10 and tone 20, which is exactly the case that
    // makes a naive nearest-tone mapping collapse Paseo's surface steps.
    const pinned = pin(PALETTE.neutral1, paseoDarkTint.surface1);
    expectSameTone(pinned, paseoDarkTint.surface1);
    expect(pinned).not.toBe("#1c1b1f");
    expect(pinned).not.toBe("#313036");
  });

  it("clamps to the ladder ends rather than extrapolating", () => {
    expect(pin(PALETTE.neutral1, "#ffffff")).toBe("#ffffff");
    expect(pin(PALETTE.neutral1, "#000000")).toBe("#000000");
  });
});

describe("materialDarkTint", () => {
  const tint = materialDarkTint(PALETTE);

  it("keeps the authored surface ladder's spacing", () => {
    for (const key of SURFACES) {
      expectSameTone(tint[key], paseoDarkTint[key]);
    }
  });

  it("takes hue from the wallpaper", () => {
    expect(tint.surface2).not.toBe(paseoDarkTint.surface2);
    expect(tint.accent).not.toBe(paseoDarkTint.accent);
  });

  it("keeps accent text legible on the wallpaper accent", () => {
    expect(contrastRatio(tint.accent, tint.accentForeground ?? "#ffffff")).toBeGreaterThan(4.5);
  });
});

describe("materialLightTint", () => {
  const tint = materialLightTint(PALETTE);

  it("keeps the authored light surfaces' lightness", () => {
    for (const key of SURFACES) {
      expectSameTone(tint[key], paseoLightTint[key]);
    }
  });

  it("keeps body text at the authored contrast against the app background", () => {
    const authored = contrastRatio(paseoLightTint.foreground, paseoLightTint.surface0);
    expect(contrastRatio(tint.foreground, tint.surface0)).toBeCloseTo(authored, 1);
  });
});
