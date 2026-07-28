import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useShowControlShortcutBadges } from "@/hooks/use-show-shortcut-badges";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { Shortcut } from "@/components/ui/shortcut";

interface ShortcutHintProps {
  actionId: string;
  enabled?: boolean;
}

export function ShortcutHint({ actionId, enabled = true }: ShortcutHintProps) {
  const showShortcutBadges = useShowControlShortcutBadges();
  const shortcutKeys = useShortcutKeys(actionId);

  if (!enabled || !showShortcutBadges || !shortcutKeys) {
    return null;
  }

  return (
    <View
      style={styles.overlay}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Shortcut
        chord={shortcutKeys}
        compactModifiers
        style={styles.shortcut}
        textStyle={styles.shortcutText}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  overlay: {
    position: "absolute",
    top: "100%",
    right: 0,
    left: 0,
    zIndex: 20,
    alignItems: "center",
    marginTop: 2,
  },
  shortcut: {
    paddingHorizontal: theme.spacing[1.5],
    backgroundColor: theme.colors.popover,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    ...theme.shadow.md,
  },
  shortcutText: {
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
    letterSpacing: 0.5,
  },
}));
