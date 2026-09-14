/**
 * Sampling a wallpaper tonal ladder at the lightness Paseo authored.
 *
 * Android hands us a tonal palette: one hue at thirteen fixed tones. Dropping those tones
 * straight into the theme is what makes a dynamic theme stop looking like the app it is
 * themeing — the ladder steps in tens, while Paseo's surfaces step in twos (#181B1A ->
 * #1E2120), so surface0 through surface4 come out banded and unrecognizable.
 *
 * So the wallpaper supplies hue and chroma and the authored tint supplies lightness. `pin`
 * takes a reference color from a Paseo tint and returns the ladder's color at that exact
 * lightness, interpolating between the two tones that bracket it.
 *
 * The interpolation is in linear RGB, which is what makes the match exact rather than close:
 * relative luminance is a linear function of linear RGB, so the mixing fraction that lands on
 * the target luminance is just its position between the neighbours' luminances. Matching
 * luminance is matching L*, and in Material a tone *is* L*, so the result sits on the
 * authored ladder rung with the wallpaper's hue.
 */

/** A tonal ladder: Material tone (0 black - 100 white) to hex. */
export type ToneLadder = ReadonlyMap<number, string>;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff,
  };
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(255, Math.max(0, value)))
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(channel: number): number {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return c * 255;
}

/** WCAG relative luminance. Monotonic in L*, which is why it can stand in for tone. */
export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * The Material tone of a color: CIE L*, 0 black to 100 white. Rounding a pinned color back
 * to 8-bit channels moves its luminance slightly, so this is the unit to compare in — a
 * fifth of a tone is far below the roughly one-tone step the eye can see.
 */
export function tone(hex: string): number {
  const y = luminance(hex);
  return y <= 216 / 24389 ? y * (24389 / 27) : 116 * y ** (1 / 3) - 16;
}

export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The ladder's color at `reference`'s lightness. Outside the ladder's range — a reference
 * darker or lighter than any tone the palette carries — this returns the nearest end.
 */
export function pin(ladder: ToneLadder, reference: string): string {
  const target = luminance(reference);
  const rungs = [...ladder.values()]
    .map((hex) => ({ hex, y: luminance(hex) }))
    .sort((a, b) => a.y - b.y);
  if (rungs.length === 0) return reference;

  let lower = rungs[0];
  let upper = rungs[rungs.length - 1];
  if (target <= lower.y) return lower.hex;
  if (target >= upper.y) return upper.hex;
  for (let i = 0; i < rungs.length - 1; i += 1) {
    if (rungs[i].y <= target && target <= rungs[i + 1].y) {
      lower = rungs[i];
      upper = rungs[i + 1];
      break;
    }
  }

  const span = upper.y - lower.y;
  const t = span === 0 ? 0 : (target - lower.y) / span;
  const a = parseHex(lower.hex);
  const b = parseHex(upper.hex);
  return toHex({
    r: fromLinear(toLinear(a.r) + t * (toLinear(b.r) - toLinear(a.r))),
    g: fromLinear(toLinear(a.g) + t * (toLinear(b.g) - toLinear(a.g))),
    b: fromLinear(toLinear(a.b) + t * (toLinear(b.b) - toLinear(a.b))),
  });
}

/**
 * Whichever of the two candidates reads better on `background`. The authored tints can hard-code
 * white on the accent because their accents are hand-picked; a wallpaper accent cannot.
 */
export function readableOn(background: string, candidates: readonly string[]): string {
  let best = candidates[0];
  let bestRatio = 0;
  for (const candidate of candidates) {
    const ratio = contrastRatio(background, candidate);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}
