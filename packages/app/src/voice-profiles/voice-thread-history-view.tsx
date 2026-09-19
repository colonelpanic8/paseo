import { useCallback, useState, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { VoiceThread, VoiceThreadHistoryEntry } from "@getpaseo/protocol/voice-profiles";
import { Button } from "@/components/ui/button";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { toErrorMessage } from "@/utils/error-messages";
import { useVoiceThreadHistory } from "./voice-profile-queries";

const SUMMARY_MAX_LENGTH = 8000;

function describeEntry(t: TFunction, entry: VoiceThreadHistoryEntry): string {
  switch (entry.kind) {
    case "transcript":
      return entry.text;
    case "call_started":
      return t("voiceProfiles.history.callStarted");
    case "call_ended":
      return t("voiceProfiles.history.callEnded", { cause: entry.cause });
    case "delegation":
      return entry.ok
        ? t("voiceProfiles.history.delegationOk", { description: entry.description })
        : t("voiceProfiles.history.delegationFailed", {
            description: entry.description,
            code: entry.errorCode ?? "error",
          });
  }
}

function HistoryEntryRow({
  entry,
  inSummary,
}: {
  entry: VoiceThreadHistoryEntry;
  inSummary: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const isTranscript = entry.kind === "transcript";
  let speaker: string | null = null;
  if (entry.kind === "transcript")
    speaker = t(
      entry.role === "user" ? "voiceProfiles.history.user" : "voiceProfiles.history.assistant",
    );
  return (
    <View
      style={[styles.entry, inSummary && styles.entryInSummary]}
      testID={`voice-thread-history-${entry.seq}`}
    >
      {speaker ? <Text style={styles.speaker}>{speaker}</Text> : null}
      <Text style={isTranscript ? styles.entryText : styles.entryMeta}>
        {describeEntry(t, entry)}
      </Text>
    </View>
  );
}

/**
 * What the thread remembers, and the one knob the user has over it: the
 * summary that replaces older entries in the model's context. Entries at or
 * below `summaryThroughSeq` stay stored and readable here but are represented
 * to the model only by the summary.
 */
function summaryProjection(
  thread: VoiceThread | null,
  draft: { text: string; base: VoiceThread } | null,
) {
  const summaryValue = draft?.text ?? thread?.summary ?? "";
  const throughSeq = draft?.base.lastSeq ?? thread?.lastSeq ?? 0;
  const summaryDirty =
    thread !== null &&
    draft !== null &&
    (summaryValue.trim() !== thread.summary.trim() || throughSeq > thread.summaryThroughSeq);
  return { summaryValue, throughSeq, summaryDirty };
}

export function VoiceThreadHistoryView({
  serverId,
  threadId,
  disabled,
  onCompact,
}: {
  serverId: string;
  threadId: string;
  disabled: boolean;
  onCompact: (input: { thread: VoiceThread; summary: string; throughSeq: number }) => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();
  const size: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const history = useVoiceThreadHistory(serverId, threadId);
  const thread = history.thread;
  const [summaryDraft, setSummaryDraft] = useState<{ text: string; base: VoiceThread } | null>(
    null,
  );
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const { summaryValue, throughSeq, summaryDirty } = summaryProjection(thread, summaryDraft);
  const handleSummaryChange = useCallback(
    (text: string) => {
      if (thread) setSummaryDraft((current) => ({ text, base: current?.base ?? thread }));
    },
    [thread],
  );
  const handleSave = useCallback(async () => {
    if (!thread) {
      return;
    }
    setIsSaving(true);
    setSummaryError(null);
    try {
      await onCompact({
        thread: summaryDraft?.base ?? thread,
        summary: summaryValue.trim(),
        throughSeq,
      });
      setSummaryDraft(null);
    } catch (error) {
      setSummaryError(toErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }, [onCompact, summaryDraft, summaryValue, thread, throughSeq]);
  const handleSavePress = useCallback(() => {
    void handleSave();
  }, [handleSave]);
  const handleLoadOlder = useCallback(() => {
    void history.loadOlder().catch((error) => setSummaryError(toErrorMessage(error)));
  }, [history]);

  if (history.error) {
    return <Text style={styles.error}>{toErrorMessage(history.error)}</Text>;
  }
  if (!thread) {
    return <Text style={styles.muted}>{t("common.loading")}</Text>;
  }

  return (
    <View style={styles.container}>
      <Field
        label={t("voiceProfiles.history.summary.label")}
        hint={
          thread.summaryThroughSeq > 0
            ? t("voiceProfiles.history.summary.coversThrough", { seq: thread.summaryThroughSeq })
            : t("voiceProfiles.history.summary.hint")
        }
        error={summaryError}
        testID="voice-thread-summary-field"
      >
        <FormTextInput
          size={size}
          initialValue={summaryValue}
          resetKey={`${thread.id}:${summaryDraft?.base.revision ?? thread.revision}`}
          onChangeText={handleSummaryChange}
          editable={!disabled && !isSaving}
          placeholder={t("voiceProfiles.history.summary.placeholder")}
          maxLength={SUMMARY_MAX_LENGTH}
          style={styles.summaryInput}
          multiline
          numberOfLines={5}
          textAlignVertical="top"
          accessibilityLabel={t("voiceProfiles.history.summary.label")}
          testID="voice-thread-summary-input"
        />
      </Field>
      <View style={styles.summaryActions}>
        <Text style={styles.muted}>
          {t("voiceProfiles.history.summary.willCover", { seq: throughSeq })}
        </Text>
        <Button
          size="sm"
          disabled={disabled || !summaryDirty}
          loading={isSaving}
          onPress={handleSavePress}
          testID="voice-thread-summary-save"
        >
          {t("voiceProfiles.history.summary.save")}
        </Button>
      </View>

      <Text style={styles.sectionLabel}>{t("voiceProfiles.history.title")}</Text>
      {history.hasMore ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={handleLoadOlder}
          loading={history.isLoadingOlder}
          disabled={history.isLoadingOlder}
          testID="voice-thread-history-load-older"
        >
          {t("voiceProfiles.history.loadOlder")}
        </Button>
      ) : null}
      {history.entries.length === 0 ? (
        <Text style={styles.muted}>{t("voiceProfiles.history.empty")}</Text>
      ) : (
        <View style={styles.entries}>
          {history.entries.map((entry) => (
            <HistoryEntryRow
              key={entry.seq}
              entry={entry}
              inSummary={entry.seq <= thread.summaryThroughSeq}
            />
          ))}
        </View>
      )}
      <Text style={styles.muted}>{t("voiceProfiles.history.limits")}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    gap: theme.spacing[3],
  },
  summaryInput: {
    minHeight: 120,
  },
  summaryActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  sectionLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    marginTop: theme.spacing[2],
  },
  entries: {
    gap: theme.spacing[2],
  },
  entry: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
  entryInSummary: {
    opacity: theme.opacity[50],
  },
  speaker: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  entryText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  entryMeta: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));
