import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
  type IOSNativeProps,
} from "@react-native-community/datetimepicker";
import { CalendarDays, Clock } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { Platform, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import type { CustomSnoozeDateTimePickerProps } from "./date-time-picker-field.types";

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  androidControl: {
    flex: 1,
  },
  iosControl: {
    flex: 1,
  },
});

function IOSDateTimePicker(props: IOSNativeProps) {
  return <DateTimePicker {...props} />;
}

const ThemedDateTimePicker = withUnistyles(IOSDateTimePicker, (theme) => ({
  accentColor: theme.colors.accent,
  themeVariant: theme.colorScheme,
}));

function replaceDate(value: Date, selectedDate: Date): Date {
  const next = new Date(value);
  next.setFullYear(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
  return next;
}

function replaceTime(value: Date, selectedTime: Date): Date {
  const next = new Date(value);
  next.setHours(selectedTime.getHours(), selectedTime.getMinutes(), 0, 0);
  return next;
}

export function CustomSnoozeDateTimePicker({
  value,
  minimumDate,
  onChange,
  disabled,
  dateLabel,
  timeLabel,
}: CustomSnoozeDateTimePickerProps) {
  const formattedDate = useMemo(
    () => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(value),
    [value],
  );
  const formattedTime = useMemo(
    () => new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(value),
    [value],
  );
  const handleDateChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (event.type === "set" && selectedDate) {
        onChange(replaceDate(value, selectedDate));
      }
    },
    [onChange, value],
  );
  const handleTimeChange = useCallback(
    (event: DateTimePickerEvent, selectedTime?: Date) => {
      if (event.type === "set" && selectedTime) {
        onChange(replaceTime(value, selectedTime));
      }
    },
    [onChange, value],
  );
  const openDatePicker = useCallback(() => {
    DateTimePickerAndroid.open({
      value,
      minimumDate,
      mode: "date",
      display: "default",
      onChange: handleDateChange,
    });
  }, [handleDateChange, minimumDate, value]);
  const openTimePicker = useCallback(() => {
    DateTimePickerAndroid.open({
      value,
      mode: "time",
      display: "default",
      minuteInterval: 15,
      onChange: handleTimeChange,
    });
  }, [handleTimeChange, value]);

  if (Platform.OS === "ios") {
    return (
      <View style={styles.row}>
        <View style={styles.iosControl}>
          <ThemedDateTimePicker
            value={value}
            minimumDate={minimumDate}
            mode="date"
            display="compact"
            disabled={disabled}
            onChange={handleDateChange}
            accessibilityLabel={`${dateLabel}: ${formattedDate}`}
            testID="workspace-custom-snooze-date-picker"
          />
        </View>
        <View style={styles.iosControl}>
          <ThemedDateTimePicker
            value={value}
            mode="time"
            display="compact"
            minuteInterval={15}
            disabled={disabled}
            onChange={handleTimeChange}
            accessibilityLabel={`${timeLabel}: ${formattedTime}`}
            testID="workspace-custom-snooze-time-picker"
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Button
        variant="outline"
        style={styles.androidControl}
        leftIcon={CalendarDays}
        disabled={disabled}
        onPress={openDatePicker}
        accessibilityLabel={`${dateLabel}: ${formattedDate}`}
        testID="workspace-custom-snooze-date-picker"
      >
        {formattedDate}
      </Button>
      <Button
        variant="outline"
        style={styles.androidControl}
        leftIcon={Clock}
        disabled={disabled}
        onPress={openTimePicker}
        accessibilityLabel={`${timeLabel}: ${formattedTime}`}
        testID="workspace-custom-snooze-time-picker"
      >
        {formattedTime}
      </Button>
    </View>
  );
}
