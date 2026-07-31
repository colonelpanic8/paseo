import { StyleSheet } from "react-native-unistyles";
import { isHostColorKey, type HostColor, type HostColorKey } from "@/types/host-connection";
import { resolveHostFillColor, resolveHostTextColor } from "@/styles/host-color-value";

/**
 * Host colors are stored as palette keys or as custom hex, and every surface
 * resolves them here.
 *
 * Palette fills use the 500 step the status dots already use. Palette text uses the
 * darker step on light schemes, where 500 on a pale sidebar reads too faint — the
 * same scheme-aware treatment the synced-status loader uses for amber.
 *
 * Custom hex gets the same guarantee by computation instead of by hand: the
 * `custom*` entries are Unistyles dynamic functions, so they see both the runtime
 * color and the live theme, and re-derive a legible shade against the sidebar
 * background. Dynamic functions are what keep this off `useUnistyles()`, which is
 * banned — see docs/unistyles.md.
 */
export const hostColorStyles = StyleSheet.create((theme) => ({
  fillCustom: (hex: string) => ({
    backgroundColor: resolveHostFillColor(hex, theme.colors.surfaceSidebar),
  }),
  textCustom: (hex: string) => ({
    color: resolveHostTextColor(hex, theme.colors.surfaceSidebar),
  }),
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
export function getHostColorFillStyle(color: HostColor) {
  if (!isHostColorKey(color)) {
    return hostColorStyles.fillCustom(color);
  }
  return getPaletteFillStyle(color);
}

function getPaletteFillStyle(color: HostColorKey) {
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

export function getHostColorTextStyle(color: HostColor | null | undefined) {
  if (color == null) {
    return null;
  }
  if (!isHostColorKey(color)) {
    return hostColorStyles.textCustom(color);
  }
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
  }
}
