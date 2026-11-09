import { useOverlayRegistration } from "@/keyboard";
import { isNative } from "@/constants/platform";
import { useCurrentOverlayLayer } from "@/lib/overlay-root";
import {
  resolveListSearchKeyAction,
  type ListSearchKeyAction,
  type ListSearchKeyEvent,
} from "@/keyboard/list-search-keys";

const LIST_SEARCH_KEYS = ["ArrowUp", "ArrowDown", "Enter"] as const;

/**
 * Routes a hardware keyboard's list keys (arrows, Enter, Ctrl+N/P) to a native list search.
 * Declaring the keys lets the native source take them before the focused text field edits.
 * The handler sits one layer above the surface that hosts it, so it outranks that surface's own
 * overlay while anything opened over it still wins; keys it refuses, such as Escape, reach that
 * surface. Web routes these keys through the DOM.
 */
export function useListSearchHandler(input: {
  active: boolean;
  handle(action: ListSearchKeyAction, event: ListSearchKeyEvent): boolean;
}): void {
  const layer = useCurrentOverlayLayer() + 1;
  useOverlayRegistration({
    active: isNative && input.active,
    layer,
    keys: LIST_SEARCH_KEYS,
    transparent: true,
    manageFocus: false,
    onKeyDown(event) {
      const action = resolveListSearchKeyAction(event);
      return action !== null && input.handle(action, event);
    },
  });
}
