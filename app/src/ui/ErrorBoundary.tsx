import React from 'react';
import { Text, View } from 'react-native';
import { Button, Card } from './components';
import { colors, spacing, typography } from './theme';

/**
 * A screen that throws must not take the whole app down, and it must not
 * pretend nothing happened either. The caregiver is told plainly that this
 * screen failed, that their saved records are untouched, and is given a way
 * back to the rest of the app.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; label?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.lg, justifyContent: 'center' }}>
        <Card tone="warn">
          <Text style={typography.section}>这个页面出错了</Text>
          <Text style={[typography.caption, { marginTop: spacing.sm }]}>
            {this.props.label ? `「${this.props.label}」` : '该页面'}
            无法正常显示。你已经保存的记录没有受到影响，其他页面仍可正常使用。
          </Text>
          <Text style={[typography.caption, { marginTop: spacing.sm, color: colors.textMuted }]}>
            错误信息：{error.message}
          </Text>
          <Button
            label="重试"
            variant="secondary"
            style={{ marginTop: spacing.lg }}
            onPress={() => this.setState({ error: null })}
          />
        </Card>
      </View>
    );
  }
}
