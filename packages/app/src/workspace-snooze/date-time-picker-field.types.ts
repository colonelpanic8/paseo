export interface CustomSnoozeDateTimePickerProps {
  value: Date;
  minimumDate: Date;
  onChange: (value: Date) => void;
  disabled?: boolean;
  untilLabel: string;
  dateLabel: string;
  timeLabel: string;
}
