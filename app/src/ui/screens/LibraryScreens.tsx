import React, { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useApp } from '../AppProvider';
import { Button, Card, Chip, EmptyState, ListTile, Row, Screen, SectionHeader } from '../components';
import { colors, MIN_TOUCH, radius, spacing, typography } from '../theme';
import { addPlanItem } from '../../domain/repositories/meals';
import { addAvoidItem, addInventoryItem, removeAvoidItem, removeInventoryItem, searchInventoryCandidates } from '../../domain/repositories/inventory';
import {
  CHOKING_LABELS,
  FOOD_GROUP_LABELS,
  Ingredient,
  REVIEW_LABELS,
  Recipe,
  TEXTURE_LABELS,
} from '../../domain/types';

interface Nav {
  navigate: (s: string, p?: object) => void;
  goBack: () => void;
}

/**
 * Doubles as the browsable library, the "add to this meal" picker and the
 * "ingredients to avoid" selector, so there is only one place to learn.
 */
export function IngredientsScreen({
  navigation,
  route,
}: {
  navigation: Nav;
  route: { params?: { onPickSlotId?: string; mode?: 'avoid' } };
}) {
  const { db, baby, demoMode, refresh, revision } = useApp();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);
  const pickSlotId = route.params?.onPickSlotId;
  const avoidMode = route.params?.mode === 'avoid';

  const avoidIds = useMemo(() => {
    const rows = db.all<{ ingredient_id: string }>(
      "SELECT ingredient_id FROM avoid_list WHERE baby_id = ? AND status = 'active'",
      [baby.id],
    );
    return new Set(rows.map((r) => r.ingredient_id));
  }, [db, baby.id, revision]);

  const ingredients = useMemo(() => {
    const rows = db.all<Ingredient>('SELECT * FROM ingredients ORDER BY food_group, name_zh');
    const q = query.trim().toLowerCase();
    return rows.filter((i) => {
      // Synthetic demo content must never be selectable into a real plan or a
      // real avoid list. It stays visible in the browsable library (clearly
      // badged) only when demo mode is on.
      if (i.is_synthetic === 1 && (pickSlotId || avoidMode || !demoMode)) return false;
      if (group && i.food_group !== group) return false;
      if (!q) return true;
      const aliases = (JSON.parse(i.aliases_json) as string[]).join(' ').toLowerCase();
      return (
        i.name_zh.toLowerCase().includes(q) ||
        (i.name_en ?? '').toLowerCase().includes(q) ||
        aliases.includes(q)
      );
    });
  }, [db, query, group, revision, pickSlotId, avoidMode, demoMode]);

  const groups = useMemo(
    () => db.all<{ food_group: string }>('SELECT DISTINCT food_group FROM ingredients ORDER BY food_group'),
    [db, revision],
  );

  return (
    <Screen>
      <Text style={typography.display}>{pickSlotId ? '选择食材' : avoidMode ? '选择要回避的食材' : '食材库'}</Text>
      <Text style={[typography.caption, { marginTop: spacing.xs, marginBottom: spacing.md }]}>
        {avoidMode
          ? '你标记的回避食材会从推荐中排除。这是你的决定，应用不会自己判定任何食物过敏。'
          : '每条食材都标注了来源和审核状态。未核验的信息会如实写明「未核验」，不会被包装成建议。'}
      </Text>

      <TextInput
        accessibilityLabel="搜索食材"
        value={query}
        onChangeText={setQuery}
        placeholder="搜索名称或别名"
        placeholderTextColor={colors.textFaint}
        style={{
          minHeight: MIN_TOUCH,
          borderWidth: 1,
          borderColor: colors.borderStrong,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.lg,
          backgroundColor: colors.surface,
          color: colors.text,
          marginBottom: spacing.md,
        }}
      />

      <Row style={{ flexWrap: 'wrap' }}>
        <Chip label="全部" selected={group === null} onPress={() => setGroup(null)} />
        {groups.map((g) => (
          <Chip
            key={g.food_group}
            label={FOOD_GROUP_LABELS[g.food_group] ?? g.food_group}
            selected={group === g.food_group}
            onPress={() => setGroup(g.food_group)}
          />
        ))}
      </Row>

      {ingredients.length === 0 ? (
        <EmptyState title="没有匹配的食材" body="换个关键词，或清除分类筛选再试。" />
      ) : (
        ingredients.map((i) => (
          <Card key={i.id}>
            <ListTile
              title={i.name_zh}
              subtitle={`${FOOD_GROUP_LABELS[i.food_group] ?? i.food_group}${i.name_en ? ' · ' + i.name_en : ''}`}
              right={
                pickSlotId ? (
                  <Button
                    label="加入"
                    onPress={() => {
                      addPlanItem(db, pickSlotId, { ingredient_id: i.id });
                      refresh();
                      navigation.goBack();
                    }}
                  />
                ) : avoidMode ? (
                  <Button
                    label={avoidIds.has(i.id) ? '取消回避' : '回避'}
                    variant={avoidIds.has(i.id) ? 'secondary' : 'danger'}
                    onPress={() => {
                      if (avoidIds.has(i.id)) removeAvoidItem(db, baby.id, i.id);
                      else addAvoidItem(db, baby.id, i.id);
                      refresh();
                    }}
                  />
                ) : undefined
              }
            />
            <Row style={{ flexWrap: 'wrap', marginTop: spacing.sm }}>
              {i.is_synthetic === 1 && <Chip label="合成演示" tone="info" />}
              {i.common_allergen === 1 && <Chip label="常见致敏食物" tone="warn" />}
              {i.choking_risk !== 'unknown' && (
                <Chip
                  label={`窒息风险 ${CHOKING_LABELS[i.choking_risk]}`}
                  tone={i.choking_risk === 'high' ? 'danger' : 'warn'}
                />
              )}
              <Chip label={REVIEW_LABELS[i.review_status] ?? i.review_status} />
            </Row>
            {!!i.choking_note && (
              <Text style={[typography.caption, { marginTop: spacing.sm }]}>· {i.choking_note}</Text>
            )}
            {!!i.allergen_note && (
              <Text style={[typography.caption, { marginTop: spacing.xs }]}>· {i.allergen_note}</Text>
            )}
            {!!i.preparation_note && (
              <Text style={[typography.caption, { marginTop: spacing.xs }]}>· {i.preparation_note}</Text>
            )}
            <Text style={[typography.caption, { marginTop: spacing.sm, color: colors.textFaint }]}>
              适用月龄：
              {i.min_age_months === null
                ? '未核验。没有可引用的权威来源给出单一食材的起始月龄，因此不作判断。'
                : `${i.min_age_months} 个月起`}
            </Text>
          </Card>
        ))
      )}
    </Screen>
  );
}

export function RecipesScreen({
  navigation,
  route,
}: {
  navigation: Nav;
  route?: { params?: { onPickSlotId?: string } };
}) {
  const { db, demoMode, refresh, revision } = useApp();
  const pickSlotId = route?.params?.onPickSlotId;
  const recipes = useMemo(() => {
    const rows = db.all<Recipe>('SELECT * FROM recipes ORDER BY is_synthetic, name_zh');
    // Synthetic recipes are browsable only in demo mode and are never
    // selectable into a real meal plan.
    return rows.filter((r) => r.is_synthetic !== 1 || (!pickSlotId && demoMode));
  }, [db, revision, pickSlotId, demoMode]);
  return (
    <Screen>
      <Text style={typography.display}>{pickSlotId ? '选择食谱' : '食谱'}</Text>
      <Text style={[typography.caption, { marginTop: spacing.xs, marginBottom: spacing.md }]}>
        食谱为本应用编写，未经外部专业审核，仅供参考与手动安排使用。
      </Text>
      {recipes.length === 0 ? (
        <EmptyState title="没有可选的食谱" body="内置食谱均未通过外部专业审核，你仍可直接用食材安排这一餐。" />
      ) : (
        recipes.map((r) => (
          <Card key={r.id}>
            <ListTile
              title={r.name_zh}
              subtitle={`${TEXTURE_LABELS[r.texture] ?? r.texture}${r.time_cost_min ? ` · 约 ${r.time_cost_min} 分钟` : ''}`}
              onPress={() => navigation.navigate('RecipeDetail', { recipeId: r.id })}
              accessibilityHint="查看做法与安全提示"
              right={
                pickSlotId ? (
                  <Button
                    label="加入这一餐"
                    onPress={() => {
                      addPlanItem(db, pickSlotId, { recipe_id: r.id });
                      refresh();
                      navigation.goBack();
                    }}
                  />
                ) : r.is_synthetic === 1 ? (
                  <Chip label="合成演示" tone="info" />
                ) : undefined
              }
            />
          </Card>
        ))
      )}
    </Screen>
  );
}

export function RecipeDetailScreen({ route }: { route: { params: { recipeId: string } } }) {
  const { db, revision } = useApp();
  const recipe = useMemo(
    () => db.get<Recipe>('SELECT * FROM recipes WHERE id = ?', [route.params.recipeId]),
    [db, route.params.recipeId, revision],
  );
  const ingredients = useMemo(
    () =>
      db.all<{ name_zh: string; amount_g: number | null; note: string | null }>(
        `SELECT i.name_zh, ri.amount_g, ri.note FROM recipe_ingredients ri
         JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.recipe_id = ?`,
        [route.params.recipeId],
      ),
    [db, route.params.recipeId, revision],
  );
  const source = useMemo(
    () =>
      recipe?.source_id
        ? db.get<{ publisher: string; title: string; source_url: string }>(
            'SELECT publisher, title, source_url FROM sources WHERE id = ?',
            [recipe.source_id],
          )
        : undefined,
    [db, recipe, revision],
  );

  if (!recipe) return <Screen><EmptyState title="找不到这个食谱" body="它可能已随知识包更新被移除。" /></Screen>;

  const steps = JSON.parse(recipe.steps_json) as string[];

  return (
    <Screen>
      <Text style={typography.display}>{recipe.name_zh}</Text>
      <Row style={{ flexWrap: 'wrap', marginTop: spacing.md }}>
        <Chip label={TEXTURE_LABELS[recipe.texture] ?? recipe.texture} />
        {recipe.time_cost_min !== null && <Chip label={`约 ${recipe.time_cost_min} 分钟`} />}
        {recipe.is_synthetic === 1 && <Chip label="合成演示" tone="info" />}
        <Chip label={REVIEW_LABELS[recipe.review_status] ?? recipe.review_status} />
      </Row>

      <SectionHeader title="用料" />
      <Card>
        {ingredients.map((i, idx) => (
          <ListTile
            key={idx}
            title={i.name_zh}
            subtitle={[i.amount_g !== null ? `${i.amount_g} g` : '份量自定', i.note].filter(Boolean).join(' · ')}
          />
        ))}
      </Card>

      <SectionHeader title="做法" />
      <Card>
        {steps.map((s, i) => (
          <Row key={i} style={{ alignItems: 'flex-start', marginBottom: spacing.sm }}>
            <Text style={[typography.bodyStrong, { width: 24 }]}>{i + 1}.</Text>
            <Text style={[typography.body, { flex: 1 }]}>{s}</Text>
          </Row>
        ))}
      </Card>

      <SectionHeader title="安全与适用性" />
      <Card tone="warn">
        {!!recipe.safety_note && <Text style={typography.body}>{recipe.safety_note}</Text>}
        {!!recipe.allergen_note && (
          <Text style={[typography.body, { marginTop: spacing.sm }]}>{recipe.allergen_note}</Text>
        )}
        <Text style={[typography.caption, { marginTop: spacing.sm }]}>
          适用月龄：
          {recipe.min_age_months === null
            ? '未核验。本食谱未通过外部专业审核，不提供适龄判断。'
            : `${recipe.min_age_months} 个月起`}
        </Text>
        {!!recipe.age_evidence && (
          <Text style={[typography.caption, { marginTop: spacing.xs }]}>依据：{recipe.age_evidence}</Text>
        )}
      </Card>

      <SectionHeader title="来源" />
      <Card tone="alt">
        <Text style={typography.caption}>
          {source ? `${source.publisher} · ${source.title}` : '本应用编写，无外部来源。'}
        </Text>
        {!!source && <Text style={[typography.caption, { marginTop: 2 }]}>{source.source_url}</Text>}
        {!!recipe.license_note && (
          <Text style={[typography.caption, { marginTop: spacing.xs }]}>{recipe.license_note}</Text>
        )}
        <Text style={[typography.caption, { marginTop: spacing.xs }]}>知识包版本 {recipe.pack_version}</Text>
      </Card>
    </Screen>
  );
}

export function InventoryScreen() {
  const { db, baby, refresh, revision } = useApp();
  const [query, setQuery] = useState('');

  const owned = useMemo(
    () =>
      db.all<{ id: string; ingredient_id: string | null; name_zh: string | null; free_text: string | null }>(
        `SELECT inv.id, inv.ingredient_id, inv.free_text, i.name_zh
         FROM inventory_items inv LEFT JOIN ingredients i ON i.id = inv.ingredient_id
         WHERE inv.baby_id = ? AND inv.status = 'active' ORDER BY inv.created_at DESC`,
        [baby.id],
      ),
    [db, baby.id, revision],
  );

  const matches = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return searchInventoryCandidates(db, q) as unknown as Ingredient[];
  }, [db, query]);

  return (
    <Screen>
      <Text style={typography.display}>家里有什么</Text>
      <Text style={[typography.caption, { marginTop: spacing.xs, marginBottom: spacing.md }]}>
        记录现有食材，推荐时会优先考虑。留空也完全不影响记录功能。
      </Text>

      <TextInput
        accessibilityLabel="搜索要添加的食材"
        value={query}
        onChangeText={setQuery}
        placeholder="搜索食材后点击加入"
        placeholderTextColor={colors.textFaint}
        style={{
          minHeight: MIN_TOUCH,
          borderWidth: 1,
          borderColor: colors.borderStrong,
          borderRadius: radius.pill,
          paddingHorizontal: spacing.lg,
          backgroundColor: colors.surface,
          color: colors.text,
          marginBottom: spacing.md,
        }}
      />

      {matches.map((m) => (
        <Card key={m.id}>
          <ListTile
            title={m.name_zh}
            right={
              <Button
                label="加入"
                onPress={() => {
                  addInventoryItem(db, baby.id, { ingredientId: m.id });
                  setQuery('');
                  refresh();
                }}
              />
            }
          />
        </Card>
      ))}

      <SectionHeader title={`已记录 ${owned.length} 项`} />
      {owned.length === 0 ? (
        <EmptyState title="还没有记录库存" body="这一项完全可选。不填写不会影响任何记录功能。" />
      ) : (
        <Card>
          {owned.map((o) => (
            <ListTile
              key={o.id}
              title={o.name_zh ?? o.free_text ?? '未命名'}
              right={
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`移除 ${o.name_zh ?? o.free_text}`}
                  onPress={() => {
                    removeInventoryItem(db, o.id);
                    refresh();
                  }}
                  style={{ minHeight: MIN_TOUCH, minWidth: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: colors.textFaint, fontSize: 18 }}>×</Text>
                </Pressable>
              }
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}
