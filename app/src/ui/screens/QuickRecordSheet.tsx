import React, { useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { useApp } from '../AppProvider';
import { Button, Card, Chip, ErrorState, Field, Row, UnknownNotice } from '../components';
import { sheet, sheetBackdrop } from './TodayScreen';
import { spacing, typography } from '../theme';
import {
  FactValidationError,
  QUICK_ML_PRESETS,
  recordExposure,
  recordLiquid,
  recordSuspicion,
  recordSymptom,
} from '../../domain/repositories/events';
import { LIQUID_LABELS, LiquidKind } from '../../domain/types';

type Tab = 'liquid' | 'exposure' | 'symptom' | 'suspicion';

const TABS: { key: Tab; label: string }[] = [
  { key: 'liquid', label: '奶 / 水' },
  { key: 'exposure', label: '尝到食物' },
  { key: 'symptom', label: '身体情况' },
  { key: 'suspicion', label: '我的怀疑' },
];

/**
 * One sheet, four deliberately separate kinds of fact. Nothing entered on one
 * tab is ever copied into another: tasting a food is not a reaction, and a
 * caregiver's suspicion is not a symptom or a diagnosis.
 */
export function QuickRecordSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { db, baby, refresh } = useApp();
  const [tab, setTab] = useState<Tab>('liquid');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const [kind, setKind] = useState<LiquidKind>('formula');
  const [ml, setMl] = useState('');
  const [amountUnknown, setAmountUnknown] = useState(false);

  const [foodText, setFoodText] = useState('');
  const [exposureG, setExposureG] = useState('');

  const [symptom, setSymptom] = useState('');
  const [severity, setSeverity] = useState<'mild' | 'moderate' | 'severe' | 'unspecified'>('unspecified');

  const [suspectFood, setSuspectFood] = useState('');
  const [rationale, setRationale] = useState('');

  const reset = () => {
    setMl('');
    setAmountUnknown(false);
    setFoodText('');
    setExposureG('');
    setSymptom('');
    setSeverity('unspecified');
    setSuspectFood('');
    setRationale('');
  };

  const submit = () => {
    setError(null);
    try {
      const now = new Date();
      if (tab === 'liquid') {
        const amount = amountUnknown || ml.trim() === '' ? null : Number(ml);
        recordLiquid(db, {
          babyId: baby.id,
          kind,
          amountMl: amount,
          occurredAt: now,
          timezone: baby.timezone,
        });
        setDone(amount === null ? `已记录一次${LIQUID_LABELS[kind]}，量记为不详` : `已记录 ${amount} mL`);
      } else if (tab === 'exposure') {
        recordExposure(db, {
          babyId: baby.id,
          ingredientId: null,
          freeText: foodText.trim(),
          amountG: exposureG.trim() === '' ? null : Number(exposureG),
          occurredAt: now,
          timezone: baby.timezone,
        });
        setDone('已记录一次食物接触。这只是接触记录，不代表任何反应。');
      } else if (tab === 'symptom') {
        recordSymptom(db, {
          babyId: baby.id,
          description: symptom.trim(),
          severity,
          occurredAt: now,
          timezone: baby.timezone,
        });
        setDone('已记录一条观察。应用不会把它和任何食物自动关联。');
      } else {
        recordSuspicion(db, {
          babyId: baby.id,
          ingredientId: null,
          freeText: suspectFood.trim() || null,
          rationale: rationale.trim(),
          occurredAt: now,
          timezone: baby.timezone,
        });
        setDone('已记录你的怀疑。这是你的判断记录，不是诊断结论。');
      }
      reset();
      refresh();
    } catch (e) {
      setError(e instanceof FactValidationError ? e.message : String(e));
    }
  };

  const canSubmit =
    tab === 'liquid'
      ? amountUnknown || ml.trim() !== ''
      : tab === 'exposure'
        ? foodText.trim() !== ''
        : tab === 'symptom'
          ? symptom.trim() !== ''
          : rationale.trim() !== '';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={sheetBackdrop}>
        <View style={sheet}>
          <Text style={typography.title}>快速记录</Text>
          <Row style={{ flexWrap: 'wrap', marginTop: spacing.md, marginBottom: spacing.sm }}>
            {TABS.map((t) => (
              <Chip
                key={t.key}
                label={t.label}
                selected={tab === t.key}
                onPress={() => {
                  setTab(t.key);
                  setDone(null);
                  setError(null);
                }}
              />
            ))}
          </Row>

          {!!error && <ErrorState detail={error} />}
          {!!done && (
            <Card tone="alt">
              <Text style={typography.caption}>{done}</Text>
            </Card>
          )}

          {tab === 'liquid' && (
            <View>
              <Row style={{ flexWrap: 'wrap', marginBottom: spacing.sm }}>
                {(Object.keys(LIQUID_LABELS) as LiquidKind[]).map((k) => (
                  <Chip key={k} label={LIQUID_LABELS[k]} selected={kind === k} onPress={() => setKind(k)} />
                ))}
              </Row>
              <Row style={{ flexWrap: 'wrap', marginBottom: spacing.sm }}>
                {QUICK_ML_PRESETS[kind].map((v) => (
                  <Chip
                    key={v}
                    label={`${v} mL`}
                    selected={!amountUnknown && ml === String(v)}
                    onPress={() => {
                      setMl(String(v));
                      setAmountUnknown(false);
                    }}
                  />
                ))}
                <Chip
                  label="量不详"
                  tone="warn"
                  selected={amountUnknown}
                  onPress={() => {
                    setAmountUnknown(true);
                    setMl('');
                  }}
                />
              </Row>
              {!amountUnknown && (
                <Field
                  label="毫升"
                  value={ml}
                  onChangeText={(v) => {
                    setMl(v);
                    setAmountUnknown(false);
                  }}
                  keyboardType="decimal-pad"
                  hint="快捷按钮只是输入快捷方式，不代表建议喝多少。"
                />
              )}
              {amountUnknown && <UnknownNotice text="「量不详」会被如实保存为未知，统计时不会当作 0。" />}
            </View>
          )}

          {tab === 'exposure' && (
            <View>
              <Field
                label="吃到或碰到了什么"
                value={foodText}
                onChangeText={setFoodText}
                placeholder="例如 蛋黄一小口"
              />
              <Field
                label="大约多少克（可不填）"
                value={exposureG}
                onChangeText={setExposureG}
                keyboardType="decimal-pad"
                hint="不填就记为不详。"
              />
              <UnknownNotice text="接触记录独立保存，不会自动与任何症状或过敏结论关联。" />
            </View>
          )}

          {tab === 'symptom' && (
            <View>
              <Field
                label="观察到什么"
                value={symptom}
                onChangeText={setSymptom}
                multiline
                placeholder="例如 下午脸颊出现几个红点"
              />
              <Text style={[typography.label, { marginBottom: spacing.sm }]}>严重程度（你的主观判断）</Text>
              <Row style={{ flexWrap: 'wrap' }}>
                {(
                  [
                    ['unspecified', '未判断'],
                    ['mild', '轻'],
                    ['moderate', '中'],
                    ['severe', '重'],
                  ] as const
                ).map(([k, l]) => (
                  <Chip key={k} label={l} selected={severity === k} onPress={() => setSeverity(k)} />
                ))}
              </Row>
              <UnknownNotice text="这是观察记录，不是诊断。如情况严重或持续，请直接联系医生。" />
            </View>
          )}

          {tab === 'suspicion' && (
            <View>
              <Field label="你怀疑的食物（可不填）" value={suspectFood} onChangeText={setSuspectFood} />
              <Field
                label="为什么这样怀疑"
                value={rationale}
                onChangeText={setRationale}
                multiline
                placeholder="例如 两次吃完都出现红点"
              />
              <UnknownNotice text="应用会原样保存你的怀疑，但不会据此判定过敏，也不会自动回避该食物，除非你在推荐里手动加入回避。" />
            </View>
          )}

          <Row style={{ justifyContent: 'flex-end', marginTop: spacing.lg }}>
            <Button label="完成" variant="ghost" onPress={onClose} />
            <Button label="保存" disabled={!canSubmit} style={{ marginLeft: spacing.sm }} onPress={submit} />
          </Row>
        </View>
      </View>
    </Modal>
  );
}
