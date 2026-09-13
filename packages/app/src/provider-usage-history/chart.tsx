import { useCallback, useMemo, useReducer, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import Svg, { Line, Path } from "react-native-svg";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import type { Theme } from "@/styles/theme";
import {
  buildChartColumns,
  niceScale,
  stackPeak,
  type ProviderUsageHistoryChartColumn,
} from "./chart-data";
import { bandAreaPath, curvePath, smoothCurve, type CurvePoint } from "./curve";
import type { ProviderUsageHistoryDayTotals } from "./derive";
import { identityForeground, type IdentityColorName } from "@/styles/identity-colors";
import type { BreakdownRow, TimeGrouping } from "./breakdown";
import type { ProviderUsageHistoryMetric } from "./types";
import {
  formatPeriodLong,
  formatPeriodShort,
  formatTokens,
  formatUsd,
  formatUsdCompact,
} from "./window";

/** Headroom above the top gridline so a series at the peak keeps its full stroke. */
const PLOT_TOP = 8;
const AXIS_WIDTH = 48;
const TICK_COUNT = 4;
// Half a `fontSize.sm` line, so a tick label centers on its gridline.
const TICK_LABEL_OFFSET = 8;
const STROKE_WIDTH = 2;
const AREA_OPACITY = 0.24;

/**
 * Theme colors the SVG needs. Resolved once for the whole drawing through
 * `withUnistyles` on the outer `Svg`, never per primitive: the HOC wraps its
 * child in a `<div>`, and a `<div>` inside `<svg>` is foreign content the
 * browser will not paint.
 */
interface ChartPalette {
  readonly gridline: string;
  readonly hairline: string;
  readonly colorScheme: "light" | "dark";
}

const chartPaletteMapping = (theme: Theme) => ({
  palette: {
    gridline: theme.colors.border,
    hairline: theme.colors.foregroundMuted,
    colorScheme: theme.colorScheme,
  },
});

interface ChartSelection {
  readonly hovered: string | null;
  readonly pinned: string | null;
}

type ChartSelectionAction =
  | { type: "hoverIn"; day: string }
  | { type: "hoverOut"; day: string }
  | { type: "press"; day: string };

const NO_SELECTION: ChartSelection = { hovered: null, pinned: null };

function selectionReducer(state: ChartSelection, action: ChartSelectionAction): ChartSelection {
  switch (action.type) {
    case "hoverIn":
      return { ...state, hovered: action.day };
    case "hoverOut":
      // Entering the next column can land before this column's hover-out, so
      // only the column that still owns hover is allowed to clear it.
      return state.hovered === action.day ? { ...state, hovered: null } : state;
    case "press":
      return { ...state, pinned: state.pinned === action.day ? null : action.day };
  }
}

export interface ProviderUsageHistoryChartProps {
  /** One period start per column, oldest first. */
  periods: readonly string[];
  daily: readonly ProviderUsageHistoryDayTotals[];
  series: readonly BreakdownRow[];
  metric: ProviderUsageHistoryMetric;
  timeGrouping: TimeGrouping;
}

interface SeriesPath {
  readonly provider: string;
  readonly colorName: IdentityColorName;
  readonly line: string;
  readonly area: string;
}

/**
 * Stacked areas, one band per breakdown series. Each band measures from the one
 * below it, so the top of the stack is the day's total and a small series stays
 * visible instead of sitting underneath a larger one.
 */
export function ProviderUsageHistoryChart({
  periods,
  daily,
  series,
  metric,
  timeGrouping,
}: ProviderUsageHistoryChartProps) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const plotHeight = Math.max(240, Math.round(height * 0.5));
  const providers = useMemo(() => series.map((row) => row.key), [series]);
  const labels = useMemo(() => new Map(series.map((row) => [row.key, row.label])), [series]);
  const [selection, dispatch] = useReducer(selectionReducer, NO_SELECTION);
  // Measure real pixels rather than using a scaled viewBox: `preserveAspectRatio="none"`
  // stretches the stroke with the geometry.
  const [plotWidth, setPlotWidth] = useState(0);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setPlotWidth(event.nativeEvent.layout.width);
  }, []);

  const columns = useMemo(
    () => buildChartColumns(periods, daily, providers, metric),
    [daily, periods, metric, providers],
  );
  const scale = useMemo(() => niceScale(stackPeak(columns), TICK_COUNT), [columns]);
  const stepX = columns.length < 2 ? 0 : plotWidth / (columns.length - 1);

  const paths = useMemo<readonly SeriesPath[]>(() => {
    if (plotWidth <= 0 || columns.length === 0) return [];
    const step = columns.length < 2 ? 0 : plotWidth / (columns.length - 1);
    // One boundary per stack level: level 0 is the baseline, level i + 1 is the
    // top of series i. A band is drawn between two of these rather than
    // smoothing its own top and bottom separately, so neighbouring bands share
    // the identical boundary and cannot drift apart.
    const running = columns.map(() => 0);
    const boundaries: CurvePoint[][] = [
      columns.map((_, dayIndex) => ({ x: dayIndex * step, y: plotY(0, scale.max, plotHeight) })),
    ];
    for (let seriesIndex = 0; seriesIndex < providers.length; seriesIndex += 1) {
      boundaries.push(
        columns.map((column, dayIndex) => {
          const total = (running[dayIndex] ?? 0) + (column.bands[seriesIndex]?.value ?? 0);
          running[dayIndex] = total;
          return { x: dayIndex * step, y: plotY(total, scale.max, plotHeight) };
        }),
      );
    }

    return providers.map((provider, seriesIndex) => {
      const top = boundaries[seriesIndex + 1] ?? [];
      const bottom = boundaries[seriesIndex] ?? [];
      return {
        provider,
        colorName: series[seriesIndex].colorName,
        line: curvePath(smoothCurve(top)),
        area: bandAreaPath(top, bottom),
      };
    });
  }, [columns, plotWidth, providers, scale.max, plotHeight, series]);

  const format = metric === "cost" ? formatUsd : formatTokens;
  const formatTick = metric === "cost" ? formatUsdCompact : formatTokens;
  const candidate = selection.hovered ?? selection.pinned;
  const selectedIndex = columns.findIndex((column) => column.day === candidate);
  const selected = selectedIndex < 0 ? undefined : columns[selectedIndex];

  const title = t(`settings.usageHistory.chart.title.${metric}.${timeGrouping}`);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <ScrollView horizontal style={styles.readout}>
        <Text style={styles.readoutLine} numberOfLines={1}>
          {selected === undefined ? (
            ""
          ) : (
            <>
              <Text style={styles.readoutDay}>{formatPeriodLong(selected.day, timeGrouping)}</Text>
              {selected.bands
                .filter((band) => band.value > 0 || band.unpricedRecords > 0)
                .map((band) => (
                  <Text key={band.provider}>{`  ${labels.get(band.provider)} ${format(
                    band.value,
                  )}`}</Text>
                ))}
              <Text style={styles.readoutDay}>{`  ${t(
                "settings.usageHistory.chart.total",
              )} ${format(selected.total)}`}</Text>
            </>
          )}
        </Text>
      </ScrollView>

      <View style={styles.plotRow}>
        <View style={styles.axis(plotHeight)}>
          {scale.ticks.map((tick) => (
            <Text
              key={tick}
              style={[
                styles.tickLabel,
                inlineUnistylesStyle({
                  top: plotY(tick, scale.max, plotHeight) - TICK_LABEL_OFFSET,
                }),
              ]}
              numberOfLines={1}
            >
              {tick === 0 ? "0" : formatTick(tick)}
            </Text>
          ))}
        </View>

        <View style={styles.plot(plotHeight)} onLayout={handleLayout}>
          {plotWidth <= 0 ? null : (
            <ThemedChartSvg
              plotWidth={plotWidth}
              plotHeight={plotHeight}
              ticks={scale.ticks}
              max={scale.max}
              paths={paths}
              selectedIndex={selectedIndex}
              stepX={stepX}
              uniProps={chartPaletteMapping}
            />
          )}
          {plotWidth <= 0
            ? null
            : columns.map((column, index) => (
                <ChartDayTarget
                  key={column.day}
                  column={column}
                  left={cellLeft(index, stepX, plotWidth)}
                  width={cellWidth(index, stepX, plotWidth, columns.length)}
                  isSelected={column.day === candidate}
                  label={`${formatPeriodLong(column.day, timeGrouping)} ${format(column.total)}`}
                  onDispatch={dispatch}
                />
              ))}
        </View>
      </View>

      <View style={styles.axisLabels}>
        <Text style={styles.axisLabel}>{periodLabelAt(periods, 0, timeGrouping)}</Text>
        <Text style={styles.axisLabel}>
          {periods.length > 2
            ? periodLabelAt(periods, Math.floor(periods.length / 2), timeGrouping)
            : ""}
        </Text>
        <Text style={styles.axisLabel}>
          {periodLabelAt(periods, periods.length - 1, timeGrouping)}
        </Text>
      </View>
      <ScrollView horizontal>
        <View style={styles.legend}>
          {series.map((row) => (
            <View key={row.key} style={styles.legendItem}>
              <View style={styles.legendDot(row.colorName)} />
              <Text style={styles.readoutLine}>{row.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

interface ChartSvgProps {
  plotHeight: number;
  plotWidth: number;
  ticks: readonly number[];
  max: number;
  paths: readonly SeriesPath[];
  selectedIndex: number;
  stepX: number;
  palette: ChartPalette;
}

function ChartSvg({
  plotHeight,
  plotWidth,
  ticks,
  max,
  paths,
  selectedIndex,
  stepX,
  palette,
}: ChartSvgProps) {
  return (
    <Svg width={plotWidth} height={plotHeight}>
      {ticks.map((tick) => (
        <Line
          key={tick}
          x1={0}
          x2={plotWidth}
          y1={plotY(tick, max, plotHeight)}
          y2={plotY(tick, max, plotHeight)}
          stroke={palette.gridline}
          strokeWidth={1}
        />
      ))}
      {/* Fills first, then every stroke, so a band's fill never covers the boundary it shares with its neighbour. */}
      {paths.map((series) => (
        <Path
          key={series.provider}
          d={series.area}
          fill={identityForeground(series.colorName, palette.colorScheme)}
          fillOpacity={AREA_OPACITY}
        />
      ))}
      {paths.map((series) => (
        <Path
          key={series.provider}
          d={series.line}
          fill="none"
          stroke={identityForeground(series.colorName, palette.colorScheme)}
          strokeWidth={STROKE_WIDTH}
        />
      ))}
      {selectedIndex < 0 ? null : (
        <Line
          x1={selectedIndex * stepX}
          x2={selectedIndex * stepX}
          y1={PLOT_TOP}
          y2={plotHeight}
          stroke={palette.hairline}
          strokeWidth={1}
        />
      )}
    </Svg>
  );
}

const ThemedChartSvg = withUnistyles(ChartSvg);

function plotY(value: number, max: number, plotHeight: number): number {
  if (max === 0) return plotHeight;
  return plotHeight - (value / max) * (plotHeight - PLOT_TOP);
}

/** Each day owns the strip centered on its own point, clamped at the edges. */
function cellLeft(index: number, stepX: number, plotWidth: number): number {
  if (stepX === 0) return 0;
  return Math.max(0, Math.min(plotWidth, index * stepX - stepX / 2));
}

function cellWidth(index: number, stepX: number, plotWidth: number, count: number): number {
  if (stepX === 0) return plotWidth;
  const right = index === count - 1 ? plotWidth : Math.min(plotWidth, index * stepX + stepX / 2);
  return Math.max(0, right - cellLeft(index, stepX, plotWidth));
}

function periodLabelAt(periods: readonly string[], index: number, grouping: TimeGrouping): string {
  const period = periods[index];
  return period === undefined ? "" : formatPeriodShort(period, grouping);
}

interface ChartDayTargetProps {
  column: ProviderUsageHistoryChartColumn;
  left: number;
  width: number;
  isSelected: boolean;
  label: string;
  onDispatch: (action: ChartSelectionAction) => void;
}

/**
 * One day's hit target over the plot. Hover lives on this `Pressable` rather
 * than a wrapping view because the strip holds no other pressable to fight it
 * for hover state; press is what selects a day everywhere hover does not exist.
 */
function ChartDayTarget({
  column,
  left,
  width,
  isSelected,
  label,
  onDispatch,
}: ChartDayTargetProps) {
  const handleHoverIn = useCallback(
    () => onDispatch({ type: "hoverIn", day: column.day }),
    [column.day, onDispatch],
  );
  const handleHoverOut = useCallback(
    () => onDispatch({ type: "hoverOut", day: column.day }),
    [column.day, onDispatch],
  );
  const handlePress = useCallback(
    () => onDispatch({ type: "press", day: column.day }),
    [column.day, onDispatch],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selectedState(isSelected)}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      onPress={handlePress}
      style={[styles.dayTarget, inlineUnistylesStyle({ left, width })]}
    />
  );
}

function selectedState(isSelected: boolean) {
  return { selected: isSelected };
}

const styles = StyleSheet.create((theme) => ({
  legend: { flexDirection: "row", gap: theme.spacing[4] },
  legendItem: { flexDirection: "row", alignItems: "center", gap: theme.spacing[1] },
  legendDot: (name: IdentityColorName) => ({
    width: 8,
    height: 8,
    borderRadius: theme.borderRadius.full,
    backgroundColor: identityForeground(name, theme.colorScheme),
  }),
  container: {
    gap: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  readout: {
    // Reserved so selecting a day never moves the plot underneath the pointer.
    minHeight: 18,
  },
  readoutLine: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  readoutDay: {
    color: theme.colors.foreground,
  },
  plotRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  axis: (plotHeight: number) => ({
    width: AXIS_WIDTH,
    height: plotHeight,
  }),
  tickLabel: {
    position: "absolute",
    right: 0,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  plot: (plotHeight: number) => ({
    flex: 1,
    height: plotHeight,
  }),
  dayTarget: {
    position: "absolute",
    top: 0,
    bottom: 0,
  },
  axisLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginLeft: AXIS_WIDTH + theme.spacing[2],
  },
  axisLabel: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    textTransform: "uppercase",
  },
}));
