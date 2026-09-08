import { RefreshCw } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import { ProviderUsageHistoryChart } from "./chart";
import {
  configuredProvidersByKind,
  deriveProviderUsageHistory,
  type ProviderUsageHistoryConfiguredTotals,
  type ProviderUsageHistoryModelTotals,
  type ProviderUsageHistoryProviderTotals,
  type ProviderUsageHistoryTotals,
} from "./derive";
import { providerLabel } from "./providers";
import { seriesFillStyle } from "./series";
import type {
  ProviderUsageHistoryMetric,
  ProviderUsageHistoryPricing,
  ProviderUsageHistoryView,
  ProviderUsageHistoryWindowDays,
} from "./types";
import { useProviderUsageHistory } from "./use-provider-usage-history";
import { enumerateDays, formatDayShort, formatPercent, formatTokens, formatUsd } from "./window";

const WINDOW_DAYS: readonly ProviderUsageHistoryWindowDays[] = [7, 30, 90];
type BreakdownMode = "provider" | "model" | "day";

const SERIES_DOT_SIZE = 8;
const PROVIDER_MARK_SIZE = 14;
/** Where a provider row's text starts: dot, gap, mark, gap. Sub-rows share it. */
const PROVIDER_NAME_RAIL = SERIES_DOT_SIZE + 8 + PROVIDER_MARK_SIZE + 8;

interface ProviderMarkProps {
  provider: string;
  size: number;
  color?: string;
}

function ProviderMark({ provider, size, color = "" }: ProviderMarkProps) {
  const Icon = getProviderIcon(provider);
  return <Icon size={size} color={color} />;
}

const ThemedProviderMark = withUnistyles(ProviderMark);
const mutedMarkColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export function ProviderUsageHistorySection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<ProviderUsageHistoryMetric>("cost");
  const [windowDays, setWindowDays] = useState<ProviderUsageHistoryWindowDays>(30);
  // Aliased: `window` is the global on web.
  const { view, window: usageWindow, refresh } = useProviderUsageHistory(serverId, windowDays);

  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);
  const handleWindowChange = useCallback((value: string) => {
    const days = Number.parseInt(value, 10);
    if (days === 7 || days === 30 || days === 90) setWindowDays(days);
  }, []);

  const metricOptions = useMemo<SegmentedControlOption<ProviderUsageHistoryMetric>[]>(
    () => [
      { value: "cost", label: t("settings.usageHistory.metric.cost") },
      { value: "tokens", label: t("settings.usageHistory.metric.tokens") },
    ],
    [t],
  );
  const windowOptions = useMemo<SegmentedControlOption<string>[]>(
    () =>
      WINDOW_DAYS.map((days) => ({
        value: String(days),
        label: t(`settings.usageHistory.window.d${days}`),
      })),
    [t],
  );

  const busy = view.kind === "loading" || (view.kind === "ready" && view.isRefreshing);
  const controls = useMemo(
    () => (
      <View style={styles.headerControls}>
        <SegmentedControl
          size="xs"
          options={metricOptions}
          value={metric}
          onValueChange={setMetric}
          testID="usage-history-metric"
        />
        <SegmentedControl
          size="xs"
          options={windowOptions}
          value={String(windowDays)}
          onValueChange={handleWindowChange}
          testID="usage-history-window"
        />
        <Button
          variant="ghost"
          size="xs"
          leftIcon={RefreshCw}
          loading={busy}
          onPress={handleRefresh}
          accessibilityLabel={t("settings.usageHistory.refresh")}
        />
      </View>
    ),
    [busy, handleRefresh, handleWindowChange, metric, metricOptions, t, windowDays, windowOptions],
  );

  // Totals and Breakdown are their own sections, so they only exist once there
  // is something to break down.
  const report = useMemo(() => {
    if (view.kind !== "ready" || view.payload.buckets.length === 0) return null;
    return deriveProviderUsageHistory(view.payload);
  }, [view]);

  return (
    <View>
      <SettingsSection
        title={t("settings.usageHistory.title")}
        info={t("settings.usageHistory.info")}
        testID="usage-history-section"
        trailing={controls}
      >
        <ProviderUsageHistoryBody
          view={view}
          report={report}
          metric={metric}
          sinceDay={usageWindow.sinceDay}
          untilDay={usageWindow.untilDay}
          onRetry={handleRefresh}
        />
      </SettingsSection>
      {report === null ? null : (
        <>
          <TotalsGrid totals={report} />
          <Breakdown totals={report} />
        </>
      )}
    </View>
  );
}

interface ProviderUsageHistoryBodyProps {
  view: ProviderUsageHistoryView;
  report: ProviderUsageHistoryTotals | null;
  metric: ProviderUsageHistoryMetric;
  sinceDay: string;
  untilDay: string;
  onRetry: () => void;
}

function ProviderUsageHistoryBody({
  view,
  report,
  metric,
  sinceDay,
  untilDay,
  onRetry,
}: ProviderUsageHistoryBodyProps) {
  const { t } = useTranslation();

  if (view.kind === "loading") {
    return (
      <View style={[settingsStyles.card, styles.placeholderCard]}>
        <Text style={styles.emptyText}>{t("common.states.loading")}</Text>
      </View>
    );
  }

  if (view.kind === "unsupported") {
    return (
      <View style={[settingsStyles.card, styles.emptyCard]}>
        <Text style={styles.emptyText}>{t("settings.usageHistory.unsupported")}</Text>
      </View>
    );
  }

  if (view.kind === "error") {
    return (
      <Alert
        variant="error"
        title={t("settings.usageHistory.errorTitle")}
        description={view.message}
      >
        <Button variant="outline" size="sm" onPress={onRetry}>
          {t("common.actions.retry")}
        </Button>
      </Alert>
    );
  }

  if (report === null) {
    return (
      <View style={[settingsStyles.card, styles.emptyCard]}>
        <Text style={styles.emptyText}>{t("settings.usageHistory.empty")}</Text>
      </View>
    );
  }

  return (
    <SummaryCard
      totals={report}
      pricing={view.payload.pricing}
      metric={metric}
      sinceDay={sinceDay}
      untilDay={untilDay}
    />
  );
}

interface SummaryCardProps {
  totals: ProviderUsageHistoryTotals;
  pricing: ProviderUsageHistoryPricing;
  metric: ProviderUsageHistoryMetric;
  sinceDay: string;
  untilDay: string;
}

function SummaryCard({ totals, pricing, metric, sinceDay, untilDay }: SummaryCardProps) {
  const { t } = useTranslation();
  const days = useMemo(() => enumerateDays(sinceDay, untilDay), [sinceDay, untilDay]);
  const activeProviders = useMemo(
    () => totals.providers.map((entry) => entry.provider),
    [totals.providers],
  );
  // A kind only earns sub-rows once more than one configured provider used it.
  const configuredByKind = useMemo(
    () => configuredProvidersByKind(totals.configuredProviders),
    [totals.configuredProviders],
  );

  return (
    <View style={[settingsStyles.card, styles.summaryCard]}>
      <Headline totals={totals} metric={metric} />
      {totals.providers.map((entry) => {
        const configured = configuredByKind.get(entry.provider) ?? [];
        return (
          <ProviderRow
            key={entry.provider}
            entry={entry}
            metric={metric}
            seriesIndex={totals.providerOrder.indexOf(entry.provider)}
            configured={configured.length > 1 ? configured : []}
          />
        );
      })}
      {totals.unreadableProviders.length === 0 ? null : (
        <Text style={settingsStyles.rowHint} testID="usage-history-unreadable">
          {t("settings.usageHistory.summary.unreadableProviders", {
            providers: totals.unreadableProviders.join(", "),
          })}
        </Text>
      )}
      {pricing.status === "unavailable" ? (
        <Text style={settingsStyles.rowHint}>{t("settings.usageHistory.pricingUnavailable")}</Text>
      ) : null}
      <View style={styles.chartBlock}>
        <ProviderUsageHistoryChart
          days={days}
          daily={totals.daily}
          providers={activeProviders}
          providerOrder={totals.providerOrder}
          metric={metric}
        />
      </View>
    </View>
  );
}

function sessionsLabel(t: TFunction, sessions: number): string {
  return t("settings.usageHistory.summary.sessions", { count: sessions });
}

function Headline({
  totals,
  metric,
}: {
  totals: ProviderUsageHistoryTotals;
  metric: ProviderUsageHistoryMetric;
}) {
  const { t } = useTranslation();
  const sessions = sessionsLabel(t, totals.sessions);
  const subline =
    metric === "cost" ? t("settings.usageHistory.summary.costSubline", { sessions }) : sessions;

  return (
    <View style={styles.headline}>
      <Text style={styles.headlineValue} testID="usage-history-headline">
        {metric === "cost" ? formatUsd(totals.costUsd) : formatTokens(totals.totalTokens)}
      </Text>
      <Text style={styles.headlineSubline}>{subline}</Text>
    </View>
  );
}

function ProviderRow({
  entry,
  metric,
  seriesIndex,
  configured,
}: {
  entry: ProviderUsageHistoryProviderTotals;
  metric: ProviderUsageHistoryMetric;
  seriesIndex: number;
  /** The kind's configured providers, or empty when it has only one. */
  configured: readonly ProviderUsageHistoryConfiguredTotals[];
}) {
  const { t } = useTranslation();
  const share = metric === "cost" ? entry.costShare : entry.tokenShare;
  const detail =
    metric === "cost"
      ? t("settings.usageHistory.summary.shareOfCost", {
          share: formatPercent(share),
          tokens: formatTokens(entry.totalTokens),
        })
      : t("settings.usageHistory.summary.shareOfTokens", {
          share: formatPercent(share),
          cost: formatUsd(entry.costUsd),
        });

  return (
    <View style={styles.providerRow} testID={`usage-history-provider-${entry.provider}`}>
      <View style={styles.providerRowMain}>
        <View style={[styles.seriesDot, seriesFillStyle(seriesIndex)]} />
        <ThemedProviderMark
          provider={entry.provider}
          size={PROVIDER_MARK_SIZE}
          uniProps={mutedMarkColor}
        />
        <Text style={styles.providerName} numberOfLines={1}>
          {providerLabel(entry.provider)}
        </Text>
        <Text style={styles.providerSessions} numberOfLines={1}>
          {sessionsLabel(t, entry.sessions)}
        </Text>
        <Text style={styles.providerValue}>
          {metric === "cost" ? formatUsd(entry.costUsd) : formatTokens(entry.totalTokens)}
        </Text>
      </View>
      <Text style={styles.providerDetail} numberOfLines={1}>
        {detail}
      </Text>
      {configured.length === 0 ? null : (
        <View style={styles.providerSubRows}>
          {configured.map((configuredProvider) => (
            <View
              key={configuredProvider.providerId}
              style={styles.providerSubRow}
              testID={`usage-history-provider-sub-${configuredProvider.providerId}`}
            >
              <Text style={styles.providerSubName} numberOfLines={1}>
                {configuredProvider.label}
              </Text>
              <Text style={styles.providerSubValue}>
                {metric === "cost"
                  ? formatUsd(configuredProvider.costUsd)
                  : formatTokens(configuredProvider.totalTokens)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function TotalsGrid({ totals }: { totals: ProviderUsageHistoryTotals }) {
  const { t } = useTranslation();
  const cells = [
    { key: "processedTokens", value: formatTokens(totals.totalTokens) },
    { key: "cachedInput", value: formatTokens(totals.cachedInputTokens) },
    { key: "uncachedInput", value: formatTokens(totals.uncachedInputTokens) },
    { key: "output", value: formatTokens(totals.outputTokens) },
    { key: "cacheSavings", value: formatUsd(totals.cacheSavingsUsd) },
  ];

  return (
    <SettingsSection title={t("settings.usageHistory.totals.title")}>
      <View style={[settingsStyles.card, styles.totalsCard]}>
        {cells.map((cell) => (
          <View key={cell.key} style={styles.totalsCell}>
            <Text style={styles.totalsLabel} numberOfLines={1}>
              {t(`settings.usageHistory.totals.${cell.key}`)}
            </Text>
            <Text style={styles.totalsValue}>{cell.value}</Text>
          </View>
        ))}
      </View>
    </SettingsSection>
  );
}

function Breakdown({ totals }: { totals: ProviderUsageHistoryTotals }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<BreakdownMode>("model");
  const activeProviders = useMemo(
    () => totals.providers.map((entry) => entry.provider),
    [totals.providers],
  );
  const options = useMemo<SegmentedControlOption<BreakdownMode>[]>(
    () => [
      { value: "provider", label: t("settings.usageHistory.breakdown.provider") },
      { value: "model", label: t("settings.usageHistory.breakdown.model") },
      { value: "day", label: t("settings.usageHistory.breakdown.day") },
    ],
    [t],
  );

  const trailing = useMemo(
    () => (
      <SegmentedControl
        size="xs"
        options={options}
        value={mode}
        onValueChange={setMode}
        testID="usage-history-breakdown"
      />
    ),
    [mode, options],
  );

  return (
    <SettingsSection title={t("settings.usageHistory.breakdown.title")} trailing={trailing}>
      {mode === "provider" ? <ProviderTable providers={totals.configuredProviders} /> : null}
      {mode === "model" ? <ModelTable models={totals.models} /> : null}
      {mode === "day" ? <DayTable totals={totals} activeProviders={activeProviders} /> : null}
    </SettingsSection>
  );
}

function ProviderTable({
  providers,
}: {
  providers: readonly ProviderUsageHistoryConfiguredTotals[];
}) {
  const { t } = useTranslation();

  return (
    <View style={settingsStyles.card}>
      <View style={styles.tableHeader}>
        <Text style={[styles.headerCell, styles.nameColumn]}>
          {t("settings.usageHistory.table.provider")}
        </Text>
        <Text style={[styles.headerCell, styles.valueColumn]}>
          {t("settings.usageHistory.table.cost")}
        </Text>
        <Text style={[styles.headerCell, styles.valueColumn]}>
          {t("settings.usageHistory.table.share")}
        </Text>
        <Text style={[styles.headerCell, styles.valueColumn]}>
          {t("settings.usageHistory.table.tokens")}
        </Text>
      </View>
      {providers.map((entry) => (
        <View
          key={entry.providerId}
          style={[styles.tableRow, settingsStyles.rowBorder]}
          testID={`usage-history-provider-total-${entry.providerId}`}
        >
          <View style={[styles.nameColumn, styles.nameCell]}>
            <ThemedProviderMark provider={entry.provider} size={12} uniProps={mutedMarkColor} />
            <Text style={styles.bodyCell} numberOfLines={1}>
              {entry.label}
            </Text>
          </View>
          <Text style={[styles.bodyCell, styles.valueColumn]} numberOfLines={1}>
            {formatUsd(entry.costUsd)}
          </Text>
          <Text style={[styles.mutedCell, styles.valueColumn]} numberOfLines={1}>
            {formatPercent(entry.costShare)}
          </Text>
          <Text style={[styles.mutedCell, styles.valueColumn]} numberOfLines={1}>
            {formatTokens(entry.totalTokens)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ModelTable({ models }: { models: readonly ProviderUsageHistoryModelTotals[] }) {
  const { t } = useTranslation();

  return (
    <View style={settingsStyles.card}>
      <View style={styles.tableHeader}>
        <Text style={[styles.headerCell, styles.nameColumn]}>
          {t("settings.usageHistory.table.model")}
        </Text>
        <Text style={[styles.headerCell, styles.valueColumn]}>
          {t("settings.usageHistory.table.cost")}
        </Text>
        <Text style={[styles.headerCell, styles.valueColumn]}>
          {t("settings.usageHistory.table.share")}
        </Text>
        <Text style={[styles.headerCell, styles.valueColumn]}>
          {t("settings.usageHistory.table.tokens")}
        </Text>
      </View>
      {models.map((model) => (
        <View
          key={`${model.provider}:${model.model}`}
          style={[styles.tableRow, settingsStyles.rowBorder]}
          testID={`usage-history-model-${model.model}`}
        >
          <View style={[styles.nameColumn, styles.nameCell]}>
            <ThemedProviderMark provider={model.provider} size={12} uniProps={mutedMarkColor} />
            <Text style={styles.bodyCell} numberOfLines={1}>
              {model.model}
            </Text>
          </View>
          <Text style={[styles.bodyCell, styles.valueColumn]} numberOfLines={1}>
            {formatUsd(model.costUsd)}
          </Text>
          <Text style={[styles.mutedCell, styles.valueColumn]} numberOfLines={1}>
            {formatPercent(model.costShare)}
          </Text>
          <Text style={[styles.mutedCell, styles.valueColumn]} numberOfLines={1}>
            {formatTokens(model.totalTokens)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function DayTable({
  totals,
  activeProviders,
}: {
  totals: ProviderUsageHistoryTotals;
  activeProviders: readonly string[];
}) {
  const { t } = useTranslation();
  // Newest first: a 90-day window puts the interesting end at the top.
  const rows = useMemo(() => totals.daily.toReversed(), [totals.daily]);

  return (
    <View style={settingsStyles.card}>
      <View style={styles.tableHeader}>
        <Text style={[styles.headerCell, styles.nameColumn]}>
          {t("settings.usageHistory.table.day")}
        </Text>
        {activeProviders.map((provider) => (
          <Text key={provider} style={[styles.headerCell, styles.valueColumn]} numberOfLines={1}>
            {providerLabel(provider)}
          </Text>
        ))}
        <Text style={[styles.headerCell, styles.valueColumn]}>
          {t("settings.usageHistory.table.total")}
        </Text>
        <Text style={[styles.headerCell, styles.valueColumn]}>
          {t("settings.usageHistory.table.tokens")}
        </Text>
      </View>
      {rows.map((row) => (
        <View
          key={row.day}
          style={[styles.tableRow, settingsStyles.rowBorder]}
          testID={`usage-history-day-${row.day}`}
        >
          <Text style={[styles.bodyCell, styles.nameColumn]}>{formatDayShort(row.day)}</Text>
          {activeProviders.map((provider) => (
            <Text key={provider} style={[styles.mutedCell, styles.valueColumn]} numberOfLines={1}>
              {formatUsd(row.byProvider.get(provider)?.costUsd ?? 0)}
            </Text>
          ))}
          <Text style={[styles.bodyCell, styles.valueColumn]} numberOfLines={1}>
            {formatUsd(row.costUsd)}
          </Text>
          <Text style={[styles.mutedCell, styles.valueColumn]} numberOfLines={1}>
            {formatTokens(row.totalTokens)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  headerControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  summaryCard: {
    padding: theme.spacing[4],
    gap: theme.spacing[3],
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  placeholderCard: {
    // Holds the loaded report's height so results do not shove the page down.
    minHeight: 320,
    padding: theme.spacing[4],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  headline: {
    gap: theme.spacing[0.5],
  },
  headlineValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["4xl"],
    fontWeight: theme.fontWeight.medium,
  },
  headlineSubline: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  providerRow: {
    gap: theme.spacing[0.5],
  },
  providerRowMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  seriesDot: {
    width: SERIES_DOT_SIZE,
    height: SERIES_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
  },
  providerName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    flexShrink: 1,
  },
  providerSessions: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  providerValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  providerDetail: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  providerSubRows: {
    paddingLeft: PROVIDER_NAME_RAIL,
    paddingTop: theme.spacing[0.5],
    gap: theme.spacing[0.5],
  },
  providerSubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  providerSubName: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  providerSubValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  chartBlock: {
    paddingTop: theme.spacing[2],
  },
  totalsCard: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: theme.spacing[4],
    rowGap: theme.spacing[4],
  },
  totalsCell: {
    minWidth: 110,
    flexGrow: 1,
    flexBasis: 0,
    gap: theme.spacing[0.5],
  },
  totalsLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  totalsValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.medium,
  },
  tableHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  nameColumn: {
    flex: 2,
  },
  nameCell: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  valueColumn: {
    flex: 1,
    textAlign: "right",
  },
  headerCell: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  bodyCell: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  mutedCell: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
