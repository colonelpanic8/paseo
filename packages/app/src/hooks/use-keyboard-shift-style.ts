import { createElement, useEffect, useMemo, type ReactNode } from "react";
import { Platform } from "react-native";
import type { ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useGenericKeyboardHandler,
  useReanimatedKeyboardAnimation,
} from "react-native-keyboard-controller";
import {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import {
  DEFAULT_IOS_KEYBOARD_INSET_MIN_HEIGHT,
  resolveKeyboardShift,
} from "@/hooks/keyboard-shift-policy";
import { KeyboardShiftContext, useKeyboardShift } from "@/hooks/keyboard-shift-context";
import { useScreenBottomInset } from "@/hooks/use-screen-bottom-inset";

type KeyboardShiftMode = "translate" | "padding";

export function KeyboardShiftProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const { height: keyboardHeight, progress: keyboardProgress } = useReanimatedKeyboardAnimation();
  const bottomInset = useSharedValue(insets.bottom);
  const isIos = Platform.OS === "ios";

  useEffect(() => {
    bottomInset.value = insets.bottom;
  }, [bottomInset, insets.bottom]);

  useGenericKeyboardHandler(
    {
      onEnd: (event) => {
        "worklet";
        if (isIos) {
          keyboardHeight.value = -event.height;
          keyboardProgress.value = event.progress;
        }
      },
    },
    [isIos, keyboardHeight, keyboardProgress],
  );

  const shift = useDerivedValue(() => {
    "worklet";
    return resolveKeyboardShift({
      rawKeyboardHeight: Math.abs(keyboardHeight.value),
      keyboardProgress: keyboardProgress.value,
      bottomInset: bottomInset.value,
      isIos,
      iosMinHeight: DEFAULT_IOS_KEYBOARD_INSET_MIN_HEIGHT,
    });
  });

  const value = useMemo(
    () => ({
      shift,
      bottomInset,
    }),
    [bottomInset, shift],
  );

  return createElement(KeyboardShiftContext.Provider, { value }, children);
}

export function useKeyboardShiftStyle(input: { mode: KeyboardShiftMode; enabled?: boolean }): {
  shift: SharedValue<number>;
  style: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
} {
  const { shift } = useKeyboardShift();
  const mode = input.mode;
  const enabled = input.enabled ?? true;

  // Padding mode pads for the home indicator itself, so it uses the screen inset,
  // which collapses when the Live Voice strip already owns the bottom edge. The
  // shift below keeps using root insets: keyboard geometry is window-relative.
  const screenBottomInset = useScreenBottomInset();
  const screenBottomInsetValue = useSharedValue(screenBottomInset);

  useEffect(() => {
    screenBottomInsetValue.value = screenBottomInset;
  }, [screenBottomInsetValue, screenBottomInset]);

  const style = useAnimatedStyle<ViewStyle>(() => {
    "worklet";
    if (mode === "padding") {
      if (!enabled) {
        return { paddingBottom: 0 };
      }
      // Include safe-area bottom inset so content clears the home indicator even without a keyboard.
      return { paddingBottom: screenBottomInsetValue.value + shift.value };
    }

    return { transform: [{ translateY: enabled ? -shift.value : 0 }] };
  }, [enabled, mode]);

  return { shift, style };
}
