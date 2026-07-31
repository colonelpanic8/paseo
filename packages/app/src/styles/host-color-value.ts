/**
 * Custom host colors are stored as hex, and hex — unlike the palette keys — carries
 * no scheme-aware shading of its own. A color picked against the dark sidebar can
 * vanish against the light one, so nothing renders the stored value directly:
 * every surface resolves it against the background it will actually sit on. Hue and
 * saturation survive untouched; only lightness moves, and only far enough to clear a
 * contrast floor. A color the user picks therefore still looks like the color they
 * picked in both schemes.
 */

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

// WCAG minimums: 4.5:1 against the small text a host label renders at, 3:1 for dots
// and swatches, which are non-text UI.
const TEXT_MIN_CONTRAST = 4.5;
const FILL_MIN_CONTRAST = 3;
const LIGHTNESS_STEP = 0.01;

interface Rgb {
  /** Channels are 0..1, not 0..255: every downstream formula wants them normalized. */
  r: number;
  g: number;
  b: number;
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

/** Accepts `#rgb`/`#rrggbb` with or without the hash; returns lowercase `#rrggbb`. */
export function normalizeHexColor(value: string): string | null {
  const match = HEX_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }
  const digits = match[1].toLowerCase();
  if (digits.length === 3) {
    return `#${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}`;
  }
  return `#${digits}`;
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_PATTERN.test(value.trim());
}

function parseHex(hex: string): Rgb | null {
  const normalized = normalizeHexColor(hex);
  if (!normalized) {
    return null;
  }
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16) / 255,
    g: Number.parseInt(normalized.slice(3, 5), 16) / 255,
    b: Number.parseInt(normalized.slice(5, 7), 16) / 255,
  };
}

function formatHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const delta = max - min;
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === r) {
    h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
  } else if (max === g) {
    h = ((b - r) / delta + 2) / 6;
  } else {
    h = ((r - g) / delta + 4) / 6;
  }
  return { h, s, l };
}

function hueToChannel(p: number, q: number, t: number): number {
  let shifted = t;
  if (shifted < 0) shifted += 1;
  if (shifted > 1) shifted -= 1;
  if (shifted < 1 / 6) return p + (q - p) * 6 * shifted;
  if (shifted < 1 / 2) return q;
  if (shifted < 2 / 3) return p + (q - p) * (2 / 3 - shifted) * 6;
  return p;
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  if (s === 0) {
    return { r: l, g: l, b: l };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hueToChannel(p, q, h + 1 / 3),
    g: hueToChannel(p, q, h),
    b: hueToChannel(p, q, h - 1 / 3),
  };
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const linearize = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

export function contrastRatio(left: Rgb, right: Rgb): number {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

// Resolution walks a fixed lightness ladder per (color, background, floor), and the
// sidebar asks for the same handful of combinations on every row of every render.
// Cache the answer rather than re-deriving it thousands of times.
const resolvedCache = new Map<string, string>();
const RESOLVED_CACHE_LIMIT = 512;

function cacheResolved(key: string, value: string): string {
  if (resolvedCache.size >= RESOLVED_CACHE_LIMIT) {
    resolvedCache.clear();
  }
  resolvedCache.set(key, value);
  return value;
}

/**
 * The nearest shade of `hex` that clears `minContrast` against `backgroundHex`.
 *
 * Lightness is searched outward from where the user put it, so a color that already
 * reads well comes back untouched and one that doesn't moves the minimum distance —
 * darkening on a pale background, lightening on a dark one, whichever wins first.
 */
function resolveAgainstBackground(hex: string, backgroundHex: string, minContrast: number): string {
  const key = `${hex}|${backgroundHex}|${minContrast}`;
  const cached = resolvedCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const rgb = parseHex(hex);
  const background = parseHex(backgroundHex);
  // A malformed value is the caller's problem to validate; rendering it unchanged
  // beats throwing inside a style factory.
  if (!rgb || !background) {
    return hex;
  }
  if (contrastRatio(rgb, background) >= minContrast) {
    return cacheResolved(key, formatHex(rgb));
  }

  const { h, s, l } = rgbToHsl(rgb);
  for (let delta = LIGHTNESS_STEP; delta <= 1; delta += LIGHTNESS_STEP) {
    // Both directions at each distance, so the search returns the closest shade
    // rather than committing to darker-or-lighter up front.
    for (const candidateLightness of [l - delta, l + delta]) {
      if (candidateLightness < 0 || candidateLightness > 1) {
        continue;
      }
      const candidate = hslToRgb({ h, s, l: candidateLightness });
      if (contrastRatio(candidate, background) >= minContrast) {
        return cacheResolved(key, formatHex(candidate));
      }
    }
  }

  // Nothing on the ladder cleared the floor (a mid-grey background has no hue that
  // can): fall back to whichever extreme reads best.
  const black: Rgb = { r: 0, g: 0, b: 0 };
  const white: Rgb = { r: 1, g: 1, b: 1 };
  const fallback =
    contrastRatio(black, background) >= contrastRatio(white, background) ? black : white;
  return cacheResolved(key, formatHex(fallback));
}

/** Legible-as-small-text shade of a custom host color. */
export function resolveHostTextColor(hex: string, backgroundHex: string): string {
  return resolveAgainstBackground(hex, backgroundHex, TEXT_MIN_CONTRAST);
}

/** Visible-as-a-dot shade of a custom host color. */
export function resolveHostFillColor(hex: string, backgroundHex: string): string {
  return resolveAgainstBackground(hex, backgroundHex, FILL_MIN_CONTRAST);
}
