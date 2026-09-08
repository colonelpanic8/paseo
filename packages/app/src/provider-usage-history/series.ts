import { StyleSheet } from "react-native-unistyles";
import { providerSeriesColor } from "./providers";

/**
 * The series mark next to a provider's name. Same color as that provider's
 * chart line and its mark in the tables, so one series reads as one series.
 */
export function seriesFillStyle(provider: string) {
  return provider === "claude" ? seriesStyles.claude : seriesStyles.neutral;
}

const seriesStyles = StyleSheet.create((theme) => ({
  claude: {
    backgroundColor: providerSeriesColor("claude", theme.colors.foreground),
  },
  neutral: {
    backgroundColor: theme.colors.foreground,
  },
}));
