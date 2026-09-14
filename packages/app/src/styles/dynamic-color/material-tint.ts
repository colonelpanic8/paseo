import {
  paseoDarkTint,
  paseoLightTint,
  type DarkThemeConfig,
  type LightThemeConfig,
} from "@/styles/theme";
import type { DynamicColorPalette } from "./palette";
import { pin, readableOn } from "./tone";

// Material You does not supply an error color — M3 fixes its error palette rather than
// deriving it from the wallpaper — so neither do we. These are the neutral reds the Zinc and
// light tints use, the two that read as red without leaning on a known surface hue.
const DYNAMIC_DARK_DESTRUCTIVE = "#c44a4a";
const DYNAMIC_LIGHT_DESTRUCTIVE = "#b04138";

/**
 * The wallpaper palette as a Paseo tint. Every value is the wallpaper's hue at the lightness
 * the authored tint uses, so the surface ladder keeps its authored spacing and the status
 * families keep the contrast they were generated against. See tone.ts.
 *
 * Which ladder feeds which token follows Material: surfaces and foregrounds come from the
 * neutral ladder, outlines from the neutral variant, accents from the accent ladder.
 */
export function materialDarkTint(palette: DynamicColorPalette): DarkThemeConfig {
  const { neutral1, neutral2, accent1 } = palette;
  const accent = pin(accent1, paseoDarkTint.accent);
  return {
    surface0: pin(neutral1, paseoDarkTint.surface0),
    surface1: pin(neutral1, paseoDarkTint.surface1),
    surface2: pin(neutral1, paseoDarkTint.surface2),
    surface3: pin(neutral1, paseoDarkTint.surface3),
    surface4: pin(neutral1, paseoDarkTint.surface4),
    surfaceDiffEmpty: pin(neutral1, paseoDarkTint.surfaceDiffEmpty),
    surfaceSidebar: pin(neutral1, paseoDarkTint.surfaceSidebar),
    foregroundMuted: pin(neutral1, paseoDarkTint.foregroundMuted),
    foregroundExtraMuted: pin(neutral1, paseoDarkTint.foregroundExtraMuted),
    border: pin(neutral2, paseoDarkTint.border),
    borderAccent: pin(neutral2, paseoDarkTint.borderAccent),
    accent,
    accentBright: pin(accent1, paseoDarkTint.accentBright),
    accentForeground: readableOn(accent, ["#ffffff", pin(accent1, "#1a1a1e")]),
    destructive: DYNAMIC_DARK_DESTRUCTIVE,
    terminalBlack: pin(neutral1, paseoDarkTint.terminalBlack),
    terminalBrightBlack: pin(neutral1, paseoDarkTint.terminalBrightBlack),
  };
}

export function materialLightTint(palette: DynamicColorPalette): LightThemeConfig {
  const { neutral1, neutral2, accent1 } = palette;
  const accent = pin(accent1, paseoLightTint.accent);
  return {
    surface0: pin(neutral1, paseoLightTint.surface0),
    surface1: pin(neutral1, paseoLightTint.surface1),
    surface2: pin(neutral1, paseoLightTint.surface2),
    surface3: pin(neutral1, paseoLightTint.surface3),
    surface4: pin(neutral1, paseoLightTint.surface4),
    surfaceDiffEmpty: pin(neutral1, paseoLightTint.surfaceDiffEmpty),
    surfaceSidebar: pin(neutral1, paseoLightTint.surfaceSidebar),
    foreground: pin(neutral1, paseoLightTint.foreground),
    foregroundMuted: pin(neutral1, paseoLightTint.foregroundMuted),
    foregroundExtraMuted: pin(neutral1, paseoLightTint.foregroundExtraMuted),
    border: pin(neutral2, paseoLightTint.border),
    borderAccent: pin(neutral2, paseoLightTint.borderAccent),
    accent,
    accentBright: pin(accent1, paseoLightTint.accentBright),
    accentForeground: readableOn(accent, ["#ffffff", pin(accent1, "#1a1a1e")]),
    primary: pin(neutral1, paseoLightTint.primary),
    primaryForeground: pin(neutral1, paseoLightTint.primaryForeground),
    destructive: DYNAMIC_LIGHT_DESTRUCTIVE,
    terminalBlack: pin(neutral1, paseoLightTint.terminalBlack),
    terminalBrightBlack: pin(neutral1, paseoLightTint.terminalBrightBlack),
    ring: pin(neutral1, paseoLightTint.ring),
  };
}
