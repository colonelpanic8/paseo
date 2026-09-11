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
import { CONTROL_HEIGHTS } from "@/components/ui/control-geometry";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { identityForeground, type IdentityColorName } from "@/styles/identity-colors";
import { useHostRuntimeActiveConnectionLabels, useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { normalizeHostLabel } from "@/types/host-connection";
import {
  BREAKDOWN_DIMENSIONS,
  deriveUsageBreakdown,
  sortBreakdown,
  deriveChartBreakdown,
  type BreakdownDimension,
  type BreakdownSort,
  type SortDirection,
  type UsageBreakdown,
  type BreakdownRow,
} from "./breakdown";
import { ProviderUsageHistoryChart } from "./chart";
import {
  configuredProvidersByKind,
  type ProviderUsageHistoryConfiguredTotals,
  type ProviderUsageHistoryProviderTotals,
} from "./derive";
import {
  mergeProviderUsageHistory,
  type ProviderUsageHistoryDuplicateHosts,
  type ProviderUsageHistoryHostInput,
  type ProviderUsageHistoryReport,
} from "./merge";
import { providerLabel } from "./providers";
import { seriesFillStyle } from "./series";
import type {
  ProviderUsageHistoryMetric,
  ProviderUsageHistoryView,
  ProviderUsageHistoryWindowDays,
} from "./types";
import {
  useProviderUsageHistory,
  type ProviderUsageHistoryHostRef,
} from "./use-provider-usage-history";
import { usageHistoryView } from "./view";
import { enumerateDays, formatPercent, formatTokens, formatUsd } from "./window";

const WINDOW_DAYS: readonly ProviderUsageHistoryWindowDays[] = [7, 30, 90];

const SERIES_DOT_SIZE = 8;
const PROVIDER_MARK_SIZE = 14;
/** Where a provider row's text starts: dot, gap, mark, gap. Sub-rows share it. */
const PROVIDER_NAME_RAIL = SERIES_DOT_SIZE + 8 + PROVIDER_MARK_SIZE + 8;
/** The coverage line is always this tall, so naming a missing host never moves the page. */
const COVERAGE_LINE_HEIGHT = 18;

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

/**
 * Two hosts can carry the same name — three daemons on one machine all call
 * themselves after it — and only the endpoint tells them apart. Suffixing every
 * host with one would be noise, so a name is qualified only when it collides.
 */
function nameUsageHistoryHosts(
  hosts: readonly { readonly serverId: string; readonly label?: string | null }[],
  endpoints: ReadonlyMap<string, string>,
): readonly ProviderUsageHistoryHostRef[] {
  const named = hosts.map((host) => ({
    serverId: host.serverId,
    name: normalizeHostLabel(host.label, host.serverId),
  }));
  const uses = new Map<string, number>();
  for (const host of named) uses.set(host.name, (uses.get(host.name) ?? 0) + 1);

  return named.map((host) => {
    if ((uses.get(host.name) ?? 0) < 2) return host;
    const endpoint = endpoints.get(host.serverId);
    return endpoint === undefined
      ? host
      : { serverId: host.serverId, name: `${host.name} (${endpoint})` };
  });
}

/**
 * Names every host the totals do not cover, plus the hosts whose transcripts
 * another host already reported. One line, so the summary stays a summary.
 */
function coverageLine(
  t: TFunction,
  hosts: readonly ProviderUsageHistoryHostInput[],
  duplicates: readonly ProviderUsageHistoryDuplicateHosts[],
): string {
  const named = (status: ProviderUsageHistoryHostInput["status"]) =>
    hosts.filter((host) => host.status === status).map((host) => host.hostName);
  const parts: string[] = [];

  for (const [status, key] of [
    ["pending", "scanning"],
    ["offline", "offline"],
    ["unsupported", "unsupported"],
    ["error", "failed"],
  ] as const) {
    const names = named(status);
    if (names.length === 0) continue;
    parts.push(
      t(`settings.usageHistory.coverage.${key}`, {
        hosts: names.join(", "),
        count: names.length,
      }),
    );
  }

  if (duplicates.length > 0) {
    // Grouped by claimant: naming every dropped directory produced a line
    // nobody could read past.
    const groups = duplicates.map((group) =>
      t("settings.usageHistory.coverage.duplicateGroup", {
        hosts: group.hostNames.join(", "),
        claimedBy: group.claimedByHostName,
        count: group.hostNames.length,
      }),
    );
    parts.push(t("settings.usageHistory.coverage.duplicates", { groups: groups.join("; ") }));
  }
  return parts.join(" · ");
}

function hostFilterLabel(
  t: TFunction,
  hosts: readonly ProviderUsageHistoryHostRef[],
  selectedServerIds: readonly string[],
  isAllSelected: boolean,
): string {
  if (isAllSelected) return t("settings.usageHistory.hostFilter.all");
  if (selectedServerIds.length === 1) {
    const only = hosts.find((host) => host.serverId === selectedServerIds[0]);
    if (only) return only.name;
  }
  return t("settings.usageHistory.hostFilter.count", { count: selectedServerIds.length });
}

export function ProviderUsageHistorySection() {
  const { t } = useTranslation();
  const [dimensions, setDimensions] = useState<readonly BreakdownDimension[]>(["model"]);
  const [sort, setSort] = useState<BreakdownSort>("costUsd");
  const [direction, setDirection] = useState<SortDirection>("descending");
  const [metric, setMetric] = useState<ProviderUsageHistoryMetric>("cost");
  const [windowDays, setWindowDays] = useState<ProviderUsageHistoryWindowDays>(30);
  /** `null` is every host, including any host added while the page is open. */
  const [selection, setSelection] = useState<readonly string[] | null>(null);

  const allHosts = useHosts();
  const allServerIds = useMemo(() => allHosts.map((host) => host.serverId), [allHosts]);
  const endpoints = useHostRuntimeActiveConnectionLabels(allServerIds);
  const hostRefs = useMemo(() => nameUsageHistoryHosts(allHosts, endpoints), [allHosts, endpoints]);
  const selectedHosts = useMemo(() => {
    if (selection === null) return hostRefs;
    const chosen = hostRefs.filter((host) => selection.includes(host.serverId));
    return chosen.length > 0 ? chosen : hostRefs;
  }, [hostRefs, selection]);

  // Aliased: `window` is the global on web.
  const {
    hosts,
    window: usageWindow,
    isFetching,
    refresh,
  } = useProviderUsageHistory(selectedHosts, windowDays);

  const handleToggleDimension = useCallback((dimension: BreakdownDimension) => {
    setDimensions((current) =>
      current.includes(dimension)
        ? current.filter((value) => value !== dimension)
        : [...current, dimension],
    );
  }, []);
  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);
  const handleWindowChange = useCallback((value: string) => {
    const days = Number.parseInt(value, 10);
    if (days === 7 || days === 30 || days === 90) setWindowDays(days);
  }, []);
  const handleSelectAllHosts = useCallback(() => setSelection(null), []);
  const handleToggleHost = useCallback(
    (serverId: string) => {
      setSelection((current) => {
        const base = current ?? hostRefs.map((host) => host.serverId);
        const next = base.includes(serverId)
          ? base.filter((id) => id !== serverId)
          : [...base, serverId];
        // Emptying the filter, or filling it, is the same request as "all hosts".
        return next.length === 0 || next.length === hostRefs.length ? null : next;
      });
    },
    [hostRefs],
  );

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

  const view = usageHistoryView({ hosts, isFetching });
  const isReady = view.kind === "ready";
  const report = useMemo(
    () => (isReady ? mergeProviderUsageHistory(hosts) : null),
    [hosts, isReady],
  );
  // Totals and Breakdown are their own sections, so they only exist once there
  // is something to break down.
  const activeReport = report !== null && report.daily.length > 0 ? report : null;
  const tableSort = sort === "day" && !dimensions.includes("day") ? "label" : sort;
  const chartBreakdown = useMemo(
    () => (activeReport === null ? null : deriveChartBreakdown(activeReport, dimensions)),
    [activeReport, dimensions],
  );
  const breakdown = useMemo(() => {
    if (activeReport === null) return null;
    const grouped = deriveUsageBreakdown(activeReport, dimensions);
    return { ...grouped, rows: sortBreakdown(grouped.rows, tableSort, direction) };
  }, [activeReport, dimensions, tableSort, direction]);

  const busy = view.kind === "loading" || (view.kind === "ready" && view.isRefreshing);
  const isMultiHost = hostRefs.length > 1;
  const selectedServerIds = useMemo(
    () => selectedHosts.map((host) => host.serverId),
    [selectedHosts],
  );
  const isAllHostsSelected = selectedHosts.length === hostRefs.length;
  const controls = useMemo(
    () => (
      <View style={styles.headerControls}>
        {isMultiHost ? (
          <HostFilter
            hosts={hostRefs}
            selectedServerIds={selectedServerIds}
            isAllSelected={isAllHostsSelected}
            onSelectAll={handleSelectAllHosts}
            onToggle={handleToggleHost}
          />
        ) : null}
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
    [
      busy,
      handleRefresh,
      handleSelectAllHosts,
      handleToggleHost,
      handleWindowChange,
      hostRefs,
      isAllHostsSelected,
      isMultiHost,
      metric,
      metricOptions,
      selectedServerIds,
      t,
      windowDays,
      windowOptions,
    ],
  );

  return (
    <View>
      <SettingsSection
        title={t("settings.usageHistory.title")}
        info={t("settings.usageHistory.info")}
        testID="usage-history-section"
      >
        {controls}
        <View style={styles.breakdownControls} testID="usage-history-breakdown">
          <Text style={styles.headerCell}>{t("settings.usageHistory.breakdown.title")}</Text>
          {BREAKDOWN_DIMENSIONS.map((dimension) => (
            <DimensionButton
              key={dimension}
              dimension={dimension}
              selected={dimensions.includes(dimension)}
              onToggle={handleToggleDimension}
            />
          ))}
        </View>
        <ProviderUsageHistoryBody
          view={view}
          report={activeReport}
          breakdown={chartBreakdown}
          hosts={hosts}
          showCoverage={isMultiHost}
          metric={metric}
          sinceDay={usageWindow.sinceDay}
          untilDay={usageWindow.untilDay}
          onRetry={handleRefresh}
        />
      </SettingsSection>
      {activeReport === null ? null : (
        <>
          <Totals totals={activeReport} />
          {breakdown === null ? null : (
            <Breakdown
              breakdown={breakdown}
              metric={metric}
              sort={tableSort}
              direction={direction}
              onSort={setSort}
              onDirection={setDirection}
            />
          )}
        </>
      )}
    </View>
  );
}

function DimensionButton({
  dimension,
  selected,
  onToggle,
}: {
  dimension: BreakdownDimension;
  selected: boolean;
  onToggle: (dimension: BreakdownDimension) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onToggle(dimension), [dimension, onToggle]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <Button
      size="xs"
      variant={selected ? "secondary" : "ghost"}
      accessibilityState={accessibilityState}
      testID={`usage-history-group-${dimension}`}
      onPress={handlePress}
    >
      {t(`settings.usageHistory.breakdown.${dimension}`)}
    </Button>
  );
}

function HostFilter({
  hosts,
  selectedServerIds,
  isAllSelected,
  onSelectAll,
  onToggle,
}: {
  hosts: readonly ProviderUsageHistoryHostRef[];
  selectedServerIds: readonly string[];
  isAllSelected: boolean;
  onSelectAll: () => void;
  onToggle: (serverId: string) => void;
}) {
  const { t } = useTranslation();
  const label = hostFilterLabel(t, hosts, selectedServerIds, isAllSelected);

  return (
    <DropdownMenu>
      <DropdownTrigger
        accessibilityRole="button"
        accessibilityLabel={`${t("settings.usageHistory.hostFilter.label")}: ${label}`}
        style={styles.hostFilterTrigger}
        testID="usage-history-host-filter"
      >
        <Text style={styles.hostFilterLabel} numberOfLines={1}>
          {label}
        </Text>
      </DropdownTrigger>
      <DropdownMenuContent side="bottom" align="end" width={240}>
        <DropdownMenuItem
          selected={isAllSelected}
          showSelectedCheck
          closeOnSelect={false}
          onSelect={onSelectAll}
        >
          {t("settings.usageHistory.hostFilter.all")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {hosts.map((host) => (
          <HostFilterItem
            key={host.serverId}
            host={host}
            selected={selectedServerIds.includes(host.serverId)}
            onToggle={onToggle}
          />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HostFilterItem({
  host,
  selected,
  onToggle,
}: {
  host: ProviderUsageHistoryHostRef;
  selected: boolean;
  onToggle: (serverId: string) => void;
}) {
  const handleSelect = useCallback(() => onToggle(host.serverId), [host.serverId, onToggle]);
  return (
    <DropdownMenuItem
      selected={selected}
      showSelectedCheck
      closeOnSelect={false}
      onSelect={handleSelect}
      testID={`usage-history-host-option-${host.serverId}`}
    >
      {host.name}
    </DropdownMenuItem>
  );
}

interface ProviderUsageHistoryBodyProps {
  view: ProviderUsageHistoryView;
  report: ProviderUsageHistoryReport | null;
  breakdown: UsageBreakdown | null;
  hosts: readonly ProviderUsageHistoryHostInput[];
  showCoverage: boolean;
  metric: ProviderUsageHistoryMetric;
  sinceDay: string;
  untilDay: string;
  onRetry: () => void;
}

function ProviderUsageHistoryBody({
  view,
  report,
  breakdown,
  hosts,
  showCoverage,
  metric,
  sinceDay,
  untilDay,
  onRetry,
}: ProviderUsageHistoryBodyProps) {
  const { t } = useTranslation();

  if (view.kind === "noHosts") {
    return <Text style={styles.emptyText}>{t("settings.usageHistory.addHost")}</Text>;
  }

  if (view.kind === "loading") {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.emptyText}>{t("common.states.loading")}</Text>
      </View>
    );
  }

  if (view.kind === "unavailable") {
    return <Text style={styles.emptyText}>{t(view.messageKey)}</Text>;
  }

  if (view.kind === "error") {
    return (
      <Alert
        variant="error"
        title={t("settings.usageHistory.errorTitle")}
        description={t("settings.usageHistory.readFailed")}
      >
        <Button variant="outline" size="sm" onPress={onRetry}>
          {t("common.actions.retry")}
        </Button>
      </Alert>
    );
  }

  if (report === null || breakdown === null) {
    return (
      <>
        <Text style={styles.emptyText}>{t("settings.usageHistory.empty")}</Text>
        {showCoverage ? (
          <Text style={styles.coverage} numberOfLines={2} testID="usage-history-coverage">
            {coverageLine(t, hosts, [])}
          </Text>
        ) : null}
      </>
    );
  }

  return (
    <Summary
      totals={report}
      breakdown={breakdown}
      hosts={hosts}
      showCoverage={showCoverage}
      metric={metric}
      sinceDay={sinceDay}
      untilDay={untilDay}
    />
  );
}

interface SummaryProps {
  breakdown: UsageBreakdown;
  totals: ProviderUsageHistoryReport;
  hosts: readonly ProviderUsageHistoryHostInput[];
  showCoverage: boolean;
  metric: ProviderUsageHistoryMetric;
  sinceDay: string;
  untilDay: string;
}

function Summary({
  totals,
  breakdown,
  hosts,
  showCoverage,
  metric,
  sinceDay,
  untilDay,
}: SummaryProps) {
  const { t } = useTranslation();
  const days = useMemo(() => enumerateDays(sinceDay, untilDay), [sinceDay, untilDay]);
  const series = useMemo(
    () =>
      breakdown.rows.map((row) => ({
        ...row,
        label: row.label || t("settings.usageHistory.table.total"),
      })),
    [breakdown.rows, t],
  );
  // A kind only earns sub-rows once more than one configured provider used it.
  const configuredByKind = useMemo(
    () => configuredProvidersByKind(totals.configuredProviders),
    [totals.configuredProviders],
  );

  return (
    <View style={styles.summary} testID="usage-history-summary">
      <Headline totals={totals} metric={metric} />
      <View testID="usage-history-chart">
        <ProviderUsageHistoryChart
          days={days}
          daily={breakdown.daily}
          series={series}
          metric={metric}
        />
      </View>
      <View style={styles.figures} testID="usage-history-figures">
        {totals.providers.map((entry) => {
          const configured = configuredByKind.get(entry.provider) ?? [];
          return (
            <View key={entry.provider} style={styles.providerSummary}>
              <ProviderRow
                entry={entry}
                metric={metric}
                configured={configured.length > 1 ? configured : []}
              />
            </View>
          );
        })}
      </View>
      {showCoverage ? (
        <Text style={styles.coverage} numberOfLines={2} testID="usage-history-coverage">
          {coverageLine(t, hosts, totals.duplicates)}
        </Text>
      ) : null}
      {totals.unreadableProviders.length === 0 ? null : (
        <Text style={styles.footnote} testID="usage-history-unreadable">
          {t("settings.usageHistory.summary.unreadableProviders", {
            providers: totals.unreadableProviders.join(", "),
          })}
        </Text>
      )}
      {totals.unpricedRecords > 0 ? (
        <Text style={styles.footnote} testID="usage-history-unpriced">
          {t("settings.usageHistory.unpricedNote", { count: totals.unpricedRecords })}
        </Text>
      ) : null}
      {totals.pricingUnavailable ? (
        <Text style={styles.footnote}>{t("settings.usageHistory.pricingUnavailable")}</Text>
      ) : null}
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
  totals: ProviderUsageHistoryReport;
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
  configured,
}: {
  entry: ProviderUsageHistoryProviderTotals;
  metric: ProviderUsageHistoryMetric;
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
        <View style={[styles.seriesDot, seriesFillStyle(entry.provider)]} />
        <ThemedProviderMark
          provider={entry.provider}
          size={PROVIDER_MARK_SIZE}
          uniProps={mutedMarkColor}
        />
        <Text style={styles.providerName} numberOfLines={1}>
          {providerLabel(entry.provider)}
        </Text>
        <Text style={styles.providerValue}>
          {metric === "cost" ? formatUsd(entry.costUsd) : formatTokens(entry.totalTokens)}
        </Text>
      </View>
      <Text style={styles.providerDetail} numberOfLines={1}>
        {`${sessionsLabel(t, entry.sessions)} · ${detail}`}
      </Text>
      {configured.length === 0 ? null : (
        <View style={styles.providerSubRows}>
          {configured.map((configuredProvider) => (
            <View
              key={configuredProvider.id}
              style={styles.providerSubRow}
              testID={`usage-history-provider-sub-${configuredProvider.id}`}
            >
              {/* Host-qualified labels do not fit the summary column on one
                  line, and the endpoint at the tail is the part that tells two
                  same-named hosts apart, so wrap rather than clip it away.
                  `ellipsizeMode` cannot save it: on web it is CSS
                  `text-overflow`, which only ever ellipsizes the end. */}
              <Text style={styles.providerSubName} numberOfLines={2}>
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

function Totals({ totals }: { totals: ProviderUsageHistoryReport }) {
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
      <View style={styles.totalsRow}>
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

interface BreakdownProps {
  breakdown: UsageBreakdown;
  metric: ProviderUsageHistoryMetric;
  sort: BreakdownSort;
  direction: SortDirection;
  onSort: (sort: BreakdownSort) => void;
  onDirection: (direction: SortDirection) => void;
}

function Breakdown({ breakdown, metric, sort, direction, onSort, onDirection }: BreakdownProps) {
  const { t } = useTranslation();
  const handleDirection = useCallback(() => {
    onDirection(direction === "ascending" ? "descending" : "ascending");
  }, [direction, onDirection]);
  const sortOptions: SegmentedControlOption<BreakdownSort>[] = [
    { value: "label", label: t("settings.usageHistory.sort.group") },
    ...(breakdown.rows.some((row) => row.day !== "")
      ? [{ value: "day" as const, label: t("settings.usageHistory.breakdown.day") }]
      : []),
    { value: "costUsd", label: t("settings.usageHistory.table.cost") },
    { value: "totalTokens", label: t("settings.usageHistory.table.tokens") },
  ];
  return (
    <SettingsSection title={t("settings.usageHistory.breakdown.title")}>
      <View style={styles.breakdownControls}>
        <Text style={styles.headerCell}>{t("settings.usageHistory.sort.label")}</Text>
        <SegmentedControl
          size="xs"
          options={sortOptions}
          value={sort}
          onValueChange={onSort}
          testID="usage-history-sort"
        />
        <Button
          size="xs"
          variant="outline"
          testID="usage-history-sort-direction"
          onPress={handleDirection}
        >
          {t(`settings.usageHistory.sort.${direction}`)}
        </Button>
      </View>
      <View testID="usage-history-table">
        <View style={styles.tableHeader}>
          <Text style={[styles.headerCell, styles.nameColumn]}>
            {t("settings.usageHistory.sort.group")}
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
        {breakdown.rows.map((row) => (
          <BreakdownTableRow key={row.key} row={row} metric={metric} />
        ))}
      </View>
    </SettingsSection>
  );
}

function BreakdownTableRow({
  row,
  metric,
}: {
  row: BreakdownRow;
  metric: ProviderUsageHistoryMetric;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.tableRow} testID="usage-history-breakdown-row">
      <View style={[styles.nameColumn, styles.nameCell]}>
        <View style={[styles.seriesDot, styles.groupDot(row.colorName)]} />
        <Text style={[styles.bodyCell, styles.groupLabel]}>
          {row.label || t("settings.usageHistory.table.total")}
        </Text>
      </View>
      <Text style={[styles.bodyCell, styles.valueColumn]}>{formatUsd(row.costUsd)}</Text>
      <Text style={[styles.mutedCell, styles.valueColumn]}>
        {formatPercent(metric === "cost" ? row.costShare : row.tokenShare)}
      </Text>
      <Text style={[styles.mutedCell, styles.valueColumn]}>{formatTokens(row.totalTokens)}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  headerControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    flexShrink: 1,
    gap: theme.spacing[2],
  },
  hostFilterTrigger: {
    minHeight: CONTROL_HEIGHTS.tight,
    maxWidth: 180,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  hostFilterLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  // The page is flat rather than carded, so its content sits on the same
  // leading rail as the section headers above it.
  summary: {
    paddingHorizontal: theme.spacing[1],
    gap: theme.spacing[2],
  },
  breakdownControls: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  figures: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[6],
    marginTop: theme.spacing[4],
  },
  providerSummary: { flexGrow: 1, flexBasis: 260, gap: theme.spacing[3] },
  groupLabel: { flex: 1 },
  groupDot: (name: IdentityColorName) => ({
    backgroundColor: identityForeground(name, theme.colorScheme),
  }),
  placeholder: {
    // Holds the loaded report's height so results do not shove the page down.
    minHeight: 320,
    paddingHorizontal: theme.spacing[1],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    paddingHorizontal: theme.spacing[1],
  },
  coverage: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: COVERAGE_LINE_HEIGHT,
    minHeight: COVERAGE_LINE_HEIGHT,
  },
  footnote: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  headline: {
    gap: theme.spacing[0.5],
  },
  headlineValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize["4xl"],
    fontWeight: theme.fontWeight.semibold,
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
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    flexShrink: 1,
  },
  providerValue: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
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
  totalsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: theme.spacing[1],
    columnGap: theme.spacing[6],
    rowGap: theme.spacing[4],
  },
  totalsCell: {
    minWidth: 100,
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
    paddingHorizontal: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  // Only the divider separates rows; the table carries no border of its own.
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[3],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
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
