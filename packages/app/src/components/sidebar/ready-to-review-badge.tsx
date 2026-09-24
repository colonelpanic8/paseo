import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  makeMutable,
  useAnimatedStyle,
  useReducedMotion,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useRetainedPanelActive } from "@/components/retained-panel";

const PULSE_PERIOD_MS = 1_400;
const pulseClock = makeMutable(0);
let pulseClockSubscribers = 0;

function acquirePulseClock(): void {
  pulseClockSubscribers += 1;
  if (pulseClockSubscribers > 1) return;
  pulseClock.value = 0;
  pulseClock.value = withRepeat(
    withTiming(1, { duration: PULSE_PERIOD_MS, easing: Easing.out(Easing.quad) }),
    -1,
    false,
  );
}

function releasePulseClock(): void {
  pulseClockSubscribers -= 1;
  if (pulseClockSubscribers > 0) return;
  cancelAnimation(pulseClock);
  pulseClock.value = 0;
}

export function ReadyToReviewBadge() {
  const active = useRetainedPanelActive();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!active || reduceMotion) return;
    acquirePulseClock();
    return releasePulseClock;
  }, [active, reduceMotion]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulseClock.value, [0, 1], [0.65, 0]),
    transform: [{ scale: interpolate(pulseClock.value, [0, 1], [0.65, 1.4]) }],
  }));

  return (
    <View
      accessibilityLabel="Ready to review"
      role="status"
      style={styles.badge}
      testID="ready-to-review-badge"
    >
      <Animated.View
        style={[styles.pulse, reduceMotion ? styles.reducedMotionPulse : pulseStyle]}
      />
      <View style={styles.dot} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  badge: {
    width: 12,
    height: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  pulse: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusDotRunning,
  },
  reducedMotionPulse: {
    opacity: 0.25,
    transform: [{ scale: 1 }],
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusDotRunning,
  },
}));
