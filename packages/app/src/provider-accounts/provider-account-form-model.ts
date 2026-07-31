import { isAbsoluteHostPath, type ProviderAccountDraft } from "./provider-account-config";

export type ProviderAccountNameError = "required" | null;
export type ProviderAccountConfigDirError = "required" | "absolute" | "duplicate" | null;

export interface ProviderAccountFormState {
  name: string;
  configDir: string;
  nameError: ProviderAccountNameError;
  configDirError: ProviderAccountConfigDirError;
  submitError: string | null;
  isSubmitting: boolean;
  canSubmit: boolean;
}

export interface ProviderAccountFormModel {
  getState: () => ProviderAccountFormState;
  subscribe: (listener: () => void) => () => void;
  close: () => void;
  setName: (value: string) => void;
  setConfigDir: (value: string) => void;
  beginSubmit: () => ProviderAccountDraft | null;
  endSubmit: (error?: string) => void;
}

export interface ProviderAccountFormSnapshot {
  existingConfigDirs: ReadonlySet<string>;
}

interface ValidationResult {
  nameError: ProviderAccountNameError;
  configDirError: ProviderAccountConfigDirError;
}

function validate(
  name: string,
  configDir: string,
  existingConfigDirs: ReadonlySet<string>,
): ValidationResult {
  const normalizedName = name.trim();
  const normalizedConfigDir = configDir.trim();
  const nameError = normalizedName ? null : "required";
  let configDirError: ProviderAccountConfigDirError = null;

  if (!normalizedConfigDir) {
    configDirError = "required";
  } else if (!isAbsoluteHostPath(normalizedConfigDir)) {
    configDirError = "absolute";
  } else if (existingConfigDirs.has(normalizedConfigDir)) {
    configDirError = "duplicate";
  }

  return { nameError, configDirError };
}

export function openProviderAccountForm(
  snapshot: ProviderAccountFormSnapshot,
): ProviderAccountFormModel {
  const listeners = new Set<() => void>();
  let closed = false;
  let submitAttempted = false;
  let state: ProviderAccountFormState = {
    name: "",
    configDir: "",
    nameError: null,
    configDirError: null,
    submitError: null,
    isSubmitting: false,
    canSubmit: false,
  };

  function publish(next: ProviderAccountFormState): void {
    if (closed) return;
    const validation = validate(next.name, next.configDir, snapshot.existingConfigDirs);
    state = {
      ...next,
      nameError: submitAttempted ? validation.nameError : null,
      configDirError: submitAttempted ? validation.configDirError : null,
      canSubmit:
        !next.isSubmitting && validation.nameError === null && validation.configDirError === null,
    };
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => {
      closed = true;
      listeners.clear();
    },
    setName: (name) => {
      publish({ ...state, name, submitError: null });
    },
    setConfigDir: (configDir) => {
      publish({ ...state, configDir, submitError: null });
    },
    beginSubmit: () => {
      submitAttempted = true;
      const validation = validate(state.name, state.configDir, snapshot.existingConfigDirs);
      if (validation.nameError || validation.configDirError) {
        publish(state);
        return null;
      }
      publish({ ...state, isSubmitting: true, submitError: null });
      return {
        name: state.name.trim(),
        configDir: state.configDir.trim(),
      };
    },
    endSubmit: (error) => {
      publish({ ...state, isSubmitting: false, submitError: error ?? null });
    },
  };
}
