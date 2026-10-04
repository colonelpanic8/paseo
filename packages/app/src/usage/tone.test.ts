import { describe, expect, it } from "vitest";
import { windowBarTone } from "./tone";

describe("usage window bar tone", () => {
  it("uses green for remaining capacity even when usage is at risk", () => {
    expect(
      windowBarTone({ id: "session", label: "Session", usedPct: 95, tone: "danger" }, "remaining"),
    ).toBe("ok");
  });

  it("uses consumption risk tone when displaying used percentage", () => {
    expect(windowBarTone({ id: "session", label: "Session", usedPct: 95 }, "used")).toBe("danger");
  });
});
