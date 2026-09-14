import { UnistylesRuntime } from "react-native-unistyles";
import { buildDarkSemanticColors, buildLightSemanticColors, type Theme } from "@/styles/theme";
import { materialDarkTint, materialLightTint } from "./material-tint";
import { readDynamicColorPalette } from "./palette";

let appliedSignature: string | null = null;

/**
 * Repaint the registered Material You pair from the device's current wallpaper palette.
 * Returns false where there is no palette to read.
 *
 * Ordering against `applyAppearance` is irrelevant, the same way the theme and appearance
 * effects are: both patches read the live theme and spread it, and they own disjoint fields —
 * this one the semantic colors, that one the font ramp and `colors.syntax`. This patch is also
 * idempotent, because it derives from the palette rather than from the theme it is replacing.
 *
 * Call it again on foreground: changing the wallpaper changes the palette, and nothing tells
 * us while the app is in the background.
 */
export function applyDynamicColor(): boolean {
  const palette = readDynamicColorPalette();
  if (!palette) return false;

  const darkTint = materialDarkTint(palette);
  const lightTint = materialLightTint(palette);

  // Foreground fires far more often than the wallpaper changes, and patching a registered
  // theme costs a style recompute for every mounted view using it.
  const signature = JSON.stringify([darkTint, lightTint]);
  if (signature === appliedSignature) return true;
  appliedSignature = signature;

  const darkColors = buildDarkSemanticColors(darkTint);
  const lightColors = buildLightSemanticColors(lightTint);

  // The updater is handed the union of every registered theme, so it has to narrow before it
  // can return one. Branching on the scheme is that narrowing and also the choice of tint,
  // which is why one function serves both keys.
  const patch = (t: Theme): Theme =>
    t.colorScheme === "light"
      ? { ...t, colors: { ...t.colors, ...lightColors } }
      : { ...t, colors: { ...t.colors, ...darkColors } };

  UnistylesRuntime.updateTheme("materialDark", patch);
  UnistylesRuntime.updateTheme("materialLight", patch);
  return true;
}
