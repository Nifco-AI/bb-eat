import React, { useMemo, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useApp } from '../AppProvider';
import { Button, Card, Chip, EmptyState, ListTile, Row, Screen, SectionHeader, SyntheticBanner } from '../components';
import { useTheme } from '../ThemeProvider';
import { spacing } from '../theme';
import { recommend } from '../../domain/recommend';
import { listSlots, createSlot, addPlanItem, SyntheticContentError } from '../../domain/repositories/meals';
import { ageInMonths } from '../../domain/time';
import { Region } from '../../domain/types';

export function RecommendScreen({ navigation }: { navigation: { navigate: (s: string, p?: object) => void } }) {
  const { colors, typography } = useTheme();
  const { db, baby, today, demoMode, setDemoMode, refresh, revision } = useApp();
  const [applied, setApplied] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  const avoidRows = useMemo(
    () =>
      db.all<{ ingredient_id: string; name_zh: string | null }>(
        `SELECT a.ingredient_id, i.name_zh FROM avoid_list a
         LEFT JOIN ingredients i ON i.id = a.ingredient_id
         WHERE a.baby_id = ? AND a.status = 'active' ORDER BY a.created_at DESC`,
        [baby.id],
      ),
    [db, baby.id, revision],
  );
  const avoid = useMemo(() => avoidRows.map((r) => r.ingredient_id), [avoidRows]);

  const slots = useMemo(() => listSlots(db, baby.id, today), [db, baby.id, today, revision]);
  const months = ageInMonths(baby.birth_date, today);

  const result = useMemo(
    () =>
      recommend(db, {
        babyId: baby.id,
        ageMonths: months,
        region: baby.region as Region,
        slotLabels: slots.map((s) => s.label),
        avoidIngredientIds: avoid,
        inventoryIngredientIds: db
          .all<{ ingredient_id: string }>(
            "SELECT ingredient_id FROM inventory_items WHERE baby_id = ? AND status = 'active' AND ingredient_id IS NOT NULL",
            [baby.id],
          )
          .map((r) => r.ingredient_id),        maxPrepMinutes: null,
        recentIngredientIds: [],
        demoMode,
      }),
    [db, baby.id, baby.region, months, slots, avoid, demoMode, revision],
  );

  return (
    <Screen>
      <Text style={typography.display}>AI 推荐</Text>
      <Text style={[typography.caption, { marginTop: spacing.xs, marginBottom: spacing.lg }]}>
        推荐先过硬性安全条件，再排序。条件不满足时宁可不推荐，也不会用未达标的食谱凑数。
      </Text>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={typography.bodyStrong}>演示模式</Text>
            <Text style={[typography.caption, { marginTop: 2 }]}>
              使用明确标注的合成数据展示推荐界面与排序逻辑。合成内容不能加入计划、库存或任何真实记录，也不是喂养建议。
            </Text>
          </View>
          <Switch
            value={demoMode}
            onValueChange={setDemoMode}
            trackColor={{ true: colors.sage, false: colors.border }}
            accessibilityLabel="演示模式开关"
          />
        </Row>
      </Card>

      {demoMode && <SyntheticBanner text="以下全部内容为合成演示数据，不得作为真实喂养依据。" />}

      {result.blocked.length > 0 && (
        <Card tone="warn">
          <Text style={typography.bodyStrong}>暂时无法生成推荐</Text>
          {result.blocked.map((b, i) => (
            <Text key={i} style={[typography.body, { marginTop: spacing.sm }]}>
              · {b.message}
            </Text>
          ))}
          <Row style={{ marginTop: spacing.lg, flexWrap: 'wrap' }}>
            <Button
              label="手动安排今天"
              variant="secondary"
              style={{ marginRight: spacing.sm, marginBottom: spacing.sm }}
              onPress={() => navigation.navigate('今日')}
            />
            <Button
              label="查看资料来源与审核状态"
              variant="ghost"
              style={{ marginBottom: spacing.sm }}
              onPress={() => navigation.navigate('Sources')}
            />
          </Row>
        </Card>
      )}

      {result.candidates.length === 0 && result.blocked.length === 0 && (
        <EmptyState title="没有可用的推荐" body="没有候选通过硬性安全条件。" />
      )}

      {result.candidates.map((c, idx) => (
        <Card key={c.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={typography.section}>方案 {idx + 1}</Text>
            <Chip label={c.is_synthetic ? '合成演示' : '真实内容'} tone={c.is_synthetic ? 'info' : 'neutral'} />
          </Row>

          {c.slots.map((s) => (
            <ListTile
              key={s.label}
              title={`${s.label} · ${s.recipe.name_zh}`}
              subtitle={s.reasons.join('；')}
              onPress={() => navigation.navigate('RecipeDetail', { recipeId: s.recipe.id })}
              accessibilityHint="查看食谱详情"
            />
          ))}

          <View style={{ marginTop: spacing.md }}>
            <Text style={typography.label}>为什么是这个方案</Text>
            {c.explanation.map((e, i) => (
              <Text key={i} style={[typography.caption, { marginTop: 2 }]}>
                · {e}
              </Text>
            ))}
            <Text style={[typography.caption, { marginTop: spacing.sm }]}>
              知识包版本：{c.knowledge_versions.join('、')}
            </Text>
          </View>

          <Button
            label={
              demoMode
                ? '演示内容不能加入计划'
                : applied === c.id
                  ? '已加入今天的计划'
                  : '加入今天的计划'
            }
            disabled={demoMode || applied === c.id}
            style={{ marginTop: spacing.lg }}
            onPress={() => {
              try {
                for (const s of c.slots) {
                  const existing = listSlots(db, baby.id, today).find((x) => x.label === s.label);
                  const slot = existing ?? createSlot(db, baby.id, today, s.label, null);
                  addPlanItem(db, slot.id, { recipe_id: s.recipe.id });
                }
                setApplied(c.id);
                refresh();
              } catch (e) {
                setPlanError(e instanceof SyntheticContentError ? e.message : String(e));
              }
            }}
          />
          <Text style={[typography.caption, { marginTop: spacing.sm }]}>
            加入计划只是写进今天的安排，不会被算作已经吃过。
          </Text>
          {planError ? (
            <Text style={[typography.caption, { marginTop: spacing.xs, color: colors.danger }]}>
              {planError}
            </Text>
          ) : null}
        </Card>
      ))}

      <SectionHeader title="排除的食材" />
      <Card>
        {avoid.length === 0 ? (
          <Text style={typography.caption}>没有排除任何食材。你可以在食材库中标记要回避的食材。</Text>
        ) : (
          <Row style={{ flexWrap: 'wrap' }}>
            {avoidRows.map((a) => (
              <Chip
                key={a.ingredient_id}
                label={`${a.name_zh ?? a.ingredient_id} ✕`}
                tone="danger"
                onPress={() => {
                  db.run("UPDATE avoid_list SET status = 'removed' WHERE baby_id = ? AND ingredient_id = ?", [
                    baby.id,
                    a.ingredient_id,
                  ]);
                  refresh();
                }}
              />
            ))}
          </Row>
        )}
        <Button
          label="从食材库选择"
          variant="secondary"
          style={{ marginTop: spacing.md }}
          onPress={() => navigation.navigate('Ingredients', { mode: 'avoid' })}
        />
      </Card>

      <SectionHeader title="筛选过程" />
      <Card tone="alt">
        <Text style={typography.caption}>内置食谱总数：{result.diagnostics.recipes_total}</Text>
        <Text style={typography.caption}>通过外部专业审核：{result.diagnostics.recipes_expert_reviewed}</Text>
        <Text style={typography.caption}>通过硬性安全条件：{result.diagnostics.recipes_passing_hard_constraints}</Text>
        {result.diagnostics.hard_constraint_rejections.slice(0, 6).map((r, i) => (
          <Text key={i} style={[typography.caption, { marginTop: 2 }]}>
            · {r.recipe}：{r.reason}
          </Text>
        ))}
      </Card>
    </Screen>
  );
}
