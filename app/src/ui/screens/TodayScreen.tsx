import React, { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, Text, View } from 'react-native';
import { useApp } from '../AppProvider';
import { Button, Card, Chip, EmptyState, ErrorState, Field, ListTile, Row, Screen, SectionHeader, UnknownNotice } from '../components';
import { colors, spacing, typography } from '../theme';
import {
  MealSlotView,
  SLOT_LABEL_SUGGESTIONS,
  addPlanItem,
  copySlotsFrom,
  createSlot,
  listSlots,
  removePlanItem,
  removeSlot,
  snapshotFromSlot,
} from '../../domain/repositories/meals';
import { listFeedings, recordFeeding, FeedingValidationError } from '../../domain/repositories/feeding';
import { undoFact } from '../../domain/repositories/facts';
import { daySummary } from '../../domain/summary';
import { ageInMonths, shiftLocalDate, formatLocalDate } from '../../domain/time';
import { IntakeMode, INTAKE_MODE_LABELS } from '../../domain/types';

export function TodayScreen({ navigation }: { navigation: { navigate: (s: string, p?: object) => void } }) {
  const { db, baby, today, refresh, revision } = useApp();
  const [date, setDate] = useState(today);
  const [slotEditor, setSlotEditor] = useState(false);
  const [feedingFor, setFeedingFor] = useState<MealSlotView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { slots, summary, feedings } = useMemo(() => {
    return {
      slots: listSlots(db, baby.id, date),
      summary: daySummary(db, baby.id, date),
      feedings: listFeedings(db, baby.id, date),
    };
  }, [db, baby.id, date, revision]);

  const months = ageInMonths(baby.birth_date, date);

  return (
    <Screen>
      <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}>
        <Button label="‹ 前一天" variant="ghost" onPress={() => setDate(shiftLocalDate(date, -1))} />
        <View style={{ alignItems: 'center' }}>
          <Text style={typography.title}>{formatLocalDate(date)}</Text>
          <Text style={typography.caption}>
            {months === null ? '未填写出生日期' : `${months} 个月`}
            {date !== today ? ' · 历史' : ''}
          </Text>
        </View>
        <Button
          label="后一天 ›"
          variant="ghost"
          disabled={date >= today}
          onPress={() => setDate(shiftLocalDate(date, 1))}
        />
      </Row>

      {!!error && <ErrorState detail={error} onRetry={() => setError(null)} />}

      {baby.birth_date === null && (
        <Card tone="warn">
          <Text style={typography.bodyStrong}>还没有填写宝宝信息</Text>
          <Text style={[typography.caption, { marginTop: spacing.xs }]}>
            填写出生日期和性别后，才能按月龄组织内容并与 WHO 生长标准比较。不填写也可以正常记录。
          </Text>
          <Button
            label="去填写"
            variant="secondary"
            style={{ marginTop: spacing.md }}
            onPress={() => navigation.navigate('BabyProfile')}
          />
        </Card>
      )}

      <SectionHeader
        title="今天的餐次"
        action={<Button label="＋ 餐次" variant="ghost" onPress={() => setSlotEditor(true)} />}
      />

      {slots.length === 0 ? (
        <EmptyState
          title="还没有安排餐次"
          body="先按你家的实际作息添加餐次，再往里放食材或食谱。计划只是计划，不会算作已经吃过。"
          actionLabel="添加第一餐"
          onAction={() => setSlotEditor(true)}
        />
      ) : (
        slots.map((slot) => (
          <Card key={slot.id}>
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={typography.section}>{slot.label}</Text>
                <Text style={typography.caption}>
                  {slot.planned_time ?? '未设定时间'} ·{' '}
                  {slot.feeding_count > 0 ? `已记录 ${slot.feeding_count} 次进食` : '尚未记录是否吃过'}
                </Text>
              </View>
              <Chip
                label={slot.feeding_count > 0 ? '已记录' : '计划中'}
                tone={slot.feeding_count > 0 ? 'info' : 'neutral'}
              />
            </Row>

            <View style={{ marginTop: spacing.md }}>
              {slot.items.length === 0 ? (
                <Text style={typography.caption}>这一餐还没有放任何食材或食谱。</Text>
              ) : (
                slot.items.map((item) => (
                  <ListTile
                    key={item.id}
                    title={item.display_name}
                    subtitle={item.amount_g !== null ? `计划 ${item.amount_g} g` : '未设定份量'}
                    right={
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`移除 ${item.display_name}`}
                        onPress={() => {
                          removePlanItem(db, item.id);
                          refresh();
                        }}
                        style={{ minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Text style={{ color: colors.textFaint, fontSize: 18 }}>×</Text>
                      </Pressable>
                    }
                  />
                ))
              )}
            </View>

            <Row style={{ marginTop: spacing.md, flexWrap: 'wrap' }}>
              <Button
                label="＋ 加食材"
                variant="secondary"
                style={{ marginRight: spacing.sm, marginBottom: spacing.sm }}
                onPress={() =>
                  navigation.navigate('PickIngredient', {
                    onPickSlotId: slot.id,
                    date,
                  })
                }
              />
              <Button
                label="记录这一餐"
                disabled={slot.items.length === 0}
                accessibilityHint={slot.items.length === 0 ? '先给这一餐添加食材' : '记录实际吃了多少'}
                style={{ marginBottom: spacing.sm }}
                onPress={() => setFeedingFor(slot)}
              />
            </Row>
            <Button
              label="删除餐次"
              variant="ghost"
              onPress={() =>
                Alert.alert('删除餐次', `确定删除「${slot.label}」吗？已经记录的进食不会被删除。`, [
                  { text: '取消', style: 'cancel' },
                  {
                    text: '删除',
                    style: 'destructive',
                    onPress: () => {
                      removeSlot(db, slot.id);
                      refresh();
                    },
                  },
                ])
              }
            />
          </Card>
        ))
      )}

      {slots.length === 0 && (
        <Button
          label="复制前一天的餐次安排"
          variant="secondary"
          onPress={() => {
            const n = copySlotsFrom(db, baby.id, shiftLocalDate(date, -1), date);
            refresh();
            if (n === 0) Alert.alert('没有可复制的内容', '前一天没有餐次安排。');
          }}
        />
      )}

      <SectionHeader title="今天的小结" />
      <Card>
        <Text style={typography.label}>奶与水</Text>
        {summary.liquids.every((l) => l.events === 0) ? (
          <Text style={[typography.caption, { marginTop: spacing.xs }]}>今天还没有记录奶量或饮水。</Text>
        ) : (
          summary.liquids
            .filter((l) => l.events > 0)
            .map((l) => (
              <Row key={l.kind} style={{ justifyContent: 'space-between', marginTop: spacing.sm }}>
                <Text style={typography.body}>{l.label}</Text>
                <Text style={typography.bodyStrong}>
                  {l.known_events > 0 ? `${l.known_total_ml} mL` : '量不详'}
                  <Text style={typography.caption}>　{l.events} 次</Text>
                </Text>
              </Row>
            ))
        )}
        {summary.liquids.some((l) => l.has_unknown) && (
          <UnknownNotice text="有记录没有填写具体量。这里显示的是已知部分的合计，不是全天总量；未知不等于 0。" />
        )}
      </Card>

      <Card>
        <Text style={typography.label}>吃到的食材</Text>
        {summary.food.eaten_ingredient_ids.length === 0 ? (
          <Text style={[typography.caption, { marginTop: spacing.xs }]}>今天还没有确认吃下的食材记录。</Text>
        ) : (
          <Text style={[typography.body, { marginTop: spacing.xs }]}>
            {summary.food.eaten_ingredient_ids.length} 种
          </Text>
        )}
        {summary.coverage_notes.map((n, i) => (
          <Text key={i} style={[typography.caption, { marginTop: spacing.xs }]}>
            · {n}
          </Text>
        ))}
      </Card>

      {feedings.length > 0 && (
        <>
          <SectionHeader title="已记录的进食" />
          {feedings.map((f) => (
            <Card key={f.id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={typography.bodyStrong}>{f.meal_label ?? '一次进食'}</Text>
                  <Text style={typography.caption}>
                    {f.ingredients.map((i) => i.name ?? i.free_text ?? '未命名').join('、')}
                  </Text>
                  <Text style={[typography.caption, { marginTop: 2 }]}>
                    {describeIntakeText(f.intake_mode as IntakeMode, f.intake_ratio, f.intake_amount_g)}
                    {f.revision > 1 ? ` · 第 ${f.revision} 次修订` : ''}
                  </Text>
                </View>
                <Button
                  label="撤销"
                  variant="ghost"
                  onPress={() =>
                    Alert.alert('撤销这条记录', '记录会从统计中移除，但仍保留在历史中可供追溯。', [
                      { text: '取消', style: 'cancel' },
                      {
                        text: '撤销',
                        onPress: () => {
                          undoFact(db, 'feeding_events', f.id);
                          refresh();
                        },
                      },
                    ])
                  }
                />
              </Row>
            </Card>
          ))}
        </>
      )}

      <SlotEditorModal
        visible={slotEditor}
        onClose={() => setSlotEditor(false)}
        onCreate={(label, time) => {
          createSlot(db, baby.id, date, label, time);
          setSlotEditor(false);
          refresh();
        }}
      />

      <FeedingModal
        slot={feedingFor}
        onClose={() => setFeedingFor(null)}
        onSubmit={(mode, ratio, grams) => {
          try {
            const snapshot = snapshotFromSlot(db, feedingFor!.id);
            recordFeeding(db, {
              babyId: baby.id,
              mealSlotId: feedingFor!.id,
              mealLabel: feedingFor!.label,
              occurredAt: new Date(),
              timezone: baby.timezone,
              snapshot,
              intakeMode: mode,
              intakeRatio: mode === 'ratio' ? ratio : null,
              intakeAmountG: mode === 'absolute' ? grams : null,
            });
            setFeedingFor(null);
            refresh();
          } catch (e) {
            setError(e instanceof FeedingValidationError ? e.message : String(e));
            setFeedingFor(null);
          }
        }}
      />
    </Screen>
  );
}

function describeIntakeText(mode: IntakeMode, ratio: number | null, grams: number | null): string {
  if (mode === 'ratio' && ratio !== null) return `吃下约 ${Math.round(ratio * 100)}%`;
  if (mode === 'absolute' && grams !== null) return `吃下约 ${grams} g`;
  return INTAKE_MODE_LABELS[mode] ?? '吃了多少不详';
}

function SlotEditorModal({
  visible,
  onClose,
  onCreate,
}: {
  visible: boolean;
  onClose: () => void;
  onCreate: (label: string, time: string | null) => void;
}) {
  const [label, setLabel] = useState('');
  const [time, setTime] = useState('');
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sheetBackdrop}>
        <View style={sheet}>
          <Text style={typography.title}>添加餐次</Text>
          <Text style={[typography.caption, { marginTop: spacing.xs, marginBottom: spacing.md }]}>
            按你家实际的作息来，不必和任何标准模板一致。
          </Text>
          <Row style={{ flexWrap: 'wrap', marginBottom: spacing.md }}>
            {SLOT_LABEL_SUGGESTIONS.map((s) => (
              <Chip key={s} label={s} selected={label === s} onPress={() => setLabel(s)} />
            ))}
          </Row>
          <Field label="名称" value={label} onChangeText={setLabel} placeholder="例如 午餐" />
          <Field
            label="大致时间（可不填）"
            value={time}
            onChangeText={setTime}
            placeholder="例如 12:00"
            hint="只是方便排序和提醒，不会用来判断是否按时喂养。"
          />
          <Row style={{ justifyContent: 'flex-end' }}>
            <Button label="取消" variant="ghost" onPress={onClose} />
            <Button
              label="添加"
              disabled={!label.trim()}
              style={{ marginLeft: spacing.sm }}
              onPress={() => {
                onCreate(label.trim(), time.trim() || null);
                setLabel('');
                setTime('');
              }}
            />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

function FeedingModal({
  slot,
  onClose,
  onSubmit,
}: {
  slot: MealSlotView | null;
  onClose: () => void;
  onSubmit: (mode: IntakeMode, ratio: number | null, grams: number | null) => void;
}) {
  const [mode, setMode] = useState<IntakeMode>('unknown');
  const [ratio, setRatio] = useState<number | null>(null);
  const [grams, setGrams] = useState('');

  if (!slot) return null;
  const gramsValue = grams.trim() === '' ? null : Number(grams);
  const canSubmit =
    mode === 'unknown' ||
    mode === 'none' ||
    (mode === 'ratio' && ratio !== null) ||
    (mode === 'absolute' && gramsValue !== null && Number.isFinite(gramsValue) && gramsValue >= 0);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={sheetBackdrop}>
        <View style={sheet}>
          <Text style={typography.title}>记录「{slot.label}」</Text>
          <Text style={[typography.caption, { marginTop: spacing.xs }]}>
            实际提供的内容已按计划带入：{slot.items.map((i) => i.display_name).join('、')}
          </Text>

          <Text style={[typography.label, { marginTop: spacing.lg, marginBottom: spacing.sm }]}>吃了多少</Text>
          <Row style={{ flexWrap: 'wrap' }}>
            <Chip label="不详" selected={mode === 'unknown'} onPress={() => setMode('unknown')} />
            <Chip label="一口没吃" selected={mode === 'none'} onPress={() => setMode('none')} />
            <Chip label="按比例" selected={mode === 'ratio'} onPress={() => setMode('ratio')} />
            <Chip label="按克数" selected={mode === 'absolute'} onPress={() => setMode('absolute')} />
          </Row>

          {mode === 'ratio' && (
            <Row style={{ flexWrap: 'wrap', marginTop: spacing.sm }}>
              {[0.25, 0.5, 0.75, 1].map((r) => (
                <Chip
                  key={r}
                  label={`${r * 100}%`}
                  selected={ratio === r}
                  onPress={() => setRatio(r)}
                />
              ))}
            </Row>
          )}

          {mode === 'absolute' && (
            <Field
              label="整份吃下的克数"
              value={grams}
              onChangeText={setGrams}
              keyboardType="decimal-pad"
              hint="这是整份的量。应用不会把它按比例分摊到每种食材上。"
            />
          )}

          {(mode === 'ratio' || mode === 'absolute') && slot.items.length > 1 && (
            <UnknownNotice text="这一餐有多种食材混合。每种食材各吃了多少仍记为不详，不会被估算。" />
          )}

          <Row style={{ justifyContent: 'flex-end', marginTop: spacing.lg }}>
            <Button label="取消" variant="ghost" onPress={onClose} />
            <Button
              label="保存"
              disabled={!canSubmit}
              style={{ marginLeft: spacing.sm }}
              onPress={() => onSubmit(mode, ratio, gramsValue)}
            />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

export const sheetBackdrop = {
  flex: 1,
  backgroundColor: 'rgba(58,52,48,0.35)',
  justifyContent: 'flex-end' as const,
};

export const sheet = {
  backgroundColor: colors.bg,
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
  padding: spacing.xl,
  paddingBottom: spacing.xxl,
  maxHeight: '88%' as const,
};
