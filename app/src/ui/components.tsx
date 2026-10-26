import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from 'react-native';
import { colors, MIN_TOUCH, radius, shadow, spacing, typography } from './theme';

export function Card({
  children,
  style,
  tone = 'surface',
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  tone?: 'surface' | 'alt' | 'warn' | 'info';
}) {
  const bg =
    tone === 'alt'
      ? colors.surfaceAlt
      : tone === 'warn'
        ? colors.amberSoft
        : tone === 'info'
          ? colors.infoSoft
          : colors.surface;
  return <View style={[styles.card, { backgroundColor: bg }, style]}>{children}</View>;
}

export function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={typography.section}>{title}</Text>
      {action}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  accessibilityHint,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  accessibilityHint?: string;
  style?: ViewStyle;
}) {
  const palette = {
    primary: { bg: colors.sage, fg: colors.onAccent, border: colors.sage },
    secondary: { bg: colors.surface, fg: colors.text, border: colors.borderStrong },
    ghost: { bg: 'transparent', fg: colors.textMuted, border: 'transparent' },
    danger: { bg: colors.dangerSoft, fg: colors.danger, border: colors.danger },
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      <Text style={[typography.bodyStrong, { color: palette.fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  tone = 'neutral',
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: 'neutral' | 'warn' | 'danger' | 'info';
}) {
  const toneBg = {
    neutral: colors.surfaceAlt,
    warn: colors.amberSoft,
    danger: colors.dangerSoft,
    info: colors.infoSoft,
  }[tone];
  const toneFg = {
    neutral: colors.textMuted,
    warn: colors.amber,
    danger: colors.danger,
    info: colors.info,
  }[tone];

  const body = (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.sage : toneBg,
          borderColor: selected ? colors.sage : 'transparent',
        },
      ]}
    >
      <Text style={[typography.label, { color: selected ? colors.onAccent : toneFg }]}>{label}</Text>
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={styles.chipTouch}
    >
      {body}
    </Pressable>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  hint,
  error,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  hint?: string;
  error?: string | null;
  multiline?: boolean;
}) {
  return (
    <View style={{ marginBottom: spacing.lg }}>
      <Text style={[typography.label, { marginBottom: spacing.xs }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        keyboardType={keyboardType ?? 'default'}
        multiline={multiline}
        style={[
          styles.input,
          multiline && { height: 96, textAlignVertical: 'top' },
          !!error && { borderColor: colors.danger },
        ]}
      />
      {!!hint && !error && <Text style={[typography.caption, { marginTop: spacing.xs }]}>{hint}</Text>}
      {!!error && (
        <Text style={[typography.caption, { marginTop: spacing.xs, color: colors.danger }]}>{error}</Text>
      )}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Card tone="alt" style={{ alignItems: 'center' }}>
      <Text style={[typography.bodyStrong, { textAlign: 'center' }]}>{title}</Text>
      <Text style={[typography.caption, { textAlign: 'center', marginTop: spacing.sm }]}>{body}</Text>
      {!!actionLabel && !!onAction && (
        <Button label={actionLabel} onPress={onAction} style={{ marginTop: spacing.lg }} />
      )}
    </Card>
  );
}

export function LoadingState({ label = '正在加载…' }: { label?: string }) {
  return (
    <View style={styles.centre} accessibilityRole="progressbar">
      <ActivityIndicator color={colors.sage} />
      <Text style={[typography.caption, { marginTop: spacing.md }]}>{label}</Text>
    </View>
  );
}

export function ErrorState({
  title = '出了点问题',
  detail,
  onRetry,
}: {
  title?: string;
  detail: string;
  onRetry?: () => void;
}) {
  return (
    <Card style={{ borderColor: colors.danger, borderWidth: 1 }}>
      <Text style={[typography.bodyStrong, { color: colors.danger }]}>{title}</Text>
      <Text style={[typography.caption, { marginTop: spacing.sm }]}>{detail}</Text>
      {!!onRetry && <Button label="重试" variant="secondary" onPress={onRetry} style={{ marginTop: spacing.lg }} />}
    </Card>
  );
}

/**
 * Shown wherever a figure is a floor rather than a total, so a caregiver is
 * never shown a number that silently treats "unknown" as zero.
 */
export function UnknownNotice({ text }: { text: string }) {
  return (
    <View style={styles.notice}>
      <Text style={[typography.caption, { color: colors.amber }]}>⚠︎ {text}</Text>
    </View>
  );
}

export function SyntheticBanner({ text }: { text: string }) {
  return (
    <View style={styles.synthetic}>
      <Text style={[typography.label, { color: colors.info }]}>演示数据</Text>
      <Text style={[typography.caption, { color: colors.info, marginTop: 2 }]}>{text}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export function Screen({
  children,
  scroll = true,
  padded = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
}) {
  const inner = padded ? { padding: spacing.lg, paddingBottom: spacing.xxl * 3 } : undefined;
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: colors.bg }, inner]}>{children}</View>;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={inner}>
      {children}
    </ScrollView>
  );
}

export function ListTile({
  title,
  subtitle,
  right,
  onPress,
  accessibilityHint,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  accessibilityHint?: string;
}) {
  const content = (
    <View style={styles.tile}>
      <View style={{ flex: 1, paddingRight: spacing.md }}>
        <Text style={typography.bodyStrong}>{title}</Text>
        {!!subtitle && <Text style={[typography.caption, { marginTop: 2 }]}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable accessibilityRole="button" accessibilityHint={accessibilityHint} onPress={onPress}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  button: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipTouch: { minHeight: MIN_TOUCH, justifyContent: 'center', marginRight: spacing.sm, marginBottom: spacing.sm },
  input: {
    minHeight: MIN_TOUCH,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
  },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  notice: {
    backgroundColor: colors.amberSoft,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  synthetic: {
    backgroundColor: colors.infoSoft,
    borderRadius: radius.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.info,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: MIN_TOUCH + 8,
    paddingVertical: spacing.sm,
  },
});
