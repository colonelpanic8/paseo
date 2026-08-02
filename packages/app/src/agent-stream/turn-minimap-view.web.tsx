import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  resolveTurnMinimapHeight,
  resolveTurnMinimapIndexFromPointer,
  resolveTurnMinimapTopPercent,
  turnMinimapHasEnoughSpace,
  TURN_MINIMAP_MIN_ITEMS,
  type TurnMinimapItem,
} from "./turn-minimap";

const MINIMAP_WIDTH = 72;
const RAIL_LEFT = 12;
const HIT_STRIP_WIDTH = 40;
const EXPANDED_HIT_STRIP_WIDTH = 352;
const PREVIEW_LEFT = 32;
const PREVIEW_WIDTH = 320;

interface ViewportSize {
  width: number;
  height: number;
}

interface TurnMinimapProps {
  items: readonly TurnMinimapItem[];
  markerMap: Map<string, HTMLSpanElement>;
  viewportElement: HTMLElement | null;
  onMarkersReady: () => void;
  onSelect: (item: TurnMinimapItem) => void;
}

export function TurnMinimap({
  items,
  markerMap,
  viewportElement,
  onMarkersReady,
  onSelect,
}: TurnMinimapProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hasFinePointer, setHasFinePointer] = useState(false);
  const [viewportSize, setViewportSize] = useState<ViewportSize>({ width: 0, height: 0 });

  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setHasFinePointer(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!viewportElement) {
      setViewportSize({ width: 0, height: 0 });
      return;
    }

    const measure = () => {
      const rect = viewportElement.getBoundingClientRect();
      setViewportSize((current) => {
        if (current.width === rect.width && current.height === rect.height) {
          return current;
        }
        return { width: rect.width, height: rect.height };
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewportElement);
    return () => observer.disconnect();
  }, [viewportElement]);

  const resolvedActiveIndex =
    activeIndex !== null && activeIndex < items.length ? activeIndex : null;
  const activeItem = resolvedActiveIndex === null ? null : (items[resolvedActiveIndex] ?? null);

  const resolveIndexFromPointer = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return resolveTurnMinimapIndexFromPointer({
        itemCount: items.length,
        railTop: rect.top,
        railHeight: rect.height,
        pointerY: event.clientY,
      });
    },
    [items.length],
  );

  const moveActiveIndex = useCallback(
    (delta: number) => {
      setActiveIndex((current) => {
        const base = current ?? 0;
        return Math.max(0, Math.min(items.length - 1, base + delta));
      });
    },
    [items.length],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveActiveIndex(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveActiveIndex(-1);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setActiveIndex(items.length - 1);
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && activeItem) {
        event.preventDefault();
        onSelect(activeItem);
      }
    },
    [activeItem, items.length, moveActiveIndex, onSelect],
  );

  const handleBlur = useCallback(() => setActiveIndex(null), []);
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (eventTargetIsPreview(event.target)) {
        return;
      }
      const nextIndex = resolveIndexFromPointer(event);
      const nextItem = nextIndex === null ? null : (items[nextIndex] ?? null);
      if (nextItem) {
        onSelect(nextItem);
      }
      event.currentTarget.blur();
    },
    [items, onSelect, resolveIndexFromPointer],
  );
  const handleFocus = useCallback(() => setActiveIndex((current) => current ?? 0), []);
  const handleMouseDown = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (!eventTargetIsPreview(event.target)) {
      event.preventDefault();
    }
  }, []);
  const handleMouseLeave = useCallback(() => setActiveIndex(null), []);
  const handleMouseMove = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => setActiveIndex(resolveIndexFromPointer(event)),
    [resolveIndexFromPointer],
  );
  const handlePreviewMouseMove = useCallback((event: MouseEvent<HTMLSpanElement>) => {
    event.stopPropagation();
  }, []);

  const hasEnoughSpace = turnMinimapHasEnoughSpace(viewportSize.width);
  const railHeight = resolveTurnMinimapHeight(items.length, viewportSize.height);
  const activeTopPercent =
    resolvedActiveIndex === null
      ? 0
      : resolveTurnMinimapTopPercent(resolvedActiveIndex, items.length);
  const activeTooltipTranslate = resolvePreviewTranslate(resolvedActiveIndex, items.length);
  const railStyle = useMemo<CSSProperties>(
    () => ({
      ...railButtonStyle,
      height: railHeight,
      width: activeItem ? EXPANDED_HIT_STRIP_WIDTH : HIT_STRIP_WIDTH,
    }),
    [activeItem, railHeight],
  );
  const activePreviewStyle = useMemo<CSSProperties>(
    () => ({
      ...previewPositionStyle,
      top: `${activeTopPercent}%`,
      transform: `translateY(${activeTooltipTranslate})`,
    }),
    [activeTooltipTranslate, activeTopPercent],
  );

  useEffect(() => {
    if (!hasFinePointer || !hasEnoughSpace || items.length < TURN_MINIMAP_MIN_ITEMS) {
      return;
    }
    const frame = window.requestAnimationFrame(onMarkersReady);
    return () => window.cancelAnimationFrame(frame);
  }, [hasEnoughSpace, hasFinePointer, items.length, onMarkersReady, viewportSize.height]);

  if (!hasFinePointer || !hasEnoughSpace || items.length < TURN_MINIMAP_MIN_ITEMS) {
    return null;
  }

  return (
    <div data-testid="turn-minimap" style={minimapStyle}>
      <button
        aria-label={`Jump to turn: ${activeItem?.userText ?? "User message"}`}
        data-testid="turn-minimap-rail"
        onBlur={handleBlur}
        onClick={handleClick}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onMouseDown={handleMouseDown}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
        style={railStyle}
        type="button"
      >
        <span aria-hidden="true" style={railLineStyle} />
        {items.map((item, index) => {
          const activeDistance =
            resolvedActiveIndex === null ? null : Math.abs(index - resolvedActiveIndex);
          return (
            <TurnMinimapMarker
              activeDistance={activeDistance}
              item={item}
              key={item.id}
              markerMap={markerMap}
              topPercent={resolveTurnMinimapTopPercent(index, items.length)}
            />
          );
        })}
        {activeItem ? (
          <span
            data-testid="turn-minimap-preview"
            data-turn-minimap-preview
            onMouseMove={handlePreviewMouseMove}
            style={activePreviewStyle}
          >
            <span style={previewCardStyle}>
              <span style={previewUserStyle}>{activeItem.userText ?? "User message"}</span>
              {activeItem.assistantText ? (
                <span style={previewAssistantStyle}>{activeItem.assistantText}</span>
              ) : null}
            </span>
          </span>
        ) : null}
      </button>
    </div>
  );
}

const TurnMinimapMarker = memo(function TurnMinimapMarker({
  activeDistance,
  item,
  markerMap,
  topPercent,
}: {
  activeDistance: number | null;
  item: TurnMinimapItem;
  markerMap: Map<string, HTMLSpanElement>;
  topPercent: number;
}) {
  const setMarkerRef = useCallback(
    (node: HTMLSpanElement | null) => {
      if (node) {
        node.style.backgroundColor = "var(--colors-foreground-extra-muted)";
        node.style.opacity = "0.5";
        markerMap.set(item.id, node);
      } else {
        markerMap.delete(item.id);
      }
    },
    [item.id, markerMap],
  );
  const style = useMemo<CSSProperties>(
    () => ({
      ...markerStyle,
      top: `${topPercent}%`,
      transform: `translateY(${resolveMarkerTranslate(topPercent)})`,
      width: resolveMarkerWidth(activeDistance),
    }),
    [activeDistance, topPercent],
  );

  return <span aria-hidden="true" data-turn-minimap-marker ref={setMarkerRef} style={style} />;
});

function eventTargetIsPreview(target: EventTarget): boolean {
  return target instanceof Element && target.closest("[data-turn-minimap-preview]") !== null;
}

function resolveMarkerWidth(activeDistance: number | null): number {
  if (activeDistance === 0) return 24;
  if (activeDistance === 1) return 16;
  if (activeDistance === 2) return 10;
  return 8;
}

function resolveMarkerTranslate(topPercent: number): string {
  if (topPercent === 0) return "0%";
  if (topPercent === 100) return "-100%";
  return "-50%";
}

function resolvePreviewTranslate(activeIndex: number | null, itemCount: number): string {
  if (activeIndex === 0) return "0%";
  if (activeIndex === itemCount - 1) return "-100%";
  return "-50%";
}

const minimapStyle: CSSProperties = {
  position: "absolute",
  zIndex: 40,
  top: 0,
  bottom: 0,
  left: 0,
  width: MINIMAP_WIDTH,
  pointerEvents: "none",
};

const railButtonStyle: CSSProperties = {
  position: "absolute",
  top: "50%",
  left: RAIL_LEFT,
  padding: 0,
  border: 0,
  transform: "translateY(-50%)",
  overflow: "visible",
  background: "transparent",
  cursor: "pointer",
  pointerEvents: "auto",
  userSelect: "none",
};

const railLineStyle: CSSProperties = {
  position: "absolute",
  top: 0,
  left: RAIL_LEFT,
  width: 1,
  height: "100%",
  backgroundColor: "var(--colors-border)",
  opacity: 0.2,
};

const markerStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  height: 2,
  borderRadius: "var(--border-radius-full, 9999px)",
  transition: "width 150ms ease, background-color 150ms ease, opacity 150ms ease",
  pointerEvents: "none",
};

const previewPositionStyle: CSSProperties = {
  position: "absolute",
  left: PREVIEW_LEFT,
  width: PREVIEW_WIDTH,
  cursor: "text",
  userSelect: "text",
  pointerEvents: "auto",
};

const previewCardStyle: CSSProperties = {
  display: "block",
  padding: "var(--spacing-3, 12px)",
  border: "1px solid var(--colors-border)",
  borderRadius: "var(--border-radius-xl, 12px)",
  backgroundColor: "var(--colors-popover)",
  color: "var(--colors-popover-foreground)",
  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.2)",
  textAlign: "left",
};

const previewUserStyle: CSSProperties = {
  display: "block",
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontFamily: "var(--font-family-ui)",
  fontSize: "var(--font-size-sm, 14px)",
  fontWeight: 500,
  lineHeight: "20px",
};

const previewAssistantStyle: CSSProperties = {
  display: "-webkit-box",
  marginTop: "var(--spacing-1, 4px)",
  maxHeight: 60,
  overflow: "hidden",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 3,
  color: "var(--colors-foreground-muted)",
  fontFamily: "var(--font-family-ui)",
  fontSize: "var(--font-size-sm, 14px)",
  fontWeight: 400,
  lineHeight: "20px",
};
