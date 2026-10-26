import React, { useMemo, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { useApp } from '../AppProvider';
import { Button, Card, Chip, EmptyState, ErrorState, Field, Row, Screen, SectionHeader, UnknownNotice } from '../components';
import { colors, spacing, typography } from '../theme';
import { listGrowth, normalisedValue, recordGrowth } from '../../domain/repositories/growth';
import { FactValidationError } from '../../domain/repositories/events';
import { computeZScore, referenceBand } from '../../domain/growthRef';
import { ageInDays, ageInMonths } from '../../domain/time';
import { rangeSummary } from '../../domain/summary';
import { estimateEnergy } from '../../domain/summary';
import { GrowthMeasurement } from '../../domain/types';
import { reviseFact, undoFact } from '../../domain/repositories/facts';
import { OccurredAtField, useOccurredAt } from '../OccurredAt';
import { newId } from '../../domain/ids';
import { ListTile } from '../components';

export function GrowthScreen({ navigation }: { navigation: { navigate: (s: string, p?: object) => void } }) {
  const { db, baby, today, nowTime, refresh, revision } = useApp();
  const [kind, setKind] = useState<'weight' | 'length'>('weight');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<'kg' | 'g' | 'cm'>('kg');
  const [method, setMethod] = useState<'lying' | 'standing' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<GrowthMeasurement | null>(null);
  const [editValue, setEditValue] = useState('');
  const [when, setWhenDate, setWhenTime, resetWhen] = useOccurredAt(baby.timezone, today, nowTime);
  const opIdRef = useRef(newId('op'));
  // Synchronous re-entry guard. `busy` is state and React batches updates, so
  // two taps in one batch would both observe `busy === false`.
  const submittingRef = useRef(false);

  const measurements = useMemo(
    () => listGrowth(db, baby.id, kind),
    [db, baby.id, kind, revision],
  );
  const week = useMemo(() => rangeSummary(db, baby.id, today, 7), [db, baby.id, today, revision]);
  const energy = useMemo(() => estimateEnergy(db, baby.id, today), [db, baby.id, today, revision]);

  const latest = measurements[measurements.length - 1];
  const indicator = kind === 'weight' ? 'weight_for_age' : 'length_for_age';
  const latestZ = latest
    ? computeZScore(db, {
        indicator,
        sex: baby.sex,
        ageDays: ageInDays(baby.birth_date, latest.occurred_local_date),
        value: normalisedValue(latest),
        method: latest.method,
      })
    : null;

  return (
    <Screen>
      <Text style={typography.display}>成长与营养</Text>
      <Text style={[typography.caption, { marginTop: spacing.xs, marginBottom: spacing.lg }]}>
        参考曲线来自 WHO Child Growth Standards (2006)。参考分位只是统计位置，不是健康评价，也不构成诊断。
      </Text>

      <Row style={{ marginBottom: spacing.md }}>
        <Chip
          label="体重"
          selected={kind === 'weight'}
          onPress={() => {
            setKind('weight');
            setUnit('kg');
          }}
        />
        <Chip
          label="身长 / 身高"
          selected={kind === 'length'}
          onPress={() => {
            setKind('length');
            setUnit('cm');
          }}
        />
      </Row>

      <Card>
        <Text style={typography.label}>生长曲线</Text>
        {measurements.length === 0 ? (
          <Text style={[typography.caption, { marginTop: spacing.sm }]}>
            还没有记录。记录两次以上才能看到趋势。
          </Text>
        ) : (
          <GrowthChart
            db={db}
            indicator={indicator}
            sex={baby.sex}
            birthDate={baby.birth_date}
            measurements={measurements}
          />
        )}
        {baby.sex !== 'male' && baby.sex !== 'female' && (
          <UnknownNotice text="未填写性别，WHO 参考按男/女分别建立，暂不显示参考带。" />
        )}
        {baby.birth_date === null && <UnknownNotice text="未填写出生日期，无法按月龄对齐参考曲线。" />}
      </Card>

      <Card>
        <Text style={typography.label}>最近一次测量</Text>
        {!latest ? (
          <Text style={[typography.caption, { marginTop: spacing.sm }]}>还没有测量记录。</Text>
        ) : (
          <>
            <Text style={[typography.number, { marginTop: spacing.xs }]}>
              {latest.value} {latest.unit}
            </Text>
            <Text style={typography.caption}>
              {latest.occurred_local_date} · {ageInMonths(baby.birth_date, latest.occurred_local_date) ?? '?'} 个月
            </Text>
            {latestZ && latestZ.ok ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={typography.bodyStrong}>
                  约处于同月龄同性别的第 {latestZ.percentile.toFixed(1)} 百分位（z = {latestZ.z.toFixed(2)}）
                </Text>
                <Text style={[typography.caption, { marginTop: spacing.xs }]}>
                  依据 WHO 2006 标准（{latestZ.pack_version}）。单次测量的位置不代表健康状况；是否需要关注请咨询医生。
                </Text>
              </View>
            ) : (
              <UnknownNotice text={latestZ ? latestZ.message : '暂无法计算参考分位。'} />
            )}
          </>
        )}
      </Card>

      <SectionHeader title="添加测量" />
      <Card>
        {!!error && <ErrorState detail={error} onRetry={() => setError(null)} />}
        <Row style={{ marginBottom: spacing.md, flexWrap: 'wrap' }}>
          {(kind === 'weight' ? (['kg', 'g'] as const) : (['cm'] as const)).map((u) => (
            <Chip key={u} label={u} selected={unit === u} onPress={() => setUnit(u)} />
          ))}
        </Row>
        <Field
          label={kind === 'weight' ? '体重' : '身长 / 身高'}
          value={value}
          onChangeText={setValue}
          keyboardType="decimal-pad"
          hint={`单位 ${unit}。会原样保存你输入的单位。`}
        />
        <OccurredAtField tz={baby.timezone} today={today} state={when} onDateChange={setWhenDate} onTimeChange={setWhenTime} />
        {kind === 'length' && (
          <View style={{ marginBottom: spacing.lg }}>
            <Text style={[typography.label, { marginBottom: spacing.sm }]}>测量方式</Text>
            <Row style={{ flexWrap: 'wrap' }}>
              <Chip label="躺着量（身长）" selected={method === 'lying'} onPress={() => setMethod('lying')} />
              <Chip label="站着量（身高）" selected={method === 'standing'} onPress={() => setMethod('standing')} />
            </Row>
            <Text style={[typography.caption, { marginTop: spacing.xs }]}>
              WHO 在 2 岁前后使用不同口径，不填写就无法比较参考分位。
            </Text>
          </View>
        )}
        <Button
          label={busy ? '保存中…' : '保存测量'}
          disabled={value.trim() === '' || busy || !when.valid}
          onPress={() => {
            setError(null);
            if (!when.valid) {
              setError('请先把测量时间填写成 24 小时制的 时:分。');
              return;
            }
            // Claim the guard only once the submission is actually going
            // ahead; an early return before the try/finally would otherwise
            // leave the ref latched and kill the button for good.
            if (submittingRef.current || busy) return;
            submittingRef.current = true;
            setBusy(true);
            try {
              recordGrowth(db, {
                babyId: baby.id,
                kind,
                value: Number(value),
                unit,
                occurredAt: when.toDate(),
                timezone: baby.timezone,
                method: kind === 'length' ? method : null,
                opId: opIdRef.current,
              });
              setValue('');
              opIdRef.current = newId('op');
              resetWhen();
              refresh();
            } catch (e) {
              setError(e instanceof FactValidationError ? e.message : String(e));
            } finally {
              submittingRef.current = false;
              setBusy(false);
            }
          }}
        />
      </Card>

      <SectionHeader title="已记录的测量" />
      {measurements.length === 0 ? (
        <Card>
          <Text style={typography.caption}>还没有{kind === 'weight' ? '体重' : '身长 / 身高'}记录。</Text>
        </Card>
      ) : (
        [...measurements].reverse().map((m) => (
          <Card key={m.id}>
            <ListTile
              title={`${m.value} ${m.unit}`}
              subtitle={`${m.occurred_local_date}${m.method ? ' · ' + (m.method === 'lying' ? '躺着量' : '站着量') : ''}${m.revision > 1 ? ` · 第 ${m.revision} 次修改` : ''}`}
              onPress={() => {
                setEditing(m);
                setEditValue(String(m.value));
              }}
              accessibilityHint="修改或撤销这条测量"
              right={
                <Button
                  label="撤销"
                  variant="ghost"
                  onPress={() =>
                    Alert.alert('撤销这条测量？', `${m.occurred_local_date} 的 ${m.value} ${m.unit} 将不再参与计算。`, [
                      { text: '取消', style: 'cancel' },
                      {
                        text: '撤销',
                        style: 'destructive',
                        onPress: () => {
                          undoFact(db, 'growth_measurements', m.id);
                          refresh();
                        },
                      },
                    ])
                  }
                />
              }
            />
          </Card>
        ))
      )}

      {editing && (
        <Card tone="alt">
          <Text style={typography.section}>修改测量</Text>
          <Text style={[typography.caption, { marginTop: spacing.xs, marginBottom: spacing.sm }]}>
            {editing.occurred_local_date} 原值 {editing.value} {editing.unit}。修改会保留历史版本，不会覆盖原始记录。
          </Text>
          <Field label={`新的数值（${editing.unit}）`} value={editValue} onChangeText={setEditValue} keyboardType="decimal-pad" />
          <Row style={{ justifyContent: 'flex-end' }}>
            <Button label="取消" variant="ghost" onPress={() => setEditing(null)} />
            <Button
              label="保存修改"
              style={{ marginLeft: spacing.sm }}
              disabled={editValue.trim() === '' || Number.isNaN(Number(editValue))}
              onPress={() => {
                const n = Number(editValue);
                if (!Number.isFinite(n) || n <= 0) {
                  setError('数值需为正数。');
                  return;
                }
                reviseFact(db, 'growth_measurements', 'gm', editing.id, { value: n });
                setEditing(null);
                refresh();
              }}
            />
          </Row>
        </Card>
      )}

      <SectionHeader title="最近 7 天" />
      <Card>
        <Text style={typography.body}>有记录的天数：{week.days_with_any_record} / {week.days}</Text>
        <Text style={typography.body}>进食记录：{week.feeding_events} 次</Text>
        <Text style={typography.body}>吃到的不同食材：{week.distinct_eaten_ingredients} 种</Text>
        <Text style={typography.body}>覆盖的食物类别：{week.distinct_eaten_food_groups} 类</Text>
        {week.coverage_notes.map((n, i) => (
          <Text key={i} style={[typography.caption, { marginTop: spacing.xs }]}>
            · {n}
          </Text>
        ))}
      </Card>

      <SectionHeader title="营养估算" />
      <Card tone="warn">
        <Text style={typography.bodyStrong}>{energy.reason}</Text>
        {energy.missing.map((m, i) => (
          <Text key={i} style={[typography.caption, { marginTop: spacing.xs }]}>
            · {m}
          </Text>
        ))}
        <Button
          label="查看资料来源与许可"
          variant="ghost"
          style={{ marginTop: spacing.md }}
          onPress={() => navigation.navigate('Sources')}
        />
      </Card>
    </Screen>
  );
}

const W = 300;
const H = 180;
const PAD = 28;

function GrowthChart({
  db,
  indicator,
  sex,
  birthDate,
  measurements,
}: {
  db: ReturnType<typeof useApp>['db'];
  indicator: 'weight_for_age' | 'length_for_age';
  sex: string;
  birthDate: string | null;
  measurements: GrowthMeasurement[];
}) {
  const points = measurements
    .map((m) => ({ x: ageInDays(birthDate, m.occurred_local_date), y: normalisedValue(m) }))
    .filter((p): p is { x: number; y: number } => p.x !== null);

  if (points.length === 0) {
    return <Text style={[typography.caption, { marginTop: spacing.sm }]}>需要出生日期才能按月龄绘制。</Text>;
  }

  const minDay = 0;
  const maxDay = Math.max(180, Math.max(...points.map((p) => p.x)) + 30);
  const band = referenceBand(db, indicator, sex, minDay, Math.min(maxDay, 1157));

  const ys = [
    ...points.map((p) => p.y),
    ...(band ? band.map((b) => b.sd2neg) : []),
    ...(band ? band.map((b) => b.sd2pos) : []),
  ];
  const minY = Math.min(...ys) * 0.95;
  const maxY = Math.max(...ys) * 1.05;

  const sx = (d: number) => PAD + ((d - minDay) / (maxDay - minDay || 1)) * (W - PAD * 2);
  const sy = (v: number) => H - PAD - ((v - minY) / (maxY - minY || 1)) * (H - PAD * 2);
  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');

  return (
    <View style={{ marginTop: spacing.md }}>
      <Svg width={W} height={H} accessibilityLabel="生长曲线图">
        <Line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={colors.border} strokeWidth={1} />
        <Line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={colors.border} strokeWidth={1} />
        {band && (
          <>
            <Path
              d={toPath(band.map((b) => ({ x: b.age_days, y: b.sd2pos })))}
              stroke={colors.sage}
              strokeWidth={1}
              strokeDasharray="4 4"
              fill="none"
            />
            <Path
              d={toPath(band.map((b) => ({ x: b.age_days, y: b.median })))}
              stroke={colors.sage}
              strokeWidth={1.5}
              fill="none"
            />
            <Path
              d={toPath(band.map((b) => ({ x: b.age_days, y: b.sd2neg })))}
              stroke={colors.sage}
              strokeWidth={1}
              strokeDasharray="4 4"
              fill="none"
            />
          </>
        )}
        <Path d={toPath(points)} stroke={colors.terracotta} strokeWidth={2} fill="none" />
        {points.map((p, i) => (
          <Circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={3} fill={colors.terracotta} />
        ))}
        <SvgText x={PAD} y={H - 8} fontSize={10} fill={colors.textFaint}>
          0 月
        </SvgText>
        <SvgText x={W - PAD - 24} y={H - 8} fontSize={10} fill={colors.textFaint}>
          {Math.round(maxDay / 30.4375)} 月
        </SvgText>
      </Svg>
      <Text style={[typography.caption, { marginTop: spacing.xs }]}>
        {band
          ? '绿线为 WHO 中位数，虚线为 ±2 SD 参考带；橙线为宝宝实测值。'
          : '缺少性别或参考数据，仅显示实测值。'}
      </Text>
    </View>
  );
}
