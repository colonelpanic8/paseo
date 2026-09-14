import { paseoDarkTint } from "@/styles/theme";
import { readDynamicColorPalette } from "./palette";
import { pin } from "./tone";

/**
 * The picker swatch for Material You. Read live rather than taken from `THEME_SWATCHES`,
 * because the whole point of the option is that its color is the user's, not ours.
 */
export function dynamicAccentSwatch(): string | null {
  const palette = readDynamicColorPalette();
  return palette ? pin(palette.accent1, paseoDarkTint.accent) : null;
}
