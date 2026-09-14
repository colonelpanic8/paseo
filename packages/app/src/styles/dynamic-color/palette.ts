import { requireOptionalNativeModule } from "expo-modules-core";
import type { ToneLadder } from "./tone";

export interface DynamicColorPalette {
  /** Surfaces, foregrounds, terminal blacks. */
  neutral1: ToneLadder;
  /** Neutral variant — borders, the tier Material spends on outlines. */
  neutral2: ToneLadder;
  /** The wallpaper accent. */
  accent1: ToneLadder;
}

const LADDER_NAMES = ["neutral1", "neutral2", "accent1"] as const;

type RawPalette = Record<(typeof LADDER_NAMES)[number], Record<string, string>>;

interface PaseoDynamicColorModule {
  getPalette(): RawPalette | null;
}

const dynamicColorModule =
  requireOptionalNativeModule<PaseoDynamicColorModule>("PaseoDynamicColor");

function toLadder(raw: Record<string, string> | undefined): ToneLadder | null {
  if (!raw) return null;
  const ladder = new Map<number, string>();
  for (const [tone, hex] of Object.entries(raw)) {
    const parsed = Number.parseInt(tone, 10);
    if (Number.isFinite(parsed)) {
      ladder.set(parsed, hex);
    }
  }
  // Two rungs is the minimum that can bracket a target lightness.
  return ladder.size >= 2 ? ladder : null;
}

/**
 * The device's wallpaper palette, or null where there is none: every non-Android platform,
 * and Android 11 and below.
 */
export function readDynamicColorPalette(): DynamicColorPalette | null {
  const raw = dynamicColorModule?.getPalette();
  if (!raw) return null;
  const neutral1 = toLadder(raw.neutral1);
  const neutral2 = toLadder(raw.neutral2);
  const accent1 = toLadder(raw.accent1);
  if (!neutral1 || !neutral2 || !accent1) return null;
  return { neutral1, neutral2, accent1 };
}

let availability: boolean | null = null;

/**
 * Whether this device can render the Material You theme. Cached: it decides whether the
 * picker offers the option at all, so it is read on render, and it cannot change without
 * an OS upgrade.
 */
export function isDynamicColorAvailable(): boolean {
  availability ??= readDynamicColorPalette() !== null;
  return availability;
}
