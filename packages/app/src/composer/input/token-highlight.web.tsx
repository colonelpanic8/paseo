/**
 * Composer token pills — web.
 *
 * A mirror layer sits directly behind the composer's `<textarea>`, rendering the
 * same string with command/skill tokens wrapped in rounded pills. The textarea
 * paints its own text transparent, so the mirror is what the user reads while the
 * textarea still owns the caret, selection, IME and the native context menu.
 *
 * THE INVARIANT: the mirror must lay out character-for-character identically to
 * the textarea, or the pills drift away from the caret. That has two
 * consequences, both load-bearing:
 *
 *  1. Every font/box property that affects line breaking is copied from the live
 *     textarea (see COPIED_STYLES) rather than restated in a stylesheet. A
 *     stylesheet drifts out of sync; a copy cannot.
 *  2. A pill may not change the advance width of the text it decorates. Its
 *     horizontal padding is cancelled by an equal negative margin, so the pill
 *     grows *visually* around the glyphs without moving them. This is also why
 *     the pill shows the literal token text (`$release-beta`) rather than an icon
 *     plus a prettified display name — either would add width and desynchronise
 *     the wrap. The upside is that what you read is exactly what gets sent.
 *
 * Theme colors arrive as props through `withUnistyles` (alternative 3 in
 * docs/unistyles.md) because this component draws raw DOM rather than `style`-tracked
 * RN views, so only the wrapper re-renders on a theme change. Do NOT reach for
 * `var(--colors-*)` here: nothing in Unistyles emits those variables.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { withUnistyles } from "react-native-unistyles";
import {
  collectComposerTokens,
  getComposerTokenDisplayText,
  segmentComposerText,
} from "@/composer/tokens/tokens";
import type { Theme } from "@/styles/theme";
import type { ComposerTokenHighlightProps } from "./token-highlight-types";

export type { ComposerTokenHighlightProps };

interface ThemedProps extends Omit<ComposerTokenHighlightProps, "textareaRef"> {
  textareaRef: RefObject<HTMLElement | null>;
  /** The theme's accent-as-text token — the same one markdown links use. */
  accentBrightColor: string;
  foregroundColor: string;
}

const COPIED_STYLES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "fontStretch",
  "fontKerning",
  "fontFeatureSettings",
  "fontOpticalSizing",
  "fontVariationSettings",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "textTransform",
  "textIndent",
  "whiteSpace",
  "wordWrap",
  "overflowWrap",
  "wordBreak",
  "tabSize",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "direction",
  "textAlign",
  "textRendering",
] as const;

type CopiedStyle = (typeof COPIED_STYLES)[number];

const SELECTION_STYLE_ID = "paseo-composer-token-selection";
let installedSelectionColor: string | null = null;

/**
 * The textarea sits above the mirror, so its selection rectangle would paint over
 * the glyphs the mirror is drawing. A translucent selection lets them read
 * through — without this, selecting tokenised text blanks it out.
 *
 * `::selection` cannot be expressed inline, so the rule is injected and rewritten
 * whenever the theme's accent changes.
 */
function installSelectionStyles(accentBrightColor: string): void {
  if (typeof document === "undefined" || installedSelectionColor === accentBrightColor) {
    return;
  }
  const style = document.getElementById(SELECTION_STYLE_ID) ?? document.createElement("style");
  style.id = SELECTION_STYLE_ID;
  style.textContent = `
[data-composer-tokenized]::selection {
  background: color-mix(in srgb, ${accentBrightColor} 35%, transparent);
  color: transparent;
}
`;
  if (!style.isConnected) {
    document.head.append(style);
  }
  installedSelectionColor = accentBrightColor;
}

/**
 * Mirror the textarea's computed layout styles into React style props.
 *
 * Re-read whenever the element's box or style attributes change: the composer's
 * font size is user-configurable and its width changes with the panel layout. A
 * stale copy surfaces as misaligned pills rather than as an error.
 */
function useMirroredStyles(
  textareaRef: RefObject<HTMLElement | null>,
  enabled: boolean,
): CSSProperties {
  // Values come straight off `getComputedStyle`, so they are strings rather than
  // the narrow literal unions CSSProperties declares for keywords like
  // `direction`. The browser produced them, so they are valid by construction.
  const [styles, setStyles] = useState<CSSProperties>({});
  const previousRef = useRef("");

  useEffect(() => {
    const source = textareaRef.current;
    if (
      !enabled ||
      !source ||
      typeof window === "undefined" ||
      !(source instanceof window.HTMLElement)
    ) {
      return;
    }

    const read = () => {
      const computed = window.getComputedStyle(source);
      const next: Partial<Record<CopiedStyle, string>> = {};
      for (const property of COPIED_STYLES) {
        next[property] = computed[property];
      }
      const signature = JSON.stringify(next);
      if (signature === previousRef.current) {
        return;
      }
      previousRef.current = signature;
      setStyles(next as CSSProperties);
    };

    read();

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    resizeObserver?.observe(source);

    const mutationObserver =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(read);
    mutationObserver?.observe(source, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [textareaRef, enabled]);

  return styles;
}

/**
 * Tint and text both derive from `accentBright`, not `accent`. `accent` is the dark
 * fill green: a 30% tint of it under foreground-colored text goes muddy on dark and
 * harsh on light. Keeping fill, border and text on one bright hue reads as a single
 * quiet object in both themes.
 */
function pillStyle(accentBrightColor: string): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${accentBrightColor} 14%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${accentBrightColor} 30%, transparent)`,
    color: accentBrightColor,
    borderRadius: 6,
    // Padding grows the pill; the matching negative margin gives the width back, so
    // glyph positions are untouched. Never change one without the other.
    padding: "2px 4px",
    margin: "0 -4px",
  };
}

function ComposerTokenHighlight({
  enabled,
  value,
  sigils,
  tokenCatalog,
  textareaRef,
  accentBrightColor,
  foregroundColor,
}: ThemedProps) {
  const mirroredStyles = useMirroredStyles(textareaRef, enabled);
  const scrollLayerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    installSelectionStyles(accentBrightColor);
  }, [enabled, accentBrightColor]);

  useEffect(() => {
    const source = textareaRef.current;
    const scrollLayer = scrollLayerRef.current;
    if (!enabled || !source || !scrollLayer) {
      return;
    }

    const syncScroll = () => {
      scrollLayer.style.transform = `translateY(${-source.scrollTop}px)`;
    };
    syncScroll();
    source.addEventListener("scroll", syncScroll, { passive: true });
    return () => source.removeEventListener("scroll", syncScroll);
  }, [enabled, textareaRef]);

  const segments = useMemo(
    () => (enabled ? segmentComposerText(value, collectComposerTokens(value, tokenCatalog)) : []),
    [enabled, value, tokenCatalog],
  );

  const containerStyle = useMemo<CSSProperties>(
    () => ({
      ...mirroredStyles,
      position: "absolute",
      inset: 0,
      overflow: "hidden",
      pointerEvents: "none",
      color: foregroundColor,
      boxSizing: "border-box",
    }),
    [mirroredStyles, foregroundColor],
  );

  const tokenStyle = useMemo(() => pillStyle(accentBrightColor), [accentBrightColor]);

  if (!enabled) {
    return null;
  }

  return (
    <div aria-hidden="true" data-composer-token-mirror="" style={containerStyle}>
      <div ref={scrollLayerRef}>
        {segments.map((segment) =>
          segment.kind === "text" ? (
            <span key={segment.start}>{segment.text}</span>
          ) : (
            <span key={segment.start} style={tokenStyle}>
              {getComposerTokenDisplayText(segment.token, sigils)}
            </span>
          ),
        )}
        {/* A trailing newline collapses without something after it, which would
            shift the mirror's last line relative to the textarea's. */}
        {value.endsWith("\n") ? <span>{"​"}</span> : null}
      </div>
    </div>
  );
}

const composerTokenHighlightColorMapping = (theme: Theme) => ({
  accentBrightColor: theme.colors.accentBright,
  foregroundColor: theme.colors.foreground,
});

const ThemedComposerTokenHighlight = withUnistyles(ComposerTokenHighlight);

export function ComposerTokenHighlightLayer(props: ComposerTokenHighlightProps) {
  return (
    <ThemedComposerTokenHighlight
      {...props}
      textareaRef={props.textareaRef as RefObject<HTMLElement | null>}
      uniProps={composerTokenHighlightColorMapping}
    />
  );
}
