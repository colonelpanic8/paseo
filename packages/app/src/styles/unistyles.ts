import { StyleSheet } from "react-native-unistyles";
import { REGISTERED_THEMES } from "./theme";
import { applyDynamicColor } from "./dynamic-color/apply-dynamic-color";

StyleSheet.configure({
  themes: REGISTERED_THEMES,
  breakpoints: {
    xs: 0,
    sm: 576,
    md: 720,
    lg: 992,
    xl: 1200,
  },
  settings: {
    adaptiveThemes: true,
  },
});

// The Material You pair is registered with placeholder colors, because Unistyles only
// accepts themes declared here. Patch them now, before anything renders — the read is a
// synchronous native call and a no-op off Android, and deferring it to an effect would show
// the placeholder tint first.
applyDynamicColor();

// Type augmentation for TypeScript
type AppThemes = typeof REGISTERED_THEMES;

interface AppBreakpoints {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

declare module "react-native-unistyles" {
  export interface UnistylesThemes extends AppThemes {}
  export interface UnistylesBreakpoints extends AppBreakpoints {}
}
