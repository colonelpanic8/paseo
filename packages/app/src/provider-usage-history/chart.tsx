import { useCallback, useMemo, useReducer } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { buildChartColumns, niceScale, type ProviderUsageHistoryChartColumn } from "./chart-data";
import type { ProviderUsageHistoryDayTotals } from "./derive";
import { providerLabel } from "./providers";
import { seriesFillStyle } from "./series";
import type { ProviderUsageHistoryMetric } from "./types";
import { formatDayShort, formatTokens, formatUsd, formatUsdCompact } from "./window";

const PLOT_HEIGHT = 140;
const AXIS_WIDTH = 44;
const TICK_COUNT = 4;
// Half a `fontSize.sm` line, so a tick label centers on its gridline.
const TICK_LABEL_OFFSET = 8;

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
  days: readonly string[];
  daily: readonly ProviderUsageHistoryDayTotals[];
  /** Providers with activity, in canonical order. */
  providers: readonly string[];
  /** Full canonical order; a provider's index here picks its series color. */
  providerOrder: readonly string[];
  metric: ProviderUsageHistoryMetric;
}

export function ProviderUsageHistoryChart({
  days,
  daily,
  providers,
  providerOrder,
  metric,
}: ProviderUsageHistoryChartProps) {
  const { t } = useTranslation();
  const [selection, dispatch] = useReducer(selectionReducer, NO_SELECTION);

  const columns = useMemo(
    () => buildChartColumns(days, daily, providers, metric),
    [daily, days, metric, providers],
  );
  const scale = useMemo(() => {
    const peak = columns.reduce((max, column) => Math.max(max, column.total), 0);
    return niceScale(peak, TICK_COUNT);
  }, [columns]);

  const format = metric === "cost" ? formatUsd : formatTokens;
  const formatTick = metric === "cost" ? formatUsdCompact : formatTokens;
  const candidate = selection.hovered ?? selection.pinned;
  const selected = columns.find((column) => column.day === candidate);

  const title =
    metric === "cost"
      ? t("settings.usageHistory.chart.titleCost")
      : t("settings.usageHistory.chart.titleTokens");
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const rangeLabel =
    firstDay === undefined || lastDay === undefined
      ? ""
      : `${formatDayShort(firstDay)} – ${formatDayShort(lastDay)}`;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.readout}>
        {selected === undefined ? (
          <Text style={styles.readoutRange} numberOfLines={1}>
            {rangeLabel}
          </Text>
        ) : (
          <Text style={styles.readoutRange} numberOfLines={1}>
            <Text style={styles.readoutDay}>{formatDayShort(selected.day)}</Text>
            {selected.bands.map((band) => (
              <Text key={band.provider}>{`  ${providerLabel(band.provider)} ${format(
                band.value,
              )}`}</Text>
            ))}
            <Text style={styles.readoutDay}>{`  ${t(
              "settings.usageHistory.chart.total",
            )} ${format(selected.total)}`}</Text>
          </Text>
        )}
      </View>

      <View style={styles.plotRow}>
        <View style={styles.axis}>
          {scale.ticks.map((tick) => (
            <Text
              key={tick}
              style={[
                styles.tickLabel,
                inlineUnistylesStyle({ top: tickTop(tick, scale.max) - TICK_LABEL_OFFSET }),
              ]}
              numberOfLines={1}
            >
              {tick === 0 ? "0" : formatTick(tick)}
            </Text>
          ))}
        </View>

        <View style={styles.plot}>
          {scale.ticks.map((tick) => (
            <View
              key={tick}
              style={[styles.gridline, inlineUnistylesStyle({ top: tickTop(tick, scale.max) })]}
            />
          ))}
          <View style={styles.columns}>
            {columns.map((column) => (
              <ChartColumn
                key={column.day}
                column={column}
                max={scale.max}
                providerOrder={providerOrder}
                isSelected={column.day === candidate}
                label={`${formatDayShort(column.day)} ${format(column.total)}`}
                onDispatch={dispatch}
              />
            ))}
          </View>
        </View>
      </View>

      <View style={styles.axisLabels}>
        <Text style={styles.axisLabel}>{dayLabelAt(days, 0)}</Text>
        <Text style={styles.axisLabel}>{dayLabelAt(days, Math.floor(days.length / 2))}</Text>
        <Text style={styles.axisLabel}>{dayLabelAt(days, days.length - 1)}</Text>
      </View>
    </View>
  );
}

function tickTop(tick: number, max: number): number {
  if (max === 0) return PLOT_HEIGHT;
  return PLOT_HEIGHT - (tick / max) * PLOT_HEIGHT;
}

function dayLabelAt(days: readonly string[], index: number): string {
  const day = days[index];
  return day === undefined ? "" : formatDayShort(day);
}

interface ChartColumnProps {
  column: ProviderUsageHistoryChartColumn;
  max: number;
  providerOrder: readonly string[];
  isSelected: boolean;
  label: string;
  onDispatch: (action: ChartSelectionAction) => void;
}

/**
 * One day's stack. Hover lives on this `Pressable` rather than a wrapping view
 * because the column holds no other pressable to fight it for hover state.
 */
function ChartColumn({
  column,
  max,
  providerOrder,
  isSelected,
  label,
  onDispatch,
}: ChartColumnProps) {
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
      style={[styles.column, isSelected ? styles.columnSelected : null]}
    >
      <View style={styles.stack}>
        {column.bands.map((band) => (
          <View
            key={band.provider}
            style={[
              seriesFillStyle(providerOrder.indexOf(band.provider)),
              inlineUnistylesStyle({ height: bandHeight(band.value, max) }),
            ]}
          />
        ))}
      </View>
    </Pressable>
  );
}

function selectedState(isSelected: boolean) {
  return { selected: isSelected };
}

function bandHeight(value: number, max: number): number {
  if (max === 0 || value <= 0) return 0;
  return (value / max) * PLOT_HEIGHT;
}

const styles = StyleSheet.create((theme) => ({
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
    justifyContent: "center",
  },
  readoutRange: {
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
  axis: {
    width: AXIS_WIDTH,
    height: PLOT_HEIGHT,
  },
  tickLabel: {
    position: "absolute",
    right: 0,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  plot: {
    flex: 1,
    height: PLOT_HEIGHT,
  },
  gridline: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  columns: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: PLOT_HEIGHT,
    gap: 1,
  },
  column: {
    flex: 1,
    height: PLOT_HEIGHT,
    justifyContent: "flex-end",
    borderRadius: theme.borderRadius.sm,
  },
  columnSelected: {
    backgroundColor: theme.colors.interactionHighlight,
  },
  stack: {
    flexDirection: "column-reverse",
    borderRadius: theme.borderRadius.sm,
    overflow: "hidden",
  },
  axisLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginLeft: AXIS_WIDTH + theme.spacing[2],
  },
  axisLabel: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
}));
