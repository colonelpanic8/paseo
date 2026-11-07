import {
  DEFAULT_VOICE_PROFILE_CONFIGURATION,
  type VoiceProfileConfiguration,
} from "@getpaseo/protocol/voice-profiles";

/**
 * Bounds mirror the wire schema. The daemon rejects longer values, so the form
 * stops the user first rather than failing on submit.
 */
export const VOICE_PROFILE_NAME_MAX_LENGTH = 120;
export const VOICE_PROFILE_INSTRUCTIONS_MAX_LENGTH = 1000;
export const VOICE_PROFILE_CONTEXT_MAX_LENGTH = 8000;
export const VOICE_PROFILE_FILES_MAX = 16;

export type VoiceProfileFormMode = "create" | "edit";

export interface VoiceProfileFormRecord {
  id: string;
  name: string;
  configuration: VoiceProfileConfiguration;
  revision: number;
}

export interface VoiceProfileFormBackendModelOption {
  id: string;
  label: string;
  thinkingOptionIds: string[];
}

export interface VoiceProfileFormSnapshot {
  mode: VoiceProfileFormMode;
  /** The record being edited. Required in edit mode. */
  record?: VoiceProfileFormRecord;
  voiceOptions: readonly string[];
  backendModelOptions: readonly VoiceProfileFormBackendModelOption[];
}

export type VoiceProfileFormError =
  | "name_required"
  | "name_too_long"
  | "too_long"
  | "files_invalid";

export interface VoiceProfileFormState {
  mode: VoiceProfileFormMode;
  name: string;
  configuration: VoiceProfileConfiguration;
  /** The files field as typed, one path per line; parsed on submit. */
  filesText: string;
  voiceOptions: string[];
  backendModelOptions: VoiceProfileFormBackendModelOption[];
  /** Thinking ids the chosen backend model supports; empty without a model. */
  availableThinkingOptionIds: string[];
  nameError: VoiceProfileFormError | null;
  canSubmit: boolean;
  submitError: string | null;
}

export interface VoiceProfileFormModel {
  getState: () => VoiceProfileFormState;
  subscribe: (listener: () => void) => () => void;
  close: () => void;
  applyVoiceOptions: (voices: readonly string[]) => void;
  applyBackendModelOptions: (options: readonly VoiceProfileFormBackendModelOption[]) => void;
  setName: (value: string) => void;
  setInstructions: (value: string) => void;
  setContext: (value: string) => void;
  setFilesText: (value: string) => void;
  setVoice: (voice: string | null) => void;
  setBackendModel: (model: string | null) => void;
  setBackendThinking: (thinkingOptionId: string | null) => void;
  setSubmitError: (value: string | null) => void;
  buildSaveInput: () => {
    profileId?: string;
    expectedRevision?: number;
    name: string;
    configuration: VoiceProfileConfiguration;
  };
}

/** One path per line; blank lines are ignored. */
export function parseProfileFiles(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function filesAreValid(files: readonly string[]): boolean {
  return (
    files.length <= VOICE_PROFILE_FILES_MAX &&
    files.every((file) => file.startsWith("/") || file === "~" || file.startsWith("~/"))
  );
}

function normalizeConfiguration(
  configuration: VoiceProfileConfiguration,
  filesText: string,
): VoiceProfileConfiguration {
  return {
    instructions: configuration.instructions.trim(),
    context: configuration.context.trim(),
    files: parseProfileFiles(filesText),
    voice: configuration.voice?.trim() || null,
    backendModel: configuration.backendModel?.trim() || null,
    backendThinkingOptionId: configuration.backendThinkingOptionId?.trim() || null,
  };
}

function resolveNameError(name: string): VoiceProfileFormError | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return "name_required";
  }
  if (trimmed.length > VOICE_PROFILE_NAME_MAX_LENGTH) {
    return "name_too_long";
  }
  return null;
}

function resolveThinkingOptionIds(
  options: readonly VoiceProfileFormBackendModelOption[],
  backendModel: string | null,
): string[] {
  if (!backendModel) {
    return [];
  }
  return options.find((option) => option.id === backendModel)?.thinkingOptionIds ?? [];
}

export function openVoiceProfileForm(snapshot: VoiceProfileFormSnapshot): VoiceProfileFormModel {
  const listeners = new Set<() => void>();
  let closed = false;

  const initialConfiguration =
    snapshot.mode === "edit" && snapshot.record
      ? snapshot.record.configuration
      : DEFAULT_VOICE_PROFILE_CONFIGURATION;
  const initialName = snapshot.mode === "edit" && snapshot.record ? snapshot.record.name : "";

  let state: VoiceProfileFormState = derive({
    mode: snapshot.mode,
    name: initialName,
    configuration: { ...initialConfiguration, files: [...initialConfiguration.files] },
    filesText: initialConfiguration.files.join("\n"),
    voiceOptions: [...snapshot.voiceOptions],
    backendModelOptions: [...snapshot.backendModelOptions],
    availableThinkingOptionIds: [],
    nameError: null,
    canSubmit: false,
    submitError: null,
  });

  function derive(next: VoiceProfileFormState): VoiceProfileFormState {
    const nameError = resolveNameError(next.name);
    const availableThinkingOptionIds = resolveThinkingOptionIds(
      next.backendModelOptions,
      next.configuration.backendModel,
    );
    const tooLong =
      next.configuration.instructions.length > VOICE_PROFILE_INSTRUCTIONS_MAX_LENGTH ||
      next.configuration.context.length > VOICE_PROFILE_CONTEXT_MAX_LENGTH;
    const filesInvalid = !filesAreValid(parseProfileFiles(next.filesText));
    let error: VoiceProfileFormError | null = nameError;
    if (error === null && tooLong) error = "too_long";
    if (error === null && filesInvalid) error = "files_invalid";
    return {
      ...next,
      availableThinkingOptionIds,
      nameError: error,
      canSubmit: error === null,
    };
  }

  function publish(next: VoiceProfileFormState): void {
    if (closed) {
      return;
    }
    state = derive(next);
    for (const listener of listeners) {
      listener();
    }
  }

  function patchConfiguration(patch: Partial<VoiceProfileConfiguration>): void {
    publish({ ...state, configuration: { ...state.configuration, ...patch } });
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: () => {
      closed = true;
      listeners.clear();
    },
    applyVoiceOptions: (voices) => {
      publish({ ...state, voiceOptions: [...voices] });
    },
    applyBackendModelOptions: (options) => {
      publish({ ...state, backendModelOptions: [...options] });
    },
    setName: (value) => {
      publish({ ...state, name: value });
    },
    setInstructions: (value) => {
      patchConfiguration({ instructions: value });
    },
    setContext: (value) => {
      patchConfiguration({ context: value });
    },
    setFilesText: (value) => {
      publish({ ...state, filesText: value });
    },
    setVoice: (voice) => {
      patchConfiguration({ voice });
    },
    setBackendModel: (model) => {
      // The thinking pick belongs to a model; a different model starts from its default.
      const thinkingStillValid =
        model !== null &&
        state.configuration.backendThinkingOptionId !== null &&
        resolveThinkingOptionIds(state.backendModelOptions, model).includes(
          state.configuration.backendThinkingOptionId,
        );
      patchConfiguration({
        backendModel: model,
        backendThinkingOptionId: thinkingStillValid
          ? state.configuration.backendThinkingOptionId
          : null,
      });
    },
    setBackendThinking: (thinkingOptionId) => {
      patchConfiguration({ backendThinkingOptionId: thinkingOptionId });
    },
    setSubmitError: (value) => {
      publish({ ...state, submitError: value });
    },
    buildSaveInput: () => {
      const record = snapshot.mode === "edit" ? snapshot.record : undefined;
      if (snapshot.mode === "edit" && !record) {
        throw new Error("Profile form has no record to update");
      }
      return {
        ...(record ? { profileId: record.id, expectedRevision: record.revision } : {}),
        name: state.name.trim(),
        configuration: normalizeConfiguration(state.configuration, state.filesText),
      };
    },
  };
}
