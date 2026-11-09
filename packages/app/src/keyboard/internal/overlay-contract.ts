import type { RefObject } from "react";
import type { KeyboardInputEvent } from "./overlays";
export interface OverlayRegistration {
  active: boolean;
  layer: number;
  keys: readonly string[];
  onKeyDown(event: KeyboardInputEvent): boolean;
  /** Pass refused keys to the overlay beneath instead of swallowing them. */
  transparent?: boolean;
  restoreFocusRef?: RefObject<unknown>;
  manageFocus?: boolean;
}
