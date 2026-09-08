/**
 * Monotone cubic interpolation for the usage chart's area series.
 *
 * Ordinary cubic smoothing overshoots: a quiet day between two busy ones is
 * drawn below zero, and a spike is drawn taller than it was. The Fritsch-Carlson
 * tangent limit is what keeps the curve inside the data it was built from.
 *
 * @module curve
 */

export interface CurvePoint {
  readonly x: number;
  readonly y: number;
}

export interface CurveSegment {
  readonly from: CurvePoint;
  readonly c1: CurvePoint;
  readonly c2: CurvePoint;
  readonly to: CurvePoint;
}

/** The straight-line slope between each pair of neighbouring points. */
function secantSlopes(points: readonly CurvePoint[]): number[] {
  const slopes: number[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const dx = (points[index + 1]?.x ?? 0) - (points[index]?.x ?? 0);
    const dy = (points[index + 1]?.y ?? 0) - (points[index]?.y ?? 0);
    slopes.push(dx === 0 ? 0 : dy / dx);
  }
  return slopes;
}

function averagedTangents(slopes: readonly number[], count: number): number[] {
  const tangents: number[] = Array.from({ length: count }, () => 0);
  tangents[0] = slopes[0] ?? 0;
  tangents[count - 1] = slopes[count - 2] ?? 0;
  for (let index = 1; index < count - 1; index += 1) {
    const previous = slopes[index - 1] ?? 0;
    const next = slopes[index] ?? 0;
    // A local extremum gets a flat tangent, which is what stops the overshoot.
    tangents[index] = previous * next <= 0 ? 0 : (previous + next) / 2;
  }
  return tangents;
}

/** Fritsch-Carlson: pull any tangent pair back inside the circle of radius 3. */
function limitTangents(tangents: number[], slopes: readonly number[]): void {
  for (let index = 0; index < slopes.length; index += 1) {
    const slope = slopes[index] ?? 0;
    if (slope === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const a = (tangents[index] ?? 0) / slope;
    const b = (tangents[index + 1] ?? 0) / slope;
    const magnitude = a * a + b * b;
    if (magnitude > 9) {
      const scale = 3 / Math.sqrt(magnitude);
      tangents[index] = scale * a * slope;
      tangents[index + 1] = scale * b * slope;
    }
  }
}

/** Shape-preserving cubic tangents that cannot overshoot spiky usage data. */
export function monotoneTangents(points: readonly CurvePoint[]): readonly number[] {
  if (points.length < 2) return [0];

  const slopes = secantSlopes(points);
  const tangents = averagedTangents(slopes, points.length);
  limitTangents(tangents, slopes);
  return tangents;
}

export function smoothCurve(points: readonly CurvePoint[]): readonly CurveSegment[] {
  if (points.length < 2) return [];
  const tangents = monotoneTangents(points);
  const segments: CurveSegment[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (from === undefined || to === undefined) continue;
    const dx = to.x - from.x;
    segments.push({
      from,
      c1: { x: from.x + dx / 3, y: from.y + ((tangents[index] ?? 0) * dx) / 3 },
      c2: { x: to.x - dx / 3, y: to.y - ((tangents[index + 1] ?? 0) * dx) / 3 },
      to,
    });
  }
  return segments;
}

export function curvePath(segments: readonly CurveSegment[]): string {
  const first = segments[0];
  if (first === undefined) return "";
  let path = `M${first.from.x.toFixed(2)},${first.from.y.toFixed(2)}`;
  for (const segment of segments) {
    path += ` C${segment.c1.x.toFixed(2)},${segment.c1.y.toFixed(2)} ${segment.c2.x.toFixed(2)},${segment.c2.y.toFixed(2)} ${segment.to.x.toFixed(2)},${segment.to.y.toFixed(2)}`;
  }
  return path;
}
