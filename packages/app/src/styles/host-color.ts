import { StyleSheet } from "react-native-unistyles";
import type { HostColor } from "@/hosts/appearance";
import { resolveHostTextColor } from "@/styles/host-color-value";
import { identityColor } from "@/styles/identity-colors";

/**
 * Identity colors are single hex values tuned for a white glyph on a filled square,
 * not for text on the sidebar background. Rendering them as text goes through
 * `resolveHostTextColor`, which re-derives lightness against the sidebar surface so
 * the same stored color stays legible in both schemes.
 *
 * The resolver runs inside a Unistyles dynamic function so it sees the live theme —
 * this keeps it off `useUnistyles()`, which is banned; see docs/unistyles.md.
 */
const hostColorStyles = StyleSheet.create((theme) => ({
  text: (hex: string) => ({
    color: resolveHostTextColor(hex, theme.colors.surfaceSidebar),
  }),
}));

// Read at render time, never at module scope: Unistyles styles must not be
// materialized into module-level constants.
export function getHostColorTextStyle(color: HostColor | null | undefined) {
  if (color == null || color === "none") {
    return null;
  }
  return hostColorStyles.text(identityColor(color));
}
