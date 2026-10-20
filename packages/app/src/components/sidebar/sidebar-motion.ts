import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { LayoutChangeEvent, ViewStyle } from "react-native";
import {
  Easing,
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { isWeb } from "@/constants/platform";

// Sidebar row motion. Archiving plays as two independent animations in
// sequence, never as one hand-off choreography: first the row collapses out of
// the list while it still owns its slot (useArchiveCollapse, run before the
// optimistic removal), then the archived tail fades in on its own. Rows
// intentionally have NO Reanimated `exiting` animation: the web backend pins
// the exiting clone at coordinates that end up riding the sibling sliding into
// the gap, so an unmount-time exit fade renders as a double-image. Collapsing
// before removal keeps the exit fully in our control, and by the time the row
// is unmounted its box is already zero-height, so the removal is invisible.
// The tail keeps an unmount exit fade because nothing slides underneath it.
//
// A view must NEVER be resized by a *layout transition*, only moved. The web
// backend implements LinearTransition as a translate+scale keyframe on the
// element (reanimated's Linear.web.ts), so a container that renders at a new
// size visibly squishes everything inside it — a group wrapper that shrinks
// when one of its rows is archived drags its own heading through a scale
// animation even though the heading's final position never moved. The sidebar
// therefore renders headings, rows, and show-more toggles as fixed-size
// siblings in one flat flow (group "containers" are fragments, not views) so
// every layout transition is a pure translation. Invisible boxes (spacers, the
// pinned section wrapper) may resize and snap freely; only visible elements
// need an animated wrapper, and each animates its own movement.
//
// Resizing a box from an animated style is a different thing and is allowed:
// those writes never pass through a React commit, so no snapshot is taken and
// no scale keyframe is generated (useArchiveCollapse relies on this).
//
// Curves are spelled as explicit beziers: the web backend silently downgrades
// anything that isn't a plain bezier to CSS "ease", which would fork web and
// native behavior.

/** Standard settle curve for every sibling shift in the sidebar. */
const settleEasing = Easing.bezier(0.4, 0, 0.2, 1);
/** Decelerate-into-place curve for arrivals. */
const arriveEasing = Easing.bezier(0.17, 0.67, 0.35, 1);

function buildSidebarListSettle() {
  return LinearTransition.duration(240).easing(settleEasing);
}

/** The one slide shared by all sidebar layout shifts, so neighbors move together. */
export const sidebarListSettle = buildSidebarListSettle();

type SidebarListSettle = typeof sidebarListSettle;

/**
 * The settle every animated wrapper in the status sidebar's flat flow passes to
 * its `layout` prop, so that a single list change moves headings, rows, and
 * toggles as one.
 *
 * It has to come through context because the web backend only runs a layout
 * transition for a component that re-rendered in the commit that moved it: it
 * snapshots the old position in `getSnapshotBeforeUpdate`, which React calls on
 * an update and never on a bail-out. Sidebar rows are memoized on their own
 * workspace, and the React Compiler memoizes the JSX above them, so a row that
 * is merely pushed along by a change elsewhere in the list does not re-render —
 * it used to jump to its new position while the headings, which re-render on
 * every projection rebuild, slid over the full 240ms. A context update reaches
 * consumers through those bail-outs, and feeding its value into `layout` is
 * what makes the memoized JSX rebuild.
 */
export const SidebarListSettleContext = createContext<SidebarListSettle>(sidebarListSettle);

/** Read by every animated wrapper inside a {@link SidebarListSettleContext}. */
export function useSidebarListSettle(): SidebarListSettle {
  return useContext(SidebarListSettleContext);
}

/**
 * Owns the value behind {@link SidebarListSettleContext}. `signature` describes
 * the order the list is about to render; a fresh settle is minted whenever it
 * changes, and only then, so rows re-render for layout changes and stay
 * memoized for everything else.
 *
 * Web only. Native runs layout animations off its own layout observer rather
 * than off React renders, so rows there already slide; handing it one settle
 * for the app's lifetime keeps it from re-registering the same config on every
 * list change.
 */
export function useSidebarListSettleValue(signature: string): SidebarListSettle {
  const current = useRef<{ signature: string; settle: SidebarListSettle } | null>(null);
  if (isWeb && (current.current === null || current.current.signature !== signature)) {
    current.current = { signature, settle: buildSidebarListSettle() };
  }
  return current.current?.settle ?? sidebarListSettle;
}

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
 * How long a row's archive collapse runs before the archive flow performs the
 * optimistic removal. use-workspace-archive waits this long after flipping the
 * row into its archiving state so the collapse finishes while the row is still
 * mounted and owns its slot.
 */
export const ARCHIVE_COLLAPSE_MS = 220;

/** Reopen when an archive fails and the row has to come back. */
const ARCHIVE_REOPEN_MS = 180;

/**
 * The row is invisible before its box is fully closed, so the last stretch of
 * the collapse is a pure gap-close with nothing left to clip. Openness (1 =
 * open, 0 = closed) drives both, which is why the fade window is expressed in
 * openness rather than in milliseconds.
 */
const FADE_OUT_OPENNESS = [0.25, 0.9];

/**
 * Inert stand-in for "no cap" once the row is open again. Reanimated's web
 * backend writes animated values straight onto the DOM node's inline style and
 * never removes them, so whatever we wrote last outlives the animation: a
 * leftover `max-height` this large does nothing, while a leftover pinned
 * `height` would freeze the row at a stale measurement.
 */
const UNCAPPED_MAX_HEIGHT = 100_000;

/** Clipping is engaged only while collapsing — see useArchiveCollapse. */
const collapseClip: ViewStyle = { overflow: "hidden" };

/**
 * Archive collapse: the row shrinks its own box from the bottom edge upward
 * while fading, so it reads as being minimized away rather than dissolving in
 * place. Because the box itself shrinks, the rows below flow into the gap in
 * real time — no layout animation is involved and no sibling has to wait for
 * the removal. Reanimated only re-triggers a layout transition when the
 * component re-renders (it snapshots position immediately before that render),
 * so the per-frame size changes here never make a neighbor animate.
 *
 * Clipping is not permanent: a dragged row lifts itself with a scale and a
 * shadow that would be cut off by an always-on `overflow: hidden`, so the clip
 * is mounted for the collapse and dropped once the row is fully open again.
 */
export function useArchiveCollapse(isArchiving: boolean) {
  const openness = useSharedValue(1);
  const openHeight = useSharedValue(0);
  // Not derived from `isArchiving`: the clip has to outlive a failed archive's
  // reopen, which ends after `isArchiving` has already gone back to false.
  const [isCollapsing, setIsCollapsing] = useState(false);

  useEffect(() => {
    if (isArchiving) {
      setIsCollapsing(true);
      openness.value = withTiming(0, { duration: ARCHIVE_COLLAPSE_MS, easing: settleEasing });
      return;
    }
    if (openness.value === 1) return;
    openness.value = withTiming(
      1,
      { duration: ARCHIVE_REOPEN_MS, easing: arriveEasing },
      (finished) => {
        if (finished) runOnJS(setIsCollapsing)(false);
      },
    );
  }, [isArchiving, openness]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      // Ignore the shrinking heights this hook is itself producing; only a
      // fully open row measures its natural height.
      if (openness.value !== 1) return;
      const { height } = event.nativeEvent.layout;
      if (height > 0) openHeight.value = height;
    },
    [openHeight, openness],
  );

  const animatedStyle = useAnimatedStyle(() => {
    const opacity = interpolate(openness.value, FADE_OUT_OPENNESS, [0, 1], Extrapolation.CLAMP);
    // An unmeasured row still has a fade to fall back on.
    const capped = openness.value < 1 && openHeight.value > 0;
    return {
      maxHeight: capped ? openHeight.value * openness.value : UNCAPPED_MAX_HEIGHT,
      opacity,
    };
  });

  return {
    onLayout,
    style: isCollapsing ? [collapseClip, animatedStyle] : animatedStyle,
  };
}
