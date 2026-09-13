import type { StatusRowSwipeContainerProps } from "./status-row-swipe-container.types";

export type { StatusRowSwipeContainerProps };

/**
 * Web (and any non-native platform) keeps the hover Archive action, so the row
 * renders unwrapped. Metro loads `status-row-swipe-container.native.tsx` on
 * iOS/Android, where the row becomes swipeable; none of that code, and none of
 * the gesture-handler swipeable module, reaches the web bundle.
 */
export function StatusRowSwipeContainer({ children }: StatusRowSwipeContainerProps) {
  return children;
}
