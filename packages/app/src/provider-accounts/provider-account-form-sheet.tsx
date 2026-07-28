import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { MutableDaemonConfig, MutableDaemonConfigPatch } from "@getpaseo/protocol/messages";
import type { AgentProvider } from "@getpaseo/protocol/agent-types";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  buildProviderAccountConfigPatch,
  listProviderAccountConfigDirs,
  type ProviderAccountBase,
} from "./provider-account-config";
import {
  openProviderAccountForm,
  type ProviderAccountConfigDirError,
  type ProviderAccountNameError,
} from "./provider-account-form-model";
import { useTranslation } from "react-i18next";

interface ProviderAccountFormSheetProps {
  base: ProviderAccountBase;
  config: MutableDaemonConfig;
  existingProviderIds: ReadonlySet<string>;
  patchConfig: (patch: MutableDaemonConfigPatch) => Promise<MutableDaemonConfig | undefined>;
  refreshProviders: (providers?: AgentProvider[]) => Promise<void>;
  onClose: () => void;
}

function nameErrorMessage(
  error: ProviderAccountNameError,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  return error === "required" ? t("settings.providers.accounts.errors.nameRequired") : null;
}

function configDirErrorMessage(
  error: ProviderAccountConfigDirError,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  if (error === "required") {
    return t("settings.providers.accounts.errors.directoryRequired");
  }
  if (error === "absolute") {
    return t("settings.providers.accounts.errors.directoryAbsolute");
  }
  if (error === "duplicate") {
    return t("settings.providers.accounts.errors.directoryDuplicate");
  }
  return null;
}

export function ProviderAccountFormSheet({
  base,
  config,
  existingProviderIds,
  patchConfig,
  refreshProviders,
  onClose,
}: ProviderAccountFormSheetProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [model] = useState(() =>
    openProviderAccountForm({
      existingConfigDirs: listProviderAccountConfigDirs(base, config),
    }),
  );
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);

  useEffect(() => () => model.close(), [model]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("settings.providers.accounts.addTitle", { provider: base.label }),
    }),
    [base.label, t],
  );
  const controlSize = isCompact ? "md" : "sm";

  const handleSubmit = useCallback(async () => {
    const draft = model.beginSubmit();
    if (!draft) return;

    try {
      const { providerId, patch } = buildProviderAccountConfigPatch(
        base,
        draft,
        existingProviderIds,
      );
      const updatedConfig = await patchConfig(patch);
      if (!updatedConfig) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      await refreshProviders([providerId]);
      onClose();
    } catch (error) {
      model.endSubmit(error instanceof Error ? error.message : String(error));
    }
  }, [base, existingProviderIds, model, onClose, patchConfig, refreshProviders, t]);
  const handleSubmitPress = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          style={styles.footerButton}
          variant="secondary"
          onPress={onClose}
          disabled={state.isSubmitting}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          style={styles.footerButton}
          variant="default"
          onPress={handleSubmitPress}
          disabled={!state.canSubmit}
          loading={state.isSubmitting}
          testID={`${base.providerId}-account-submit`}
        >
          {t("settings.providers.accounts.add")}
        </Button>
      </View>
    ),
    [base.providerId, handleSubmitPress, onClose, state.canSubmit, state.isSubmitting, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      testID={`${base.providerId}-account-form-sheet`}
    >
      <Field
        label={t("settings.providers.accounts.name")}
        error={nameErrorMessage(state.nameError, t)}
        testID={`${base.providerId}-account-name-field`}
      >
        <FormTextInput
          size={controlSize}
          value={state.name}
          onChangeText={model.setName}
          placeholder={t("settings.providers.accounts.namePlaceholder")}
          autoCapitalize="words"
          autoCorrect={false}
          editable={!state.isSubmitting}
          testID={`${base.providerId}-account-name`}
        />
      </Field>
      <Field
        label={t("settings.providers.accounts.directory")}
        hint={t("settings.providers.accounts.directoryHint", { envVar: base.accounts.envVar })}
        error={configDirErrorMessage(state.configDirError, t)}
        testID={`${base.providerId}-account-directory-field`}
      >
        <FormTextInput
          size={controlSize}
          value={state.configDir}
          onChangeText={model.setConfigDir}
          placeholder={base.accounts.directoryExample}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!state.isSubmitting}
          testID={`${base.providerId}-account-directory`}
        />
      </Field>
      {state.submitError ? <Text style={styles.errorText}>{state.submitError}</Text> : null}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  footerButton: {
    minWidth: 112,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));
