import { SqlDriver } from '../../db/driver';
import { newId, opIdFor } from '../ids';
import { stampFor } from '../time';
import { ExposureEvent, LiquidEvent, LiquidKind, SymptomObservation } from '../types';
import { audit, findByOpId } from './facts';

export class FactValidationError extends Error {}

/**
 * Convenience mL buttons. These are *input shortcuts only*.
 * They are never pre-selected and the app never presents them as an
 * amount the baby should drink.
 */
export const QUICK_ML_PRESETS: Record<LiquidKind, number[]> = {
  breastmilk: [60, 90, 120, 150],
  formula: [60, 90, 120, 150, 180],
  water: [20, 30, 50, 80],
  other: [30, 50, 100],
};

export interface RecordLiquidInput {
  babyId: string;
  kind: LiquidKind;
  /** null means the caregiver chose "量不详" — which is NOT zero. */
  amountMl: number | null;
  occurredAt: Date;
  timezone: string;
  note?: string | null;
  opId?: string;
}

export function recordLiquid(db: SqlDriver, input: RecordLiquidInput): LiquidEvent {
  if (input.amountMl !== null) {
    if (!Number.isFinite(input.amountMl) || input.amountMl < 0) throw new FactValidationError('奶量需为 0 或正数');
    if (input.amountMl > 2000) throw new FactValidationError('数值过大，请确认单位为 mL');
  }
  if (input.occurredAt.getTime() > Date.now() + 5 * 60000) {
    throw new FactValidationError('发生时间不能晚于现在');
  }
  const stamp = stampFor(input.occurredAt, input.timezone);
  const opId =
    input.opId ?? opIdFor(['liquid', input.babyId, input.kind, stamp.occurred_at, input.amountMl ?? 'unknown']);

  return db.transaction(() => {
    const dup = findByOpId(db, 'liquid_events', opId);
    if (dup) return db.get<LiquidEvent>('SELECT * FROM liquid_events WHERE id = ?', [dup])!;
    const id = newId('liq');
    db.run(
      `INSERT INTO liquid_events
        (id, baby_id, kind, amount_ml, amount_unknown, occurred_at, occurred_offset_min, occurred_tz,
         occurred_local_date, recorded_at, note, revision, status, supersedes_id, client_op_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,'active',NULL,?)`,
      [
        id,
        input.babyId,
        input.kind,
        input.amountMl,
        input.amountMl === null ? 1 : 0,
        stamp.occurred_at,
        stamp.occurred_offset_min,
        stamp.occurred_tz,
        stamp.occurred_local_date,
        new Date().toISOString(),
        input.note ?? null,
        opId,
      ],
    );
    audit(db, 'liquid_events', id, 'create', { kind: input.kind, unknown: input.amountMl === null });
    return db.get<LiquidEvent>('SELECT * FROM liquid_events WHERE id = ?', [id])!;
  });
}

export function listLiquids(db: SqlDriver, babyId: string, localDate: string): LiquidEvent[] {
  return db.all<LiquidEvent>(
    "SELECT * FROM liquid_events WHERE baby_id = ? AND occurred_local_date = ? AND status = 'active' ORDER BY occurred_at DESC",
    [babyId, localDate],
  );
}

export interface RecordExposureInput {
  babyId: string;
  ingredientId: string | null;
  freeText: string | null;
  amountG: number | null;
  occurredAt: Date;
  timezone: string;
  note?: string | null;
  opId?: string;
}

/**
 * "This food touched / was tasted." Deliberately separate from a feeding and
 * from any symptom: exposure alone is not evidence of a reaction.
 */
export function recordExposure(db: SqlDriver, input: RecordExposureInput): ExposureEvent {
  if (!input.ingredientId && !(input.freeText && input.freeText.trim())) {
    throw new FactValidationError('请至少选择或填写一种食材');
  }
  if (input.amountG !== null && (!Number.isFinite(input.amountG) || input.amountG < 0)) {
    throw new FactValidationError('接触量需为 0 或正数');
  }
  const stamp = stampFor(input.occurredAt, input.timezone);
  const opId =
    input.opId ??
    opIdFor(['exposure', input.babyId, input.ingredientId ?? input.freeText, stamp.occurred_at, input.amountG ?? 'u']);

  return db.transaction(() => {
    const dup = findByOpId(db, 'exposure_events', opId);
    if (dup) return db.get<ExposureEvent>('SELECT * FROM exposure_events WHERE id = ?', [dup])!;
    const id = newId('exp');
    db.run(
      `INSERT INTO exposure_events
        (id, baby_id, ingredient_id, free_text, amount_g, amount_unknown, occurred_at, occurred_offset_min,
         occurred_tz, occurred_local_date, recorded_at, note, revision, status, supersedes_id, client_op_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,'active',NULL,?)`,
      [
        id,
        input.babyId,
        input.ingredientId,
        input.freeText?.trim() || null,
        input.amountG,
        input.amountG === null ? 1 : 0,
        stamp.occurred_at,
        stamp.occurred_offset_min,
        stamp.occurred_tz,
        stamp.occurred_local_date,
        new Date().toISOString(),
        input.note ?? null,
        opId,
      ],
    );
    audit(db, 'exposure_events', id, 'create');
    return db.get<ExposureEvent>('SELECT * FROM exposure_events WHERE id = ?', [id])!;
  });
}

export function recordExposureBatch(
  db: SqlDriver,
  babyId: string,
  timezone: string,
  occurredAt: Date,
  entries: { ingredientId: string | null; freeText: string | null; amountG: number | null }[],
): ExposureEvent[] {
  return db.transaction(() =>
    entries.map((e) =>
      recordExposure(db, {
        babyId,
        timezone,
        occurredAt,
        ingredientId: e.ingredientId,
        freeText: e.freeText,
        amountG: e.amountG,
      }),
    ),
  );
}

export interface RecordSymptomInput {
  babyId: string;
  description: string;
  bodySite?: string | null;
  severity?: 'mild' | 'moderate' | 'severe' | 'unspecified';
  occurredAt: Date;
  timezone: string;
  opId?: string;
}

/**
 * A symptom observation stands on its own. The app never links it to a food
 * automatically, never infers causation and never produces a diagnosis.
 */
export function recordSymptom(db: SqlDriver, input: RecordSymptomInput): SymptomObservation {
  if (!input.description.trim()) throw new FactValidationError('请描述观察到的情况');
  const stamp = stampFor(input.occurredAt, input.timezone);
  const opId = input.opId ?? opIdFor(['symptom', input.babyId, input.description.trim(), stamp.occurred_at]);

  return db.transaction(() => {
    const dup = findByOpId(db, 'symptom_observations', opId);
    if (dup) return db.get<SymptomObservation>('SELECT * FROM symptom_observations WHERE id = ?', [dup])!;
    const id = newId('sym');
    db.run(
      `INSERT INTO symptom_observations
        (id, baby_id, description, body_site, observed_severity, occurred_at, occurred_offset_min, occurred_tz,
         occurred_local_date, recorded_at, revision, status, supersedes_id, client_op_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,1,'active',NULL,?)`,
      [
        id,
        input.babyId,
        input.description.trim(),
        input.bodySite ?? null,
        input.severity ?? 'unspecified',
        stamp.occurred_at,
        stamp.occurred_offset_min,
        stamp.occurred_tz,
        stamp.occurred_local_date,
        new Date().toISOString(),
        opId,
      ],
    );
    audit(db, 'symptom_observations', id, 'create');
    return db.get<SymptomObservation>('SELECT * FROM symptom_observations WHERE id = ?', [id])!;
  });
}

export interface RecordSuspicionInput {
  babyId: string;
  ingredientId: string | null;
  freeText: string | null;
  rationale: string;
  occurredAt: Date;
  timezone: string;
  opId?: string;
}

/** "I suspect X" — a caregiver hypothesis, never a diagnosis. */
export function recordSuspicion(db: SqlDriver, input: RecordSuspicionInput): { id: string } {
  if (!input.rationale.trim()) throw new FactValidationError('请填写怀疑的理由');
  const stamp = stampFor(input.occurredAt, input.timezone);
  const opId =
    input.opId ?? opIdFor(['suspicion', input.babyId, input.ingredientId ?? input.freeText, stamp.occurred_at]);
  return db.transaction(() => {
    const dup = findByOpId(db, 'caregiver_suspicions', opId);
    if (dup) return { id: dup };
    const id = newId('sus');
    db.run(
      `INSERT INTO caregiver_suspicions
        (id, baby_id, ingredient_id, free_text, rationale, occurred_at, occurred_offset_min, occurred_tz,
         occurred_local_date, recorded_at, revision, status, supersedes_id, client_op_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,1,'active',NULL,?)`,
      [
        id,
        input.babyId,
        input.ingredientId,
        input.freeText?.trim() || null,
        input.rationale.trim(),
        stamp.occurred_at,
        stamp.occurred_offset_min,
        stamp.occurred_tz,
        stamp.occurred_local_date,
        new Date().toISOString(),
        opId,
      ],
    );
    audit(db, 'caregiver_suspicions', id, 'create');
    return { id };
  });
}

export interface RecordClinicalNoteInput {
  babyId: string;
  content: string;
  clinicianRole?: string | null;
  occurredAt: Date;
  timezone: string;
}

/**
 * What the caregiver *says* a clinician told them. Stored verbatim and always
 * displayed as parent-reported; the app never treats it as a confirmed
 * diagnosis nor derives safety rules from it.
 */
export function recordClinicalNote(db: SqlDriver, input: RecordClinicalNoteInput): { id: string } {
  if (!input.content.trim()) throw new FactValidationError('请填写转述内容');
  const stamp = stampFor(input.occurredAt, input.timezone);
  const opId = opIdFor(['clinical', input.babyId, input.content.trim(), stamp.occurred_at]);
  return db.transaction(() => {
    const dup = findByOpId(db, 'reported_clinical_notes', opId);
    if (dup) return { id: dup };
    const id = newId('clin');
    db.run(
      `INSERT INTO reported_clinical_notes
        (id, baby_id, content, clinician_role, occurred_at, occurred_offset_min, occurred_tz,
         occurred_local_date, recorded_at, revision, status, supersedes_id, client_op_id)
       VALUES (?,?,?,?,?,?,?,?,?,1,'active',NULL,?)`,
      [
        id,
        input.babyId,
        input.content.trim(),
        input.clinicianRole ?? null,
        stamp.occurred_at,
        stamp.occurred_offset_min,
        stamp.occurred_tz,
        stamp.occurred_local_date,
        new Date().toISOString(),
        opId,
      ],
    );
    audit(db, 'reported_clinical_notes', id, 'create');
    return { id };
  });
}
