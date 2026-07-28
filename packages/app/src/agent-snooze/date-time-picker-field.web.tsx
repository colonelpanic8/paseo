import { createElement, useCallback, type ChangeEvent, type CSSProperties } from "react";
import { View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import type { CustomSnoozeDateTimePickerProps } from "./date-time-picker-field.types";

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function toLocalDateTimeValue(value: Date): string {
  return `${value.getFullYear()}-${padDatePart(value.getMonth() + 1)}-${padDatePart(value.getDate())}T${padDatePart(value.getHours())}:${padDatePart(value.getMinutes())}`;
}

function parseLocalDateTimeValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const parsed = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0,
    0,
  );
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

interface WebDateTimeInputProps {
  value: string;
  minimumValue: string;
  disabled?: boolean;
  accessibilityLabel: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  inputStyle?: CSSProperties;
}

function WebDateTimeInput({
  value,
  minimumValue,
  disabled,
  accessibilityLabel,
  onChange,
  inputStyle,
}: WebDateTimeInputProps) {
  return createElement("input", {
    type: "datetime-local",
    value,
    min: minimumValue,
    step: 15 * 60,
    disabled,
    onChange,
    style: inputStyle,
    "data-testid": "agent-custom-snooze-datetime-input",
    "aria-label": accessibilityLabel,
  });
}

const ThemedWebDateTimeInput = withUnistyles(
  WebDateTimeInput,
  (theme): { inputStyle: CSSProperties } => ({
    inputStyle: {
      width: "100%",
      boxSizing: "border-box",
      padding: "12px 14px",
      border: `1px solid ${theme.colors.borderAccent}`,
      borderRadius: theme.borderRadius.lg,
      background: theme.colors.surface2,
      color: theme.colors.foreground,
      colorScheme: theme.colorScheme,
      fontFamily: "inherit",
      fontSize: 16,
      lineHeight: "22px",
      outlineColor: theme.colors.accent,
    },
  }),
);

export function CustomSnoozeDateTimePicker({
  value,
  minimumDate,
  onChange,
  disabled,
  untilLabel,
}: CustomSnoozeDateTimePickerProps) {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = parseLocalDateTimeValue(event.currentTarget.value);
      if (nextValue) {
        onChange(nextValue);
      }
    },
    [onChange],
  );

  return (
    <View>
      <ThemedWebDateTimeInput
        value={toLocalDateTimeValue(value)}
        minimumValue={toLocalDateTimeValue(minimumDate)}
        disabled={disabled}
        accessibilityLabel={untilLabel}
        onChange={handleChange}
      />
    </View>
  );
}
