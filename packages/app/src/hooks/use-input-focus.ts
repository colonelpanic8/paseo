import { useEffect, type RefObject } from "react";
import { focusWithRetries } from "@/utils/web-focus";

interface FocusableInput {
  focus(): void;
  isFocused(): boolean;
}

/** Focus the input each time `active` turns on, retrying through presentation animations. */
export function useInputFocus(ref: RefObject<FocusableInput | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return focusWithRetries({
      focus: () => ref.current?.focus(),
      isFocused: () => ref.current?.isFocused() ?? false,
    });
  }, [active, ref]);
}
