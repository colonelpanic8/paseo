import { useEffect } from "react";
import {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

// Sidebar row motion. Archiving plays as two independent animations in
// sequence, never as one hand-off choreography: first the row fades out while
// it still owns its slot (useArchiveDismissStyle, run before the optimistic
// removal), then the list closes the gap and the archived tail fades in on its
// own. Rows intentionally have NO Reanimated `exiting` animation: the web
// backend pins the exiting clone at coordinates that end up riding the sibling
// sliding into the gap, so an unmount-time exit fade renders as a
// double-image. Fading before removal keeps the exit fully in our control.
// The tail keeps an unmount exit fade because nothing slides underneath it.
//
// A layout-animated view must NEVER change its own size, only its position.
// The web backend implements LinearTransition as a translate+scale keyframe on
// the element (reanimated's Linear.web.ts), so a resizing animated container
// visibly squishes everything inside it — a group wrapper that shrinks when
// one of its rows is archived drags its own heading through a scale animation
// even though the heading's final position never moved. The sidebar therefore
// renders headings, rows, and show-more toggles as fixed-size siblings in one
// flat flow (group "containers" are fragments, not views) so every layout
// transition is a pure translation. Invisible boxes (spacers, the pinned
// section wrapper) may resize and snap freely; only visible elements need an
// animated wrapper, and each animates its own movement.
//
// Curves are spelled as explicit beziers: the web backend silently downgrades
// anything that isn't a plain bezier to CSS "ease", which would fork web and
// native behavior.

/** Standard settle curve for every sibling shift in the sidebar. */
const settleEasing = Easing.bezier(0.4, 0, 0.2, 1);
/** Decelerate-into-place curve for arrivals. */
const arriveEasing = Easing.bezier(0.17, 0.67, 0.35, 1);

/** The one slide shared by all sidebar layout shifts, so neighbors move together. */
export const sidebarListSettle = LinearTransition.duration(240).easing(settleEasing);

/** Rows fading in where they land (unarchive restore, status-bucket moves). */
export const sidebarRowEnter = FadeIn.duration(200).easing(arriveEasing);

/**
 * Arrival in the recently-archived tail. Plain fade, no translate and no
 * delay: entering animations attach one frame after first paint on web, so a
 * delayed or translated entrance reads as a blink/jump at the final position
 * before the animation takes over.
 */
export const archivedRowEnter = FadeIn.duration(220).easing(arriveEasing);

/** Exit fade for the archived tail, where nothing slides under the clone. */
export const archivedRowExit = FadeOut.duration(160);

/**
 * How long a row's dismissal fade runs before the archive flow performs the
 * optimistic removal. use-workspace-archive waits this long after flipping the
 * row into its archiving state so the fade finishes while the row is mounted.
 */
export const ARCHIVE_DISMISS_MS = 180;

/** Mounted-row dismissal fade, driven by the row's archiving state. */
export function useArchiveDismissStyle(isArchiving: boolean) {
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withTiming(isArchiving ? 0 : 1, { duration: ARCHIVE_DISMISS_MS });
  }, [isArchiving, opacity]);
  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}
