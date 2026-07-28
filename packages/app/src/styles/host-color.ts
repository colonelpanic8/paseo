import { StyleSheet } from "react-native-unistyles";
import type { HostColorKey } from "@/types/host-connection";

/**
 * Host colors are stored as palette keys, so every surface resolves them here.
 *
 * Fills use the 500 step the status dots already use. Text uses the darker step
 * on light schemes, where 500 on a pale sidebar reads too faint — the same
 * scheme-aware treatment the synced-status loader uses for amber.
 */
export const hostColorStyles = StyleSheet.create((theme) => ({
  fillBlue: { backgroundColor: theme.colors.palette.blue[500] },
  fillGreen: { backgroundColor: theme.colors.palette.green[500] },
  fillAmber: { backgroundColor: theme.colors.palette.amber[500] },
  fillOrange: { backgroundColor: theme.colors.palette.orange[500] },
  fillRed: { backgroundColor: theme.colors.palette.red[500] },
  fillPurple: { backgroundColor: theme.colors.palette.purple[500] },
  textBlue: {
    color:
      theme.colorScheme === "light"
        ? theme.colors.palette.blue[600]
        : theme.colors.palette.blue[500],
  },
  textGreen: {
    color:
      theme.colorScheme === "light"
        ? theme.colors.palette.green[600]
        : theme.colors.palette.green[500],
  },
  textAmber: {
    color:
      theme.colorScheme === "light"
        ? theme.colors.palette.amber[700]
        : theme.colors.palette.amber[500],
  },
  textOrange: {
    color:
      theme.colorScheme === "light"
        ? theme.colors.palette.orange[600]
        : theme.colors.palette.orange[500],
  },
  textRed: {
    color:
      theme.colorScheme === "light" ? theme.colors.palette.red[600] : theme.colors.palette.red[500],
  },
  textPurple: {
    color:
      theme.colorScheme === "light"
        ? theme.colors.palette.purple[600]
        : theme.colors.palette.purple[500],
  },
}));

// Read at render time, never at module scope: Unistyles styles must not be
// materialized into module-level constants.
export function getHostColorFillStyle(color: HostColorKey) {
  switch (color) {
    case "blue":
      return hostColorStyles.fillBlue;
    case "green":
      return hostColorStyles.fillGreen;
    case "amber":
      return hostColorStyles.fillAmber;
    case "orange":
      return hostColorStyles.fillOrange;
    case "red":
      return hostColorStyles.fillRed;
    case "purple":
      return hostColorStyles.fillPurple;
  }
}

export function getHostColorTextStyle(color: HostColorKey | null | undefined) {
  switch (color) {
    case "blue":
      return hostColorStyles.textBlue;
    case "green":
      return hostColorStyles.textGreen;
    case "amber":
      return hostColorStyles.textAmber;
    case "orange":
      return hostColorStyles.textOrange;
    case "red":
      return hostColorStyles.textRed;
    case "purple":
      return hostColorStyles.textPurple;
    default:
      return null;
  }
}
