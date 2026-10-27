import React, { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Chip, Row } from './components';
import { useTheme } from './ThemeProvider';
import { MIN_TOUCH, radius, spacing } from './theme';
import { instantFromLocal, localTimeFrom, offsetMinutesFor, shiftLocalDate } from '../domain/time';

/**
 * Every fact in this app carries a caregiver-stated occurrence time. Hard-coding
 * `new Date()` at save time makes back-filling impossible and silently files a
 * record under today even when the caregiver is looking at another day. This
 * control keeps the local date and local time explicit and editable.
 *
 * The defaults are *followed*, not copied. A form that stays mounted (a modal
 * rendered by a screen, or a screen left open for hours) would otherwise keep
 * offering the date and time it was first mounted at — which silently files the
 * meal under the wrong day and stamps it with the wrong time, while showing a
 * control that looks correct. Until the caregiver edits a field, that field
 * tracks the caller's current value; once edited, their input is never
 * overwritten.
 */
export type OccurredAtState = {
  localDate: string;
  localTime: string;
  valid: boolean;
  toDate: () => Date;
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function nowLocalTime(tz: string): string {
  const now = Date.now();
  return localTimeFrom(now, offsetMinutesFor(new Date(now), tz));
}

export function useOccurredAt(
  tz: string,
  defaultLocalDate: string,
  defaultLocalTime: string
): [OccurredAtState, (d: string) => void, (t: string) => void, () => void] {
  const [editedDate, setEditedDate] = useState<string | null>(null);
  const [editedTime, setEditedTime] = useState<string | null>(null);

  const localDate = editedDate ?? defaultLocalDate;
  const localTime = editedTime ?? defaultLocalTime;

  const state = useMemo<OccurredAtState>(() => {
    const valid = HHMM.test(localTime.trim());
    return {
      localDate,
      localTime,
      valid,
      toDate: () => instantFromLocal(localDate, localTime.trim(), tz),
    };
  }, [localDate, localTime, tz]);

  const reset = () => {
    setEditedDate(null);
    setEditedTime(null);
  };

  return [state, setEditedDate, setEditedTime, reset];
}

export function OccurredAtField({
  tz,
  today,
  state,
  onDateChange,
  onTimeChange,
}: {
  tz: string;
  today: string;
  state: OccurredAtState;
  onDateChange: (d: string) => void;
  onTimeChange: (t: string) => void;
}) {
  const { colors, typography } = useTheme();
  // `today` comes from the app state rather than being recomputed here, so the
  // control stays pure and always agrees with the rest of the app about which
  // local day it is.
  const yesterday = shiftLocalDate(today, -1);

  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[typography.label, { marginBottom: spacing.xs }]}>发生时间</Text>
      <Row style={{ flexWrap: 'wrap', marginBottom: spacing.sm }}>
        <Chip label="今天" selected={state.localDate === today} onPress={() => onDateChange(today)} />
        <Chip label="昨天" selected={state.localDate === yesterday} onPress={() => onDateChange(yesterday)} />
        {state.localDate !== today && state.localDate !== yesterday && (
          <Chip label={state.localDate} selected onPress={() => onDateChange(state.localDate)} />
        )}
      </Row>
      <TextInput
        accessibilityLabel="发生时间，24 小时制，格式 时:分"
        value={state.localTime}
        onChangeText={onTimeChange}
        placeholder="HH:MM"
        placeholderTextColor={colors.textFaint}
        keyboardType="numbers-and-punctuation"
        style={{
          minHeight: MIN_TOUCH,
          borderWidth: 1,
          borderColor: state.valid ? colors.borderStrong : colors.danger,
          borderRadius: radius.md,
          paddingHorizontal: spacing.lg,
          backgroundColor: colors.surface,
          color: colors.text,
        }}
      />
      <Text style={[typography.caption, { marginTop: spacing.xs }]}>
        {state.valid
          ? `将记为 ${state.localDate} ${state.localTime}（${tz}）。补记过去的事情时请改成实际发生的时间。`
          : '请用 24 小时制填写，例如 03:20。'}
      </Text>
    </View>
  );
}
