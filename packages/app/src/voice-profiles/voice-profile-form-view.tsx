import { useCallback, useMemo, useState, useSyncExternalStore, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  VOICE_PROFILE_CONTEXT_MAX_LENGTH,
  VOICE_PROFILE_FILES_MAX,
  VOICE_PROFILE_INSTRUCTIONS_MAX_LENGTH,
  parseProfileFiles,
  type VoiceProfileFormError,
  type VoiceProfileFormModel,
} from "./voice-profile-form-model";

const NONE_OPTION_ID = "__none__";

function resolveFormErrorMessage(t: TFunction, error: VoiceProfileFormError | null): string | null {
  switch (error) {
    case "name_required":
      return t("voiceProfiles.form.errors.nameRequired");
    case "name_too_long":
      return t("voiceProfiles.form.errors.nameTooLong");
    case "too_long":
      return t("voiceProfiles.form.errors.tooLong");
    case "files_invalid":
      return t("voiceProfiles.form.errors.filesInvalid");
    case null:
      return null;
  }
}

/** A blank name is only an error once the user has been in the field. */
function resolveVisibleNameError(
  t: TFunction,
  error: VoiceProfileFormError | null,
  nameTouched: boolean,
): string | null {
  if (error !== "name_required" && error !== "name_too_long") return null;
  if (error === "name_required" && !nameTouched) return null;
  return resolveFormErrorMessage(t, error);
}

/**
 * The fields of a profile. The model owns every value; this renders state and
 * dispatches intent, and the sheet around it owns submit.
 */
export function VoiceProfileFormView({
  model,
  disabled,
}: {
  model: VoiceProfileFormModel;
  disabled: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  const size: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";

  const voiceOptions = useMemo<SelectFieldOption<string>[]>(() => {
    const voices = [...state.voiceOptions];
    const current = state.configuration.voice;
    // A voice chosen on another catalog stays visible rather than silently
    // reading as default; the daemon resolves what it cannot find.
    if (current && !voices.includes(current)) {
      voices.push(current);
    }
    return [
      {
        id: NONE_OPTION_ID,
        value: NONE_OPTION_ID,
        label: t("voiceProfiles.form.voice.default"),
      },
      ...voices.map((voice) => ({ id: voice, value: voice, label: voice })),
    ];
  }, [state.configuration.voice, state.voiceOptions, t]);

  const backendModelOptions = useMemo<SelectFieldOption<string>[]>(() => {
    const current = state.configuration.backendModel;
    const known = state.backendModelOptions.map((option) => ({
      id: option.id,
      value: option.id,
      label: option.label,
    }));
    if (current && !state.backendModelOptions.some((option) => option.id === current)) {
      known.push({ id: current, value: current, label: current });
    }
    return [
      {
        id: NONE_OPTION_ID,
        value: NONE_OPTION_ID,
        label: t("voiceProfiles.form.backendModel.default"),
      },
      ...known,
    ];
  }, [state.backendModelOptions, state.configuration.backendModel, t]);
  const backendModelLabel = state.configuration.backendModel
    ? (state.backendModelOptions.find((option) => option.id === state.configuration.backendModel)
        ?.label ?? state.configuration.backendModel)
    : t("voiceProfiles.form.backendModel.default");

  const thinkingOptions = useMemo<SelectFieldOption<string>[]>(
    () => [
      {
        id: NONE_OPTION_ID,
        value: NONE_OPTION_ID,
        label: t("voiceProfiles.form.backendThinking.default"),
      },
      ...state.availableThinkingOptionIds.map((id) => ({ id, value: id, label: id })),
    ],
    [state.availableThinkingOptionIds, t],
  );

  const voiceDisplay = useMemo(
    () => ({ label: state.configuration.voice ?? t("voiceProfiles.form.voice.default") }),
    [state.configuration.voice, t],
  );
  const modelDisplay = useMemo(() => ({ label: backendModelLabel }), [backendModelLabel]);
  const thinkingDisplay = useMemo(
    () => ({
      label:
        state.configuration.backendThinkingOptionId ??
        t("voiceProfiles.form.backendThinking.default"),
    }),
    [state.configuration.backendThinkingOptionId, t],
  );
  const handleSelectVoice = useCallback(
    (value: string) => {
      model.setVoice(value === NONE_OPTION_ID ? null : value);
    },
    [model],
  );
  const handleSelectBackendModel = useCallback(
    (value: string) => {
      model.setBackendModel(value === NONE_OPTION_ID ? null : value);
    },
    [model],
  );
  const handleSelectThinking = useCallback(
    (value: string) => {
      model.setBackendThinking(value === NONE_OPTION_ID ? null : value);
    },
    [model],
  );

  // A blank name is only an error once the user has been in the field; a
  // pristine form should not open with red text.
  const [nameTouched, setNameTouched] = useState(state.name.length > 0);
  const handleNameChange = useCallback(
    (value: string) => {
      setNameTouched(true);
      model.setName(value);
    },
    [model],
  );
  const nameError = resolveVisibleNameError(t, state.nameError, nameTouched);
  const fileCount = parseProfileFiles(state.filesText).length;

  return (
    <View style={styles.fields}>
      <Field
        label={t("voiceProfiles.form.name.label")}
        error={nameError}
        testID="voice-profile-form-name-field"
      >
        <FormTextInput
          size={size}
          initialValue={state.name}
          onChangeText={handleNameChange}
          editable={!disabled}
          placeholder={t("voiceProfiles.form.name.placeholder")}
          autoCorrect={false}
          accessibilityLabel={t("voiceProfiles.form.name.label")}
          testID="voice-profile-form-name"
        />
      </Field>

      <Field
        label={t("voiceProfiles.form.instructions.label")}
        hint={t("voiceProfiles.form.instructions.hint", {
          length: state.configuration.instructions.length,
          max: VOICE_PROFILE_INSTRUCTIONS_MAX_LENGTH,
        })}
        error={
          state.configuration.instructions.length > VOICE_PROFILE_INSTRUCTIONS_MAX_LENGTH
            ? t("voiceProfiles.form.errors.tooLong")
            : null
        }
      >
        <FormTextInput
          size={size}
          initialValue={state.configuration.instructions}
          onChangeText={model.setInstructions}
          editable={!disabled}
          placeholder={t("voiceProfiles.form.instructions.placeholder")}
          style={styles.multilineInput}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          accessibilityLabel={t("voiceProfiles.form.instructions.label")}
          testID="voice-profile-form-instructions"
        />
      </Field>

      <Field
        label={t("voiceProfiles.form.context.label")}
        hint={t("voiceProfiles.form.context.hint", {
          length: state.configuration.context.length,
          max: VOICE_PROFILE_CONTEXT_MAX_LENGTH,
        })}
        error={
          state.configuration.context.length > VOICE_PROFILE_CONTEXT_MAX_LENGTH
            ? t("voiceProfiles.form.errors.tooLong")
            : null
        }
      >
        <FormTextInput
          size={size}
          initialValue={state.configuration.context}
          onChangeText={model.setContext}
          editable={!disabled}
          placeholder={t("voiceProfiles.form.context.placeholder")}
          style={styles.multilineInputTall}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
          accessibilityLabel={t("voiceProfiles.form.context.label")}
          testID="voice-profile-form-context"
        />
      </Field>

      <Field
        label={t("voiceProfiles.form.files.label")}
        hint={t("voiceProfiles.form.files.hint", {
          count: fileCount,
          max: VOICE_PROFILE_FILES_MAX,
        })}
        error={
          state.nameError === "files_invalid" ? t("voiceProfiles.form.errors.filesInvalid") : null
        }
      >
        <FormTextInput
          size={size}
          initialValue={state.filesText}
          onChangeText={model.setFilesText}
          editable={!disabled}
          placeholder={t("voiceProfiles.form.files.placeholder")}
          style={styles.multilineInput}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel={t("voiceProfiles.form.files.label")}
          testID="voice-profile-form-files"
        />
      </Field>

      <SelectField
        label={t("voiceProfiles.form.voice.label")}
        hint={t("voiceProfiles.form.voice.hint")}
        value={state.configuration.voice ?? NONE_OPTION_ID}
        selectedDisplay={voiceDisplay}
        options={voiceOptions}
        onChange={handleSelectVoice}
        placeholder={t("voiceProfiles.form.voice.default")}
        emptyText={t("voiceProfiles.form.voice.default")}
        disabled={disabled}
        size={size}
        testID="voice-profile-form-voice"
      />

      <SelectField
        label={t("voiceProfiles.form.backendModel.label")}
        hint={t("voiceProfiles.form.backendModel.hint")}
        value={state.configuration.backendModel ?? NONE_OPTION_ID}
        selectedDisplay={modelDisplay}
        options={backendModelOptions}
        onChange={handleSelectBackendModel}
        placeholder={t("voiceProfiles.form.backendModel.default")}
        emptyText={t("voiceProfiles.form.backendModel.default")}
        disabled={disabled}
        size={size}
        testID="voice-profile-form-backend-model"
      />

      {state.configuration.backendModel ? (
        <SelectField
          label={t("voiceProfiles.form.backendThinking.label")}
          hint={t("voiceProfiles.form.backendThinking.hint")}
          value={state.configuration.backendThinkingOptionId ?? NONE_OPTION_ID}
          selectedDisplay={thinkingDisplay}
          options={thinkingOptions}
          onChange={handleSelectThinking}
          placeholder={t("voiceProfiles.form.backendThinking.default")}
          emptyText={t("voiceProfiles.form.backendThinking.default")}
          disabled={disabled || state.availableThinkingOptionIds.length === 0}
          size={size}
          testID="voice-profile-form-backend-thinking"
        />
      ) : null}

      {state.submitError ? (
        <Text style={styles.submitError} testID="voice-profile-form-error">
          {state.submitError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  fields: {
    gap: theme.spacing[4],
  },
  multilineInput: {
    minHeight: 96,
  },
  multilineInputTall: {
    minHeight: 144,
  },
  submitError: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
}));
