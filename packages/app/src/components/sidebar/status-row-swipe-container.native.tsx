import { useCallback, useEffect, useRef } from "react";
import { Pressable, StyleSheet as RNStyleSheet, Text } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Archive } from "lucide-react-native";
import { BORDER_RADIUS, type Theme } from "@/styles/theme";
import type { StatusRowSwipeContainerProps } from "./status-row-swipe-container.types";

export type { StatusRowSwipeContainerProps };

const ARCHIVE_ACTION_WIDTH = 92;
const ARCHIVE_ICON_SIZE = 18;
// Past this much drag the row snaps open instead of springing back.
const ARCHIVE_OPEN_THRESHOLD = ARCHIVE_ACTION_WIDTH / 2;

const destructiveForegroundMapping = (theme: Theme) => ({
  color: theme.colors.destructiveForeground,
});

const ThemedArchive = withUnistyles(Archive);

/**
 * Native rows swipe left to reveal Archive. The action calls the row's existing
 * archive handler, so the dirty-worktree confirm still runs after the swipe.
 *
 * Gesture composition: the swipeable's pan declares `blocksExternalGesture` on
 * the compact sidebar's drawer-close pan, so a horizontal drag that starts on a
 * row is owned by the row and never half-drags the drawer. The drawer still
 * closes from every other part of the sidebar. Vertical drags never reach the
 * swipeable — its pan only activates past a horizontal offset, so the enclosing
 * scroll view claims them first, which is the standard swipeable-in-a-list
 * arbitration and needs no extra relation.
 */
export function StatusRowSwipeContainer({
  archiveLabel,
  onArchive,
  isArchiving,
  parentGestureRef,
  children,
}: StatusRowSwipeContainerProps) {
  const swipeableRef = useRef<SwipeableMethods | null>(null);

  // Covers both archive paths: immediate, and after the dirty-worktree confirm
  // resolves. Either way the revealed action is put away once work starts.
  useEffect(() => {
    if (isArchiving) {
      swipeableRef.current?.close();
    }
  }, [isArchiving]);

  const handleArchivePress = useCallback(() => {
    swipeableRef.current?.close();
    onArchive?.();
  }, [onArchive]);

  const renderRightActions = useCallback(
    () => <StatusRowArchiveAction label={archiveLabel} onPress={handleArchivePress} />,
    [archiveLabel, handleArchivePress],
  );

  if (!onArchive) {
    return children;
  }

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      enabled={!isArchiving}
      friction={2}
      rightThreshold={ARCHIVE_OPEN_THRESHOLD}
      overshootRight={false}
      containerStyle={reanimatedNodeStyles.container}
      renderRightActions={renderRightActions}
      blocksExternalGesture={parentGestureRef}
      testID="sidebar-status-row-swipe"
    >
      {children}
    </ReanimatedSwipeable>
  );
}

function StatusRowArchiveAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      style={styles.action}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID="sidebar-status-row-swipe-archive"
    >
      <ThemedArchive size={ARCHIVE_ICON_SIZE} uniProps={destructiveForegroundMapping} />
      <Text style={styles.actionLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

// The swipeable container is a Reanimated node, so it gets a plain React Native
// style with a static token instead of a Unistyles style: Unistyles and
// Reanimated patching the same Fabric node has crashed natively before
// (docs/mobile-panels.md). The swipeable already clips to this container, so the
// radius is what keeps the red underlay inside the row's rounded box.
const reanimatedNodeStyles = RNStyleSheet.create({
  container: {
    borderRadius: BORDER_RADIUS.lg,
  },
});

const styles = StyleSheet.create((theme) => ({
  action: {
    width: ARCHIVE_ACTION_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
    backgroundColor: theme.colors.destructive,
  },
  actionLabel: {
    color: theme.colors.destructiveForeground,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.normal,
  },
}));
