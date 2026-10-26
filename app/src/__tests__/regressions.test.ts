import { freshDb, babyWithProfile, TZ } from './helpers';
import { createSlot, addPlanItem, snapshotFromSlot } from '../domain/repositories/meals';
import { recordFeeding } from '../domain/repositories/feeding';
import { recordLiquid, recordExposure, recordSuspicion, recordSymptom } from '../domain/repositories/events';
import { recordGrowth } from '../domain/repositories/growth';
import { daySummary, rangeSummary } from '../domain/summary';
import { computeZScore } from '../domain/growthRef';
import { exportBackup, serialiseBackup, inspectBackup, BackupRejected } from '../domain/backup';
import { MIGRATIONS, migrate } from '../db/migrations';
import { createNodeDriver } from '../db/nodeDriver';
import { loadPacks } from '../data/loadPacks';
import { ensureBaby } from '../domain/repositories/babies';

/**
 * Regression tests for defects found by the independent verifier.
 *
 * Each test here failed against the code as it was before the fix. They are
 * kept separate so it stays obvious which behaviours were actually broken in
 * a shipped build rather than merely hypothesised.
 */

const DATE = '2026-03-10';

function setup() {
  const { db, baby: raw } = freshDb();
  const baby = babyWithProfile(db, raw);
  const slot = createSlot(db, baby.id, DATE, '午餐', '12:00');
  return { db, baby, slot };
}

function feedMixed(mode: 'ratio' | 'absolute', ratio: number | null, grams: number | null) {
  const { db, baby, slot } = setup();
  addPlanItem(db, slot.id, { ingredient_id: 'veg_carrot' });
  addPlanItem(db, slot.id, { ingredient_id: 'grain_rice' });
  recordFeeding(db, {
    babyId: baby.id,
    mealSlotId: slot.id,
    mealLabel: '午餐',
    occurredAt: new Date('2026-03-10T04:00:00Z'),
    timezone: TZ,
    snapshot: snapshotFromSlot(db, slot.id),
    intakeMode: mode,
    intakeRatio: ratio,
    intakeAmountG: grams,
  });
  return { db, baby };
}

describe('D-3 / D-4 a whole-portion figure is never per-ingredient evidence', () => {
  it('eating half of a mixed bowl does not prove any single ingredient was eaten', () => {
    const { db, baby } = feedMixed('ratio', 0.5, null);
    const s = daySummary(db, baby.id, DATE);
    expect(s.food.eaten_ingredient_ids).toEqual([]);
    expect(s.food.offered_unknown_ingredient_ids.sort()).toEqual(['grain_rice', 'veg_carrot']);
  });

  it('a stated zero portion marks every ingredient not-eaten, never eaten', () => {
    const { db, baby } = feedMixed('absolute', null, 0);
    const s = daySummary(db, baby.id, DATE);
    expect(s.food.eaten_ingredient_ids).toEqual([]);
    expect(s.food.offered_not_eaten_ingredient_ids.sort()).toEqual(['grain_rice', 'veg_carrot']);
  });

  it('a zero ratio is a known zero, not an unknown', () => {
    const { db, baby } = feedMixed('ratio', 0, null);
    const s = daySummary(db, baby.id, DATE);
    expect(s.food.eaten_ingredient_ids).toEqual([]);
    expect(s.food.offered_unknown_ingredient_ids).toEqual([]);
    expect(s.food.offered_not_eaten_ingredient_ids.sort()).toEqual(['grain_rice', 'veg_carrot']);
  });

  it('a single-ingredient bowl IS unambiguous, so it still counts as eaten', () => {
    const { db, baby, slot } = setup();
    addPlanItem(db, slot.id, { ingredient_id: 'veg_carrot' });
    recordFeeding(db, {
      babyId: baby.id,
      mealSlotId: slot.id,
      mealLabel: '午餐',
      occurredAt: new Date('2026-03-10T04:00:00Z'),
      timezone: TZ,
      snapshot: snapshotFromSlot(db, slot.id),
      intakeMode: 'ratio',
      intakeRatio: 0.5,
    });
    const s = daySummary(db, baby.id, DATE);
    expect(s.food.eaten_ingredient_ids).toEqual(['veg_carrot']);
  });

  it('weekly diversity uses the same rule as the daily summary', () => {
    const { db, baby } = feedMixed('ratio', 0.5, null);
    const week = rangeSummary(db, baby.id, DATE, 7);
    expect(week.distinct_eaten_ingredients).toBe(0);
  });

  it('an explicit per-ingredient figure is still honoured', () => {
    const { db, baby, slot } = setup();
    addPlanItem(db, slot.id, { ingredient_id: 'veg_carrot' });
    addPlanItem(db, slot.id, { ingredient_id: 'grain_rice' });
    recordFeeding(db, {
      babyId: baby.id,
      mealSlotId: slot.id,
      mealLabel: '午餐',
      occurredAt: new Date('2026-03-10T04:00:00Z'),
      timezone: TZ,
      snapshot: snapshotFromSlot(db, slot.id),
      intakeMode: 'ratio',
      intakeRatio: 0.5,
      perIngredientIntake: [{ ingredient_id: 'veg_carrot', free_text: null, intake_amount_g: 20 }],
    });
    const s = daySummary(db, baby.id, DATE);
    expect(s.food.eaten_ingredient_ids).toEqual(['veg_carrot']);
    expect(s.food.offered_unknown_ingredient_ids).toEqual(['grain_rice']);
  });
});

describe('D-5 a repeated tap is one record, even at different instants', () => {
  const kinds = [
    [
      'liquid',
      (db: any, babyId: string, opId: string, t: Date) =>
        recordLiquid(db, { babyId, kind: 'formula', amountMl: 120, occurredAt: t, timezone: TZ, opId }),
      'liquid_events',
    ],
    [
      'exposure',
      (db: any, babyId: string, opId: string, t: Date) =>
        recordExposure(db, {
          babyId,
          ingredientId: null,
          freeText: '香蕉',
          amountG: null,
          occurredAt: t,
          timezone: TZ,
          opId,
        }),
      'exposure_events',
    ],
    [
      'symptom',
      (db: any, babyId: string, opId: string, t: Date) =>
        recordSymptom(db, { babyId, description: '脸颊红点', severity: 'mild', occurredAt: t, timezone: TZ, opId }),
      'symptom_observations',
    ],
    [
      'suspicion',
      (db: any, babyId: string, opId: string, t: Date) =>
        recordSuspicion(db, {
          babyId,
          ingredientId: null,
          freeText: '鸡蛋',
          rationale: '两次都起红点',
          occurredAt: t,
          timezone: TZ,
          opId,
        }),
      'caregiver_suspicions',
    ],
  ] as const;

  it.each(kinds)('%s: two taps milliseconds apart create one row', (_name, record, table) => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    // The real UI mints one op id per submission; the two taps land on
    // different millisecond instants, which is exactly what used to defeat
    // the derived-hash op id.
    const opId = 'op_one_submission';
    record(db, baby.id, opId, new Date('2026-03-10T04:00:00.000Z'));
    record(db, baby.id, opId, new Date('2026-03-10T04:00:00.002Z'));
    const n = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;
    expect(n).toBe(1);
  });

  it('growth measurements dedupe on the submission id too', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    const opId = 'op_growth_submission';
    recordGrowth(db, {
      babyId: baby.id,
      kind: 'weight',
      value: 8.2,
      unit: 'kg',
      occurredAt: new Date('2026-03-10T04:00:00.000Z'),
      timezone: TZ,
      method: null,
      opId,
    });
    recordGrowth(db, {
      babyId: baby.id,
      kind: 'weight',
      value: 8.2,
      unit: 'kg',
      occurredAt: new Date('2026-03-10T04:00:00.003Z'),
      timezone: TZ,
      method: null,
      opId,
    });
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM growth_measurements')!.n).toBe(1);
  });

  it('two genuinely separate submissions are still two records', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    recordLiquid(db, {
      babyId: baby.id,
      kind: 'formula',
      amountMl: 120,
      occurredAt: new Date('2026-03-10T04:00:00Z'),
      timezone: TZ,
      opId: 'op_a',
    });
    recordLiquid(db, {
      babyId: baby.id,
      kind: 'formula',
      amountMl: 120,
      occurredAt: new Date('2026-03-10T07:00:00Z'),
      timezone: TZ,
      opId: 'op_b',
    });
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM liquid_events')!.n).toBe(2);
  });
});

describe('D-12 the WHO reference never extrapolates past its published range', () => {
  it('an age beyond the last published day is refused, not snapped to the last row', () => {
    const { db } = freshDb();
    const max = db.get<{ hi: number }>(
      "SELECT MAX(age_days) AS hi FROM growth_reference WHERE indicator = 'weight_for_age' AND sex = 'female'",
    )!.hi;
    const justInside = computeZScore(db, { indicator: 'weight_for_age', sex: 'female', ageDays: max, value: 12 });
    expect(justInside.ok).toBe(true);

    for (const over of [max + 1, max + 10, max + 16]) {
      const r = computeZScore(db, { indicator: 'weight_for_age', sex: 'female', ageDays: over, value: 12 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('age_out_of_range');
    }
  });

  it('a mismatched measurement method is reported as a mismatch, not as missing', () => {
    const { db } = freshDb();
    const r = computeZScore(db, {
      indicator: 'length_for_age',
      sex: 'female',
      ageDays: 300,
      value: 70,
      method: 'standing',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('measurement_method_mismatch');
      expect(r.message).toContain('口径');
    }
  });

  it('a missing measurement method is still reported as missing', () => {
    const { db } = freshDb();
    const r = computeZScore(db, { indicator: 'length_for_age', sex: 'female', ageDays: 300, value: 70, method: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('measurement_method_unknown');
  });
});

describe('D-14 the backup checksum covers every field of the file', () => {
  it('editing the recorded pack versions invalidates the checksum', () => {
    const { db } = freshDb();
    const file = exportBackup(db, '0.1.0');
    const tampered = JSON.parse(serialiseBackup(file));
    tampered.pack_versions = { ...tampered.pack_versions, ingredients: '999.0.0' };
    expect(() => inspectBackup(JSON.stringify(tampered))).toThrow(BackupRejected);
    try {
      inspectBackup(JSON.stringify(tampered));
    } catch (e) {
      expect((e as BackupRejected).reason).toBe('checksum_mismatch');
    }
  });
});

describe('D-1 / D-2 / D-7 the schema matches what the screens actually query', () => {
  it('inventory is per baby and accepts free text', () => {
    const { db, baby } = setup();
    db.run(
      `INSERT INTO inventory_items (id, baby_id, ingredient_id, free_text, created_at, updated_at, status)
       VALUES (?,?,?,?,?,?, 'active')`,
      ['inv_1', baby.id, 'veg_carrot', null, '2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z'],
    );
    db.run(
      `INSERT INTO inventory_items (id, baby_id, ingredient_id, free_text, created_at, updated_at, status)
       VALUES (?,?,?,?,?,?, 'active')`,
      ['inv_2', baby.id, null, '奶奶带来的南瓜', '2026-03-10T00:00:00Z', '2026-03-10T00:00:00Z'],
    );
    const rows = db.all<{ id: string; free_text: string | null; name_zh: string | null }>(
      `SELECT inv.id, inv.free_text, i.name_zh FROM inventory_items inv
       LEFT JOIN ingredients i ON i.id = inv.ingredient_id
       WHERE inv.baby_id = ? AND inv.status = 'active' ORDER BY inv.id`,
      [baby.id],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].name_zh).toContain('胡萝卜');
    expect(rows[1].free_text).toBe('奶奶带来的南瓜');
  });

  it('the recommend screen inventory query runs against the real schema', () => {
    const { db, baby } = setup();
    expect(() =>
      db.all(
        "SELECT ingredient_id FROM inventory_items WHERE baby_id = ? AND status = 'active' AND ingredient_id IS NOT NULL",
        [baby.id],
      ),
    ).not.toThrow();
  });

  it('the avoid list persists per baby and is de-duplicated', () => {
    const { db, baby } = setup();
    const ins = () =>
      db.run(
        `INSERT INTO avoid_list (id, baby_id, ingredient_id, reason, created_at, status)
         VALUES (?,?,?,?,?, 'active')
         ON CONFLICT (baby_id, ingredient_id) DO UPDATE SET status = 'active'`,
        [`av_${Math.random()}`, baby.id, 'veg_carrot', null, '2026-03-10T00:00:00Z'],
      );
    ins();
    ins();
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM avoid_list')!.n).toBe(1);
  });

  it('the avoid list is included in a backup so a restore keeps the caregiver decision', () => {
    const { db, baby } = setup();
    db.run(
      `INSERT INTO avoid_list (id, baby_id, ingredient_id, reason, created_at, status)
       VALUES (?,?,?,?,?, 'active')`,
      ['av_1', baby.id, 'veg_carrot', '起红点', '2026-03-10T00:00:00Z'],
    );
    const file = exportBackup(db, '0.1.0');
    expect(file.tables.avoid_list).toHaveLength(1);
    expect(file.row_counts.avoid_list).toBe(1);
  });
});

describe('migration safety', () => {
  it('every migration version is unique and strictly increasing', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
  });

  it('upgrading an existing v1 database preserves its inventory rows', () => {
    // Simulates a user who already installed the first build: apply v1 only,
    // insert data, then upgrade.
    const db = createNodeDriver(':memory:');
    db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
    );
    db.exec(MIGRATIONS[0].sql);
    db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?,?,?)', [
      MIGRATIONS[0].version,
      MIGRATIONS[0].name,
      '2026-03-10T00:00:00Z',
    ]);
    loadPacks(db);
    ensureBaby(db);
    db.run(
      "INSERT INTO inventory_items (id, ingredient_id, qty_note, updated_at, status) VALUES (?,?,?,?, 'active')",
      ['inv_old', 'veg_carrot', '半根', '2026-03-10T00:00:00Z'],
    );

    migrate(db);

    const rows = db.all<{ id: string; baby_id: string; ingredient_id: string; qty_note: string }>(
      'SELECT id, baby_id, ingredient_id, qty_note FROM inventory_items',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('inv_old');
    expect(rows[0].qty_note).toBe('半根');
    expect(rows[0].baby_id).toBeTruthy();
  });
});
