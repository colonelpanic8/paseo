import { Text, View, type TextStyle, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Server } from "lucide-react-native";
import { HOST_COLORS, type HostColor } from "@/hosts/appearance";
import { identityColor, identityTint } from "@/styles/identity-colors";
import type { Theme } from "@/styles/theme";

const ThemedServer = withUnistyles(Server);

interface HostBadgeColorOverride {
  badge: ViewStyle | null;
  text: TextStyle | null;
}

// The identity table is theme-independent, so a color's overrides and its icon mapping are
// fixed for the life of the module. The icon mapping especially must not be rebuilt per
// render: a fresh `uniProps` identity makes `withUnistyles` re-subscribe every pass.
function buildColorOverrides(): Record<HostColor, HostBadgeColorOverride> {
  const byColor = {} as Record<HostColor, HostBadgeColorOverride>;
  for (const color of HOST_COLORS) {
    byColor[color] =
      color === "none"
        ? { badge: null, text: null }
        : {
            badge: { backgroundColor: identityTint(color) },
            text: { color: identityColor(color) },
          };
  }
  return byColor;
}

function buildIconMappings(): Record<HostColor, (theme: Theme) => { color: string }> {
  const byColor = {} as Record<HostColor, (theme: Theme) => { color: string }>;
  for (const color of HOST_COLORS) {
    byColor[color] =
      color === "none"
        ? (theme: Theme) => ({ color: theme.colors.foregroundMuted })
        : () => ({ color: identityColor(color) });
  }
  return byColor;
}

const COLOR_OVERRIDES = buildColorOverrides();
const ICON_MAPPINGS = buildIconMappings();

/**
 * Which host a workspace lives on, as a pill after the title. Only rendered in multi-host
 * setups — see selectHostBadges. It's a badge rather than a second line of text because the
 * row has to stay scannable at one line per workspace.
 *
 * The accessible label names the host in every mode, so the icon-only pill still announces
 * which machine the workspace is on.
 */
export function HostBadge({
  serverId,
  label,
  color,
  showLabel,
}: {
  serverId: string;
  label: string;
  color: HostColor;
  showLabel: boolean;
}) {
  const override = COLOR_OVERRIDES[color];
  return (
    <View
      style={[
        hostBadgeStyles.badge,
        showLabel ? null : hostBadgeStyles.badgeIconOnly,
        override.badge,
      ]}
      accessibilityLabel={label}
      testID={`sidebar-host-badge-${serverId}`}
    >
      <ThemedServer size={9} uniProps={ICON_MAPPINGS[color]} />
      {showLabel ? (
        <Text style={[hostBadgeStyles.text, override.text]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const hostBadgeStyles = StyleSheet.create((theme) => ({
  // Sized off the title's 20pt line box so the pill never grows the row. Fully rounded and
  // flexShrink:0 so a long workspace title truncates before the host does — the host is the
  // disambiguator, so losing it defeats the point of showing it.
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 16,
    paddingLeft: 4,
    paddingRight: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    flexShrink: 0,
  },
  // Icon-only drops the label, so the asymmetric padding that made room for text leaves a
  // lopsided pill. Symmetric padding recenters the icon.
  badgeIconOnly: {
    paddingLeft: 4,
    paddingRight: 4,
  },
  text: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
    lineHeight: 14,
    color: theme.colors.foregroundMuted,
  },
}));
