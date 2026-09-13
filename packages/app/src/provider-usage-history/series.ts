import { StyleSheet } from "react-native-unistyles";
import { providerSeriesColor } from "./providers";

/** Provider brand marks in the summary below the grouped chart. */
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
