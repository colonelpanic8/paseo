import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type PointerEvent,
  type StyleProp,
  type TextInputKeyPressEventData,
  type TextStyle,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { useToast } from "@/contexts/toast-context";

const DOUBLE_CLICK_INTERVAL_MS = 500;

type InlineRenameState =
  | { kind: "idle" }
  | { kind: "editing"; draft: string }
  | { kind: "saving"; draft: string };

interface SidebarWorkspaceInlineTitleProps {
  displayValue: string;
  renameValue: string;
  editable: boolean;
  onSubmit?: (value: string) => Promise<void>;
  style: StyleProp<TextStyle>;
  testID: string;
}

export function SidebarWorkspaceInlineTitle({
  displayValue,
  renameValue,
  editable,
  onSubmit,
  style,
  testID,
}: SidebarWorkspaceInlineTitleProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [state, setState] = useState<InlineRenameState>({ kind: "idle" });
  const inputRef = useRef<TextInput>(null);
  const cancelledRef = useRef(false);
  const submittingRef = useRef(false);
  const lastTitlePointerDownAtRef = useRef<number | null>(null);

  const handleTitlePointerDown = useCallback(
    (event: PointerEvent) => {
      if (!isWeb || !editable) {
        return;
      }
      const previousPointerDownAt = lastTitlePointerDownAtRef.current;
      lastTitlePointerDownAtRef.current = event.timeStamp;
      if (
        previousPointerDownAt === null ||
        event.timeStamp - previousPointerDownAt > DOUBLE_CLICK_INTERVAL_MS
      ) {
        return;
      }

      event.stopPropagation();
      lastTitlePointerDownAtRef.current = null;
      cancelledRef.current = false;
      setState({ kind: "editing", draft: renameValue });
    },
    [editable, renameValue],
  );

  const handleChangeText = useCallback((draft: string) => {
    setState({ kind: "editing", draft });
  }, []);

  const submit = useCallback(async () => {
    if (state.kind !== "editing" || !onSubmit || submittingRef.current || cancelledRef.current) {
      return;
    }
    const value = state.draft.trim();
    if (!value) {
      toast.error(t("common.errors.nameRequired"));
      inputRef.current?.focus();
      return;
    }
    if (value === renameValue) {
      setState({ kind: "idle" });
      return;
    }

    submittingRef.current = true;
    setState({ kind: "saving", draft: state.draft });
    try {
      await onSubmit(value);
      setState({ kind: "idle" });
    } catch (error) {
      setState({ kind: "editing", draft: state.draft });
      toast.error(
        error instanceof Error && error.message ? error.message : t("common.errors.unableToSave"),
      );
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      submittingRef.current = false;
    }
  }, [onSubmit, renameValue, state, t, toast]);

  const handleBlur = useCallback(() => {
    void submit();
  }, [submit]);

  const handleSubmitEditing = useCallback(() => {
    void submit();
  }, [submit]);

  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      event.stopPropagation();
      if (event.nativeEvent.key !== "Escape" || state.kind === "saving") {
        return;
      }
      cancelledRef.current = true;
      setState({ kind: "idle" });
    },
    [state.kind],
  );

  const handleInputPointerDown = useCallback((event: PointerEvent) => {
    event.stopPropagation();
  }, []);

  if (state.kind !== "idle") {
    return (
      <TextInput
        ref={inputRef}
        autoFocus
        selectTextOnFocus
        editable={state.kind === "editing"}
        value={state.draft}
        onChangeText={handleChangeText}
        onBlur={handleBlur}
        onSubmitEditing={handleSubmitEditing}
        onKeyPress={handleKeyPress}
        onPointerDown={handleInputPointerDown}
        returnKeyType="done"
        style={[style, styles.input]}
        testID={`${testID}-input`}
        accessibilityLabel={t("sidebar.workspace.rename.title")}
      />
    );
  }

  return (
    <View style={styles.titleClickTarget} onPointerDown={handleTitlePointerDown} testID={testID}>
      <Text style={style} numberOfLines={1}>
        {displayValue}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  titleClickTarget: {
    flexShrink: 1,
    minWidth: 0,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: 22,
    paddingVertical: 0,
    paddingHorizontal: theme.spacing[1],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface0,
  },
}));
