import { SqlDriver } from '../../db/driver';
import { newId, opIdFor } from '../ids';
import { stampFor } from '../time';
import { GrowthMeasurement } from '../types';
import { audit, findByOpId } from './facts';
import { FactValidationError } from './events';

export interface RecordGrowthInput {
  babyId: string;
  kind: 'weight' | 'length';
  value: number;
  unit: 'kg' | 'g' | 'cm';
  occurredAt: Date;
  timezone: string;
  method?: string | null;
  note?: string | null;
  opId?: string;
}

const LIMITS: Record<string, { min: number; max: number; label: string }> = {
  kg: { min: 0.3, max: 40, label: '体重(kg)' },
  g: { min: 300, max: 40000, label: '体重(g)' },
  cm: { min: 20, max: 140, label: '身长/身高(cm)' },
};

/**
 * Only the measured value and when it happened are required.
 * Measurement method stays optional and, when absent, blocks nothing except
 * reference comparisons that depend on knowing lying vs standing.
 */
export function recordGrowth(db: SqlDriver, input: RecordGrowthInput): GrowthMeasurement {
  const lim = LIMITS[input.unit];
  if (!lim) throw new FactValidationError('单位无效');
  if (!Number.isFinite(input.value) || input.value <= 0) throw new FactValidationError('请输入大于 0 的测量值');
  if (input.value < lim.min || input.value > lim.max) {
    throw new FactValidationError(`${lim.label} 超出可信范围，请检查数值与单位`);
  }
  if (input.kind === 'weight' && input.unit === 'cm') throw new FactValidationError('体重单位应为 kg 或 g');
  if (input.kind === 'length' && input.unit !== 'cm') throw new FactValidationError('身长/身高单位应为 cm');
  if (input.occurredAt.getTime() > Date.now() + 5 * 60000) throw new FactValidationError('测量时间不能晚于现在');

  const stamp = stampFor(input.occurredAt, input.timezone);
  const opId = input.opId ?? opIdFor(['growth', input.babyId, input.kind, input.value, input.unit, stamp.occurred_at]);

  return db.transaction(() => {
    const dup = findByOpId(db, 'growth_measurements', opId);
    if (dup) return db.get<GrowthMeasurement>('SELECT * FROM growth_measurements WHERE id = ?', [dup])!;
    const id = newId('grow');
    db.run(
      `INSERT INTO growth_measurements
        (id, baby_id, kind, value, unit, method, occurred_at, occurred_offset_min, occurred_tz,
         occurred_local_date, recorded_at, note, revision, status, supersedes_id, client_op_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,'active',NULL,?)`,
      [
        id,
        input.babyId,
        input.kind,
        input.value,
        input.unit,
        input.method ?? null,
        stamp.occurred_at,
        stamp.occurred_offset_min,
        stamp.occurred_tz,
        stamp.occurred_local_date,
        new Date().toISOString(),
        input.note ?? null,
        opId,
      ],
    );
    audit(db, 'growth_measurements', id, 'create', { kind: input.kind });
    return db.get<GrowthMeasurement>('SELECT * FROM growth_measurements WHERE id = ?', [id])!;
  });
}

export function listGrowth(db: SqlDriver, babyId: string, kind: 'weight' | 'length'): GrowthMeasurement[] {
  return db.all<GrowthMeasurement>(
    "SELECT * FROM growth_measurements WHERE baby_id = ? AND kind = ? AND status = 'active' ORDER BY occurred_at",
    [babyId, kind],
  );
}

/** Normalises any stored measurement to kg / cm for charting. */
export function normalisedValue(m: GrowthMeasurement): number {
  if (m.unit === 'g') return m.value / 1000;
  return m.value;
}
