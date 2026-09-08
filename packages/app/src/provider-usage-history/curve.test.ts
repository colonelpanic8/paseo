import { describe, expect, it } from "vitest";
import { curvePath, monotoneTangents, smoothCurve, type CurvePoint } from "./curve";

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
