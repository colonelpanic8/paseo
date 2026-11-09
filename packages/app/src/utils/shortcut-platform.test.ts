import { afterEach, describe, expect, it } from "vitest";
import { useShortcutModStore } from "@/stores/shortcut-mod-store";
import { getShortcutOs } from "./shortcut-platform";

describe("getShortcutOs", () => {
  afterEach(() => useShortcutModStore.setState({ preference: "auto" }));

  it("uses the Cmd binding set when the modifier preference is Cmd", () => {
    useShortcutModStore.getState().setPreference("cmd");
    expect(getShortcutOs()).toBe("mac");
  });

  it("uses the Ctrl binding set when the modifier preference is Ctrl", () => {
    useShortcutModStore.getState().setPreference("ctrl");
    expect(getShortcutOs()).toBe("non-mac");
  });
});
