import { StyleSheet } from "react-native-unistyles";

/**
 * Series marks for the chart bars and the summary/table provider dots.
 *
 * `accent` is the active theme's hue and `foregroundMuted` its neutral. Both are
 * already tuned to sit on every surface in light and dark, so the two series
 * stay separable without inventing chart-only colors. A third provider would
 * cycle the pair; the contract ships two.
 */
export function seriesFillStyle(index: number) {
  return index % 2 === 0 ? seriesStyles.primary : seriesStyles.secondary;
}

const seriesStyles = StyleSheet.create((theme) => ({
  primary: {
    backgroundColor: theme.colors.accent,
  },
  secondary: {
    backgroundColor: theme.colors.foregroundMuted,
  },
}));
