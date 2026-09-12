import { describe, expect, it } from "vitest";
import {
  curvePath,
  monotoneTangents,
  seriesLinePath,
  smoothCurve,
  stepPath,
  type CurvePoint,
} from "./curve";

function points(values: readonly number[]): CurvePoint[] {
  return values.map((y, x) => ({ x, y }));
}

/** Samples the cubic at `t` in [0, 1], which is where an overshoot shows up. */
function sampleY(
  segment: { from: CurvePoint; c1: CurvePoint; c2: CurvePoint; to: CurvePoint },
  t: number,
) {
  const inverse = 1 - t;
  return (
    inverse ** 3 * segment.from.y +
    3 * inverse ** 2 * t * segment.c1.y +
    3 * inverse * t ** 2 * segment.c2.y +
    t ** 3 * segment.to.y
  );
}

describe("monotoneTangents", () => {
  it("flattens a series that never moves", () => {
    expect(monotoneTangents(points([4, 4, 4, 4]))).toEqual([0, 0, 0, 0]);
  });

  it("flattens the tangent at a peak, which is what stops the overshoot", () => {
    const tangents = monotoneTangents(points([0, 10, 0]));
    expect(tangents[1]).toBe(0);
  });
});

describe("smoothCurve", () => {
  it("keeps a spike inside the values it was built from", () => {
    // Screen coordinates: a peak is the *smallest* y, so overshooting draws
    // above the plot.
    const segments = smoothCurve(points([100, 100, 20, 100, 100]));
    const samples: number[] = [];
    for (const segment of segments) {
      for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) samples.push(sampleY(segment, t));
    }

    expect(Math.min(...samples)).toBeGreaterThanOrEqual(20);
    expect(Math.max(...samples)).toBeLessThanOrEqual(100);
  });

  it("has no segment to draw for a single day", () => {
    expect(smoothCurve(points([5]))).toEqual([]);
    expect(curvePath([])).toBe("");
  });
});

describe("stepPath", () => {
  it("changes value halfway between days, where the hover strips meet", () => {
    expect(
      stepPath([
        { x: 0, y: 100 },
        { x: 10, y: 20 },
        { x: 20, y: 60 },
      ]),
    ).toBe("M0.00,100.00 L5.00,100.00 L5.00,20.00 L15.00,20.00 L15.00,60.00 L20.00,60.00");
  });

  it("has nothing to draw for a single day", () => {
    expect(stepPath([{ x: 0, y: 5 }])).toBe("");
  });
});

describe("seriesLinePath", () => {
  it("joins recorded values with the selected shape", () => {
    const spike = points([0, 9, 0]);
    expect(seriesLinePath(spike, "linear")).toBe("M0.00,0.00 L1.00,9.00 L2.00,0.00");
    expect(seriesLinePath(spike, "step")).toBe(
      "M0.00,0.00 L0.50,0.00 L0.50,9.00 L1.50,9.00 L1.50,0.00 L2.00,0.00",
    );
    expect(seriesLinePath(spike, "smooth")).toBe(
      "M0.00,0.00 C0.33,3.00 0.67,9.00 1.00,9.00 C1.33,9.00 1.67,3.00 2.00,0.00",
    );
  });

  it.each(["smooth", "linear", "step"] as const)(
    "omits empty and single-point %s lines",
    (shape) => {
      expect(seriesLinePath([], shape)).toBe("");
      expect(seriesLinePath(points([5]), shape)).toBe("");
    },
  );
});
