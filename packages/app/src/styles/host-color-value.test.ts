import { describe, expect, it } from "vitest";
import {
  isHexColor,
  normalizeHexColor,
  resolveHostFillColor,
  resolveHostTextColor,
} from "./host-color-value";

// The two sidebar backgrounds a host color actually lands on.
const LIGHT_SIDEBAR = "#f4f4f5";
const DARK_SIDEBAR = "#1c2120";

function parse(hex: string): { r: number; g: number; b: number } {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16) / 255,
    g: Number.parseInt(hex.slice(3, 5), 16) / 255,
    b: Number.parseInt(hex.slice(5, 7), 16) / 255,
  };
}

function luminance(hex: string): number {
  const { r, g, b } = parse(hex);
  const linearize = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

function contrast(left: string, right: string): number {
  const a = luminance(left);
  const b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function hue(hex: string): number {
  const { r, g, b } = parse(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const delta = max - min;
  if (max === r) return (((g - b) / delta + (g < b ? 6 : 0)) / 6) * 360;
  if (max === g) return (((b - r) / delta + 2) / 6) * 360;
  return (((r - g) / delta + 4) / 6) * 360;
}

describe("normalizeHexColor", () => {
  it("canonicalizes accepted spellings to lowercase #rrggbb", () => {
    expect(normalizeHexColor("#4F46E5")).toBe("#4f46e5");
    expect(normalizeHexColor("4f46e5")).toBe("#4f46e5");
    expect(normalizeHexColor("  #ABC  ")).toBe("#aabbcc");
  });

  it("rejects anything that is not a hex color", () => {
    expect(normalizeHexColor("#ab")).toBeNull();
    expect(normalizeHexColor("#abcd")).toBeNull();
    expect(normalizeHexColor("rebeccapurple")).toBeNull();
    expect(normalizeHexColor("#12345g")).toBeNull();
    expect(normalizeHexColor("")).toBeNull();
  });

  it("agrees with isHexColor", () => {
    expect(isHexColor("#4f46e5")).toBe(true);
    expect(isHexColor("#ab")).toBe(false);
    expect(isHexColor(null)).toBe(false);
    expect(isHexColor(42)).toBe(false);
  });
});

describe("host color resolution", () => {
  it("leaves a color that already reads well untouched", () => {
    // A mid indigo already clears 4.5:1 on the light sidebar.
    expect(resolveHostTextColor("#4f46e5", LIGHT_SIDEBAR)).toBe("#4f46e5");
  });

  it("darkens a pale color until it is legible on the light sidebar", () => {
    const resolved = resolveHostTextColor("#fef08a", LIGHT_SIDEBAR);
    expect(contrast(resolved, LIGHT_SIDEBAR)).toBeGreaterThanOrEqual(4.5);
    expect(luminance(resolved)).toBeLessThan(luminance("#fef08a"));
  });

  it("lightens a dark color until it is legible on the dark sidebar", () => {
    const resolved = resolveHostTextColor("#1e1b4b", DARK_SIDEBAR);
    expect(contrast(resolved, DARK_SIDEBAR)).toBeGreaterThanOrEqual(4.5);
    expect(luminance(resolved)).toBeGreaterThan(luminance("#1e1b4b"));
  });

  it("keeps the hue the user picked while moving lightness", () => {
    const source = "#fef08a";
    const resolved = resolveHostTextColor(source, LIGHT_SIDEBAR);
    expect(resolved).not.toBe(source);
    expect(Math.abs(hue(resolved) - hue(source))).toBeLessThan(1);
  });

  it("holds the text floor for every scheme and every hue", () => {
    for (const background of [LIGHT_SIDEBAR, DARK_SIDEBAR]) {
      for (let h = 0; h < 360; h += 15) {
        for (const lightness of [10, 50, 90]) {
          const source = hslHex(h, 70, lightness);
          const resolved = resolveHostTextColor(source, background);
          expect(contrast(resolved, background)).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("holds the looser fill floor, which keeps fills closer to the picked color", () => {
    const source = "#fef08a";
    const fill = resolveHostFillColor(source, LIGHT_SIDEBAR);
    const text = resolveHostTextColor(source, LIGHT_SIDEBAR);
    expect(contrast(fill, LIGHT_SIDEBAR)).toBeGreaterThanOrEqual(3);
    expect(luminance(fill)).toBeGreaterThan(luminance(text));
  });

  it("resolves pure white and pure black against both schemes", () => {
    for (const background of [LIGHT_SIDEBAR, DARK_SIDEBAR]) {
      for (const source of ["#ffffff", "#000000"]) {
        expect(
          contrast(resolveHostTextColor(source, background), background),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("returns a malformed value unchanged rather than throwing inside a style factory", () => {
    expect(resolveHostTextColor("nope", LIGHT_SIDEBAR)).toBe("nope");
    expect(resolveHostTextColor("#4f46e5", "nope")).toBe("#4f46e5");
  });
});

function hslHex(h: number, s: number, l: number): string {
  const saturation = s / 100;
  const lightness = l / 100;
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - c / 2;
  const [r, g, b] = pickChannels(h, c, x);
  const channel = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function pickChannels(h: number, c: number, x: number): [number, number, number] {
  if (h < 60) return [c, x, 0];
  if (h < 120) return [x, c, 0];
  if (h < 180) return [0, c, x];
  if (h < 240) return [0, x, c];
  if (h < 300) return [x, 0, c];
  return [c, 0, x];
}
