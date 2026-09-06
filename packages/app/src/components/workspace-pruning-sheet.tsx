import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { useFetchQuery } from "@/data/query";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";

interface WorkspacePruningSheetProps {
  serverId: string;
  onClose: () => void;
}

function useWorkspacePruningOperation(serverId: string) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const host = useHosts().find((entry) => entry.serverId === serverId);
  const supported = useHostFeature(serverId, "workspacePrune");
  const canPrune = connected && supported;
  const preview = useFetchQuery({
    dataShape: "value",
    staleTimeMs: 0,
    queryKey: ["workspace-pruning", serverId],
    enabled: canPrune,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientDisconnected"));
      const result = await client.pruneWorkspaces({ dryRun: true });
      if (result.error) throw new Error(result.error);
      return result;
    },
  });
  const archive = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientDisconnected"));
      const result = await client.pruneWorkspaces();
      if (result.error) throw new Error(result.error);
      return result;
    },
  });
  const result = archive.data ?? preview.data;
  const failure = archive.error ?? preview.error;
  const busy = preview.isFetching || archive.isPending;
  const hasCandidates = (preview.data?.workspaces.length ?? 0) > 0;
  const partialArchive = (archive.data?.errors.length ?? 0) > 0;
  const retryArchive = archive.isError || partialArchive;
  const canArchive = hasCandidates && !archive.isSuccess;
  const previewFailed = preview.isError || (preview.data?.errors.length ?? 0) > 0;
  const canRetryPreview = previewFailed && archive.isIdle;
  return {
    preview,
    archive,
    result,
    failure,
    busy,
    supported,
    connected,
    canPrune,
    canArchive,
    canRetryPreview,
    retryArchive,
    hostLabel: host?.label ?? serverId,
  };
}

export function WorkspacePruningSheet({ serverId, onClose }: WorkspacePruningSheetProps) {
  const { t } = useTranslation();
  const {
    preview,
    archive,
    result,
    failure,
    busy,
    supported,
    connected,
    canPrune,
    canArchive,
    canRetryPreview,
    retryArchive,
    hostLabel,
  } = useWorkspacePruningOperation(serverId);
  const header = useMemo(() => ({ title: t("workspacePruning.title") }), [t]);
  const close = useCallback(() => {
    if (!archive.isPending) onClose();
  }, [archive.isPending, onClose]);
  const { refetch } = preview;
  const { mutate } = archive;
  const retryPreview = useCallback(() => {
    void refetch();
  }, [refetch]);
  const archiveMissing = useCallback(() => mutate(), [mutate]);

  return (
    <AdaptiveModalSheet visible header={header} onClose={close} testID="workspace-pruning-sheet">
      <View style={styles.body}>
        <Text style={styles.description}>
          {t("workspacePruning.description", { host: hostLabel })}
        </Text>
        {!connected ? (
          <Alert variant="warning" description={t("common.errors.daemonClientDisconnected")} />
        ) : null}
        {connected && !supported ? (
          <Alert variant="warning" description={t("workspacePruning.updateHost")} />
        ) : null}
        {busy ? (
          <Text
            style={styles.description}
            accessibilityLiveRegion="polite"
            testID="workspace-pruning-pending"
          >
            {archive.isPending ? t("workspacePruning.archiving") : t("workspacePruning.scanning")}
          </Text>
        ) : null}
        {failure ? (
          <Alert variant="error" description={failure.message} testID="workspace-pruning-error" />
        ) : null}
        {result && !busy ? (
          <View style={styles.body}>
            <Text style={styles.summary} testID="workspace-pruning-summary">
              {archive.isSuccess
                ? t("workspacePruning.archived", { count: result.workspaces.length })
                : t("workspacePruning.missing", { count: result.workspaces.length })}
            </Text>
            {result.workspaces.map((workspace) => (
              <Text key={workspace.workspaceId} style={styles.description}>
                {workspace.directory}
              </Text>
            ))}
            {result.errors.length > 0 ? (
              <Alert
                variant="error"
                title={t("workspacePruning.partialFailure")}
                description={result.errors
                  .map((entry) => `${entry.directory}: ${entry.error}`)
                  .join("\n")}
                testID="workspace-pruning-partial-error"
              />
            ) : null}
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            onPress={close}
            disabled={archive.isPending}
            testID="workspace-pruning-close"
          >
            {t("common.actions.close")}
          </Button>
          {canPrune && canRetryPreview ? (
            <Button size="sm" onPress={retryPreview} disabled={busy}>
              {t("common.actions.retry")}
            </Button>
          ) : null}
          {canPrune && (canArchive || retryArchive) ? (
            <Button
              size="sm"
              onPress={archiveMissing}
              disabled={busy}
              testID="workspace-pruning-archive"
            >
              {retryArchive ? t("common.actions.retry") : t("workspacePruning.archive")}
            </Button>
          ) : null}
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { gap: theme.spacing[3] },
  description: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  summary: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.spacing[2] },
}));
