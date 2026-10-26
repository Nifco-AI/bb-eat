import { SqlDriver } from '../../db/driver';
import { newId, opIdFor } from '../ids';
import { stampFor } from '../time';
import { FeedingEvent, IntakeMode, ServedSnapshot } from '../types';
import { audit, findByOpId } from './facts';

export interface RecordFeedingInput {
  babyId: string;
  mealSlotId: string | null;
  mealLabel: string | null;
  occurredAt: Date;
  timezone: string;
  snapshot: ServedSnapshot;
  intakeMode: IntakeMode;
  /** 0..1, only when intakeMode === 'ratio' */
  intakeRatio?: number | null;
  /** grams of the whole portion, only when intakeMode === 'absolute' */
  intakeAmountG?: number | null;
  /** Per-ingredient intake the caregiver explicitly stated. Never inferred. */
  perIngredientIntake?: { ingredient_id: string | null; free_text: string | null; intake_amount_g: number }[];
  note?: string | null;
  /** Supplied by the UI so a double-tap cannot create two events. */
  opId?: string;
}

export class FeedingValidationError extends Error {}

function validate(input: RecordFeedingInput): void {
  if (input.snapshot.items.length === 0) {
    throw new FeedingValidationError('至少需要一项实际提供的食物');
  }
  if (input.intakeMode === 'ratio') {
    const r = input.intakeRatio;
    if (r === null || r === undefined || !Number.isFinite(r) || r < 0 || r > 1) {
      throw new FeedingValidationError('吃下比例需在 0% 到 100% 之间');
    }
  }
  if (input.intakeMode === 'absolute') {
    const a = input.intakeAmountG;
    if (a === null || a === undefined || !Number.isFinite(a) || a < 0) {
      throw new FeedingValidationError('吃下克数需为 0 或正数');
    }
  }
  if (input.occurredAt.getTime() > Date.now() + 5 * 60000) {
    throw new FeedingValidationError('发生时间不能晚于现在');
  }
}

/**
 * Records one real feeding.
 *
 * Deliberately *not* done here: splitting a whole-portion ratio or gram total
 * across the individual ingredients. A mixed 80 g bowl eaten "50%" tells us
 * nothing defensible about how much carrot the baby swallowed, so per-ingredient
 * intake stays unknown unless the caregiver states it.
 */
export function recordFeeding(db: SqlDriver, input: RecordFeedingInput): FeedingEvent {
  validate(input);
  const stamp = stampFor(input.occurredAt, input.timezone);
  const opId =
    input.opId ??
    opIdFor([
      'feeding',
      input.babyId,
      input.mealSlotId,
      stamp.occurred_at,
      input.intakeMode,
      input.intakeRatio,
      input.intakeAmountG,
      input.snapshot.items.map((i) => `${i.ingredient_id ?? i.free_text ?? ''}:${i.amount_g ?? 'u'}`).join(','),
    ]);

  return db.transaction(() => {
    const dup = findByOpId(db, 'feeding_events', opId);
    if (dup) return db.get<FeedingEvent>('SELECT * FROM feeding_events WHERE id = ?', [dup])!;

    const id = newId('feed');
    db.run(
      `INSERT INTO feeding_events
        (id, baby_id, meal_slot_id, meal_label, occurred_at, occurred_offset_min, occurred_tz,
         occurred_local_date, recorded_at, served_snapshot_json, intake_mode, intake_ratio,
         intake_amount_g, note, revision, status, supersedes_id, client_op_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,'active',NULL,?)`,
      [
        id,
        input.babyId,
        input.mealSlotId,
        input.mealLabel,
        stamp.occurred_at,
        stamp.occurred_offset_min,
        stamp.occurred_tz,
        stamp.occurred_local_date,
        new Date().toISOString(),
        JSON.stringify(input.snapshot),
        input.intakeMode,
        input.intakeMode === 'ratio' ? (input.intakeRatio ?? null) : null,
        input.intakeMode === 'absolute' ? (input.intakeAmountG ?? null) : null,
        input.note ?? null,
        opId,
      ],
    );

    const stated = new Map<string, number>();
    for (const p of input.perIngredientIntake ?? []) {
      stated.set(p.ingredient_id ?? `free:${p.free_text ?? ''}`, p.intake_amount_g);
    }

    for (const item of input.snapshot.items) {
      const key = item.ingredient_id ?? `free:${item.free_text ?? ''}`;
      const explicit = stated.get(key);
      db.run(
        `INSERT INTO feeding_event_ingredients
          (id, feeding_event_id, ingredient_id, free_text, served_amount_g, served_unknown, intake_amount_g, intake_known)
         VALUES (?,?,?,?,?,?,?,?)`,
        [
          newId('fei'),
          id,
          item.ingredient_id,
          item.free_text,
          item.amount_unknown ? null : item.amount_g,
          item.amount_unknown ? 1 : 0,
          explicit ?? null,
          explicit === undefined ? 0 : 1,
        ],
      );
    }

    audit(db, 'feeding_events', id, 'create', { opId, mode: input.intakeMode });
    return db.get<FeedingEvent>('SELECT * FROM feeding_events WHERE id = ?', [id])!;
  });
}

export interface FeedingDetail extends FeedingEvent {
  snapshot: ServedSnapshot;
  ingredients: {
    id: string;
    ingredient_id: string | null;
    free_text: string | null;
    name: string | null;
    served_amount_g: number | null;
    served_unknown: number;
    intake_amount_g: number | null;
    intake_known: number;
  }[];
}

export function getFeeding(db: SqlDriver, id: string): FeedingDetail | undefined {
  const e = db.get<FeedingEvent>('SELECT * FROM feeding_events WHERE id = ?', [id]);
  if (!e) return undefined;
  const ingredients = db.all<FeedingDetail['ingredients'][number]>(
    `SELECT fei.id, fei.ingredient_id, fei.free_text, i.name_zh AS name,
            fei.served_amount_g, fei.served_unknown, fei.intake_amount_g, fei.intake_known
     FROM feeding_event_ingredients fei
     LEFT JOIN ingredients i ON i.id = fei.ingredient_id
     WHERE fei.feeding_event_id = ?`,
    [id],
  );
  return { ...e, snapshot: JSON.parse(e.served_snapshot_json) as ServedSnapshot, ingredients };
}

export function listFeedings(db: SqlDriver, babyId: string, localDate: string): FeedingDetail[] {
  const rows = db.all<{ id: string }>(
    "SELECT id FROM feeding_events WHERE baby_id = ? AND occurred_local_date = ? AND status = 'active' ORDER BY occurred_at",
    [babyId, localDate],
  );
  return rows.map((r) => getFeeding(db, r.id)!).filter(Boolean);
}

/**
 * Revising intake creates a new active event carrying the *original* served
 * snapshot, so a correction never silently changes what was offered.
 */
export function reviseIntake(
  db: SqlDriver,
  id: string,
  next: { intakeMode: IntakeMode; intakeRatio?: number | null; intakeAmountG?: number | null; note?: string | null },
): FeedingEvent | null {
  return db.transaction(() => {
    const current = db.get<FeedingEvent>('SELECT * FROM feeding_events WHERE id = ?', [id]);
    if (!current || current.status !== 'active') return null;
    if (next.intakeMode === 'ratio') {
      const r = next.intakeRatio;
      if (r === null || r === undefined || r < 0 || r > 1) throw new FeedingValidationError('吃下比例无效');
    }
    if (next.intakeMode === 'absolute') {
      const a = next.intakeAmountG;
      if (a === null || a === undefined || a < 0) throw new FeedingValidationError('吃下克数无效');
    }

    const newRowId = newId('feed');
    db.run(
      `INSERT INTO feeding_events
        (id, baby_id, meal_slot_id, meal_label, occurred_at, occurred_offset_min, occurred_tz,
         occurred_local_date, recorded_at, served_snapshot_json, intake_mode, intake_ratio,
         intake_amount_g, note, revision, status, supersedes_id, client_op_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`,
      [
        newRowId,
        current.baby_id,
        current.meal_slot_id,
        current.meal_label,
        current.occurred_at,
        current.occurred_offset_min,
        current.occurred_tz,
        current.occurred_local_date,
        new Date().toISOString(),
        current.served_snapshot_json,
        next.intakeMode,
        next.intakeMode === 'ratio' ? (next.intakeRatio ?? null) : null,
        next.intakeMode === 'absolute' ? (next.intakeAmountG ?? null) : null,
        next.note === undefined ? current.note : next.note,
        current.revision + 1,
        id,
        `${current.client_op_id}#r${current.revision + 1}`,
      ],
    );
    db.run(
      `INSERT INTO feeding_event_ingredients
        (id, feeding_event_id, ingredient_id, free_text, served_amount_g, served_unknown, intake_amount_g, intake_known)
       SELECT ?||fei.id, ?, fei.ingredient_id, fei.free_text, fei.served_amount_g, fei.served_unknown,
              fei.intake_amount_g, fei.intake_known
       FROM feeding_event_ingredients fei WHERE fei.feeding_event_id = ?`,
      [`r${current.revision + 1}_`, newRowId, id],
    );
    db.run("UPDATE feeding_events SET status = 'superseded' WHERE id = ?", [id]);
    audit(db, 'feeding_events', newRowId, 'revise', { from: id });
    return db.get<FeedingEvent>('SELECT * FROM feeding_events WHERE id = ?', [newRowId])!;
  });
}

export function describeIntake(e: FeedingEvent): string {
  switch (e.intake_mode) {
    case 'ratio':
      return `吃下约 ${Math.round((e.intake_ratio ?? 0) * 100)}%`;
    case 'absolute':
      return `吃下 ${e.intake_amount_g} g`;
    case 'none':
      return '确认未吃（0）';
    default:
      return '吃下量不详';
  }
}
