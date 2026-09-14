import { describe, expect, it } from "vitest";
import { isDynamicColorAvailable, readDynamicColorPalette } from "./palette";

// Every platform but Android is this case, and so is Android 11 and below. The picker entry
// and the cycle shortcut are both gated on it, so "absent" has to mean null and not a throw.
describe("without the native module", () => {
  it("reports no palette", () => {
    expect(readDynamicColorPalette()).toBeNull();
    expect(isDynamicColorAvailable()).toBe(false);
  });
});
