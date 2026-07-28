import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/form-field";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  resolveCustomAgentSnoozeDate,
  resolveDefaultCustomAgentSnoozeDate,
} from "@/agent-snooze/model";
import { useCustomSnoozeStore, type CustomSnoozeRequest } from "@/agent-snooze/custom-snooze-store";
import { CustomSnoozeDateTimePicker } from "@/agent-snooze/date-time-picker-field";

const MAX_TIMEOUT_MS = 2_147_483_647;

const styles = StyleSheet.create((theme) => ({
  fields: {
    gap: theme.spacing[4],
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  footerButton: {
    minWidth: 104,
  },
}));

function OpenCustomSnoozeSheet({
  request,
  visible,
  onClose,
  onDismiss,
}: {
  request: CustomSnoozeRequest;
  visible: boolean;
  onClose: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(request.serverId);
  const isConnected = useHostRuntimeIsConnected(request.serverId);
  const minimumDate = useMemo(() => new Date(), []);
  const [snoozedUntil, setSnoozedUntil] = useState(() =>
    resolveDefaultCustomAgentSnoozeDate(minimumDate),
  );
  const [validationNowMs, setValidationNowMs] = useState(() => Date.now());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const validation = useMemo(
    () => resolveCustomAgentSnoozeDate(snoozedUntil, new Date(validationNowMs)),
    [snoozedUntil, validationNowMs],
  );
  const validationError = validation.error;
  useEffect(() => {
    const remainingMs = snoozedUntil.getTime() - Date.now();
    if (remainingMs <= 0) {
      return;
    }
    const timeout = setTimeout(
      () => setValidationNowMs(Date.now()),
      Math.min(remainingMs + 50, MAX_TIMEOUT_MS),
    );
    return () => clearTimeout(timeout);
  }, [snoozedUntil, validationNowMs]);
  const handleSnoozedUntilChange = useCallback((value: Date) => {
    setSnoozedUntil(value);
    setValidationNowMs(Date.now());
  }, []);
  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      onClose();
    }
  }, [isSubmitting, onClose]);
  const handleSubmit = useCallback(async () => {
    const result = resolveCustomAgentSnoozeDate(snoozedUntil, new Date());
    if (!result.snoozedUntil || !client || !isConnected) {
      if (!result.snoozedUntil) {
        setValidationNowMs(Date.now());
      }
      if (!client || !isConnected) {
        toast.error(t("workspace.terminal.hostDisconnected"));
      }
      return;
    }
    setIsSubmitting(true);
    toast.show(t("workspace.tabs.toasts.snoozingAgent"), { durationMs: null });
    try {
      await client.updateAgent(request.agentId, { snoozeUntil: result.snoozedUntil });
      toast.show(t("workspace.tabs.toasts.snoozedAgent"), { variant: "success" });
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("workspace.tabs.toasts.failedToSnoozeAgent"),
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [client, isConnected, onClose, request.agentId, snoozedUntil, t, toast]);
  const handleSubmitPress = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);
  const header = useMemo<SheetHeader>(
    () => ({ title: t("workspace.tabs.customSnooze.title") }),
    [t],
  );
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          variant="secondary"
          style={styles.footerButton}
          disabled={isSubmitting}
          onPress={handleClose}
          testID="agent-custom-snooze-cancel"
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          style={styles.footerButton}
          disabled={Boolean(validationError) || !isConnected}
          loading={isSubmitting}
          onPress={handleSubmitPress}
          testID="agent-custom-snooze-submit"
        >
          {t("workspace.tabs.customSnooze.confirm")}
        </Button>
      </View>
    ),
    [handleClose, handleSubmitPress, isConnected, isSubmitting, t, validationError],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={handleClose}
      onDismiss={onDismiss}
      footer={footer}
      snapPoints={["45%"]}
      testID="agent-custom-snooze-sheet"
    >
      <View style={styles.fields}>
        <Field
          label={t("workspace.tabs.customSnooze.until")}
          error={validationError ? t("workspace.tabs.customSnooze.pastTime") : null}
          testID="agent-custom-snooze-datetime"
        >
          <CustomSnoozeDateTimePicker
            value={snoozedUntil}
            minimumDate={minimumDate}
            onChange={handleSnoozedUntilChange}
            disabled={isSubmitting}
            untilLabel={t("workspace.tabs.customSnooze.until")}
            dateLabel={t("workspace.tabs.customSnooze.date")}
            timeLabel={t("workspace.tabs.customSnooze.time")}
          />
        </Field>
      </View>
    </AdaptiveModalSheet>
  );
}

export function AgentCustomSnoozeSheetHost() {
  const request = useCustomSnoozeStore((state) => state.request);
  const close = useCustomSnoozeStore((state) => state.close);
  const [renderedRequest, setRenderedRequest] = useState<CustomSnoozeRequest | null>(request);
  const [visible, setVisible] = useState(Boolean(request));

  useEffect(() => {
    if (request) {
      setRenderedRequest(request);
      setVisible(true);
      return;
    }
    setVisible(false);
  }, [request]);

  const handleClose = useCallback(() => {
    setVisible(false);
    close();
  }, [close]);
  const handleDismiss = useCallback(() => {
    setVisible(false);
    setRenderedRequest(null);
  }, []);

  if (!renderedRequest) {
    return null;
  }
  return (
    <OpenCustomSnoozeSheet
      key={renderedRequest.id}
      request={renderedRequest}
      visible={visible}
      onClose={handleClose}
      onDismiss={handleDismiss}
    />
  );
}
