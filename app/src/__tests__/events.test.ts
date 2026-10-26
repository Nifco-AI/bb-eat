import { freshDb, babyWithProfile, TZ } from './helpers';
import { createSlot, addPlanItem, snapshotFromSlot } from '../domain/repositories/meals';
import { recordFeeding } from '../domain/repositories/feeding';
import {
  recordLiquid,
  recordExposure,
  recordSymptom,
  recordSuspicion,
  QUICK_ML_PRESETS,
  FactValidationError,
} from '../domain/repositories/events';
import { daySummary, rangeSummary, estimateEnergy } from '../domain/summary';
import { stampFor, instantFromLocal, ageInMonths, ageInDays, shiftLocalDate } from '../domain/time';

describe('U06 unknown amounts are never counted as zero', () => {
  it('reports a known floor and flags that the true total is higher', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    const t = (h: number) => new Date(`2026-03-10T0${h}:00:00Z`);
    recordLiquid(db, { babyId: baby.id, kind: 'formula', amountMl: 120, occurredAt: t(1), timezone: TZ });
    recordLiquid(db, { babyId: baby.id, kind: 'formula', amountMl: null, occurredAt: t(5), timezone: TZ });
    recordLiquid(db, { babyId: baby.id, kind: 'breastmilk', amountMl: null, occurredAt: t(7), timezone: TZ });

    const s = daySummary(db, baby.id, '2026-03-10');
    const formula = s.liquids.find((l) => l.kind === 'formula')!;
    expect(formula.events).toBe(2);
    expect(formula.known_total_ml).toBe(120);
    expect(formula.unknown_events).toBe(1);
    expect(formula.has_unknown).toBe(true);

    const breast = s.liquids.find((l) => l.kind === 'breastmilk')!;
    expect(breast.events).toBe(1);
    expect(breast.known_total_ml).toBe(0);
    expect(breast.has_unknown).toBe(true);

    // A day with no record at all must be distinguishable from a zero day.
    const empty = daySummary(db, baby.id, '2026-03-09');
    expect(empty.liquids.find((l) => l.kind === 'formula')!.events).toBe(0);
    expect(empty.liquids.find((l) => l.kind === 'formula')!.has_unknown).toBe(false);
  });

  it('accepts an explicit zero as a real value distinct from unknown', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    const zero = recordLiquid(db, {
      babyId: baby.id,
      kind: 'water',
      amountMl: 0,
      occurredAt: new Date('2026-03-10T02:00:00Z'),
      timezone: TZ,
    });
    expect(zero.amount_ml).toBe(0);
    const unknown = recordLiquid(db, {
      babyId: baby.id,
      kind: 'water',
      amountMl: null,
      occurredAt: new Date('2026-03-10T03:00:00Z'),
      timezone: TZ,
    });
    expect(unknown.amount_ml).toBeNull();
    const w = daySummary(db, baby.id, '2026-03-10').liquids.find((l) => l.kind === 'water')!;
    expect(w.known_events).toBe(1);
    expect(w.unknown_events).toBe(1);
  });

  it('never offers a quick preset as a recommended amount and rejects absurd input', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    expect(QUICK_ML_PRESETS.formula.length).toBeGreaterThan(0);
    expect(() =>
      recordLiquid(db, {
        babyId: baby.id,
        kind: 'formula',
        amountMl: 5000,
        occurredAt: new Date('2026-03-10T02:00:00Z'),
        timezone: TZ,
      }),
    ).toThrow(FactValidationError);
  });

  it('refuses to estimate energy and says exactly what is missing', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    const e = estimateEnergy(db, baby.id, '2026-03-10');
    expect(e.ok).toBe(false);
    expect(e.missing.length).toBeGreaterThan(0);
    expect(e.missing.join()).toContain('再分发');
  });
});

describe('U07 exposure, symptom and suspicion stay separate', () => {
  it('records four kinds of fact in four tables with no automatic linkage', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    const when = new Date('2026-03-10T02:00:00Z');
    recordExposure(db, {
      babyId: baby.id,
      ingredientId: 'protein_egg_yolk',
      freeText: null,
      amountG: 2,
      occurredAt: when,
      timezone: TZ,
    });
    recordSymptom(db, { babyId: baby.id, description: '面部出现红点', occurredAt: when, timezone: TZ });
    recordSuspicion(db, {
      babyId: baby.id,
      ingredientId: 'protein_egg_yolk',
      freeText: null,
      rationale: '吃完后出现红点',
      occurredAt: when,
      timezone: TZ,
    });

    const s = daySummary(db, baby.id, '2026-03-10');
    expect(s.exposures).toHaveLength(1);
    expect(s.symptom_count).toBe(1);
    // The suspicion must not have been promoted into a symptom or an allergy.
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM symptom_observations')!.n).toBe(1);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM caregiver_suspicions')!.n).toBe(1);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM reported_clinical_notes')!.n).toBe(0);
  });

  it('requires a named food for an exposure and a reason for a suspicion', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    const when = new Date('2026-03-10T02:00:00Z');
    expect(() =>
      recordExposure(db, { babyId: baby.id, ingredientId: null, freeText: '  ', amountG: null, occurredAt: when, timezone: TZ }),
    ).toThrow(FactValidationError);
    expect(() =>
      recordSuspicion(db, {
        babyId: baby.id,
        ingredientId: 'fruit_apple',
        freeText: null,
        rationale: '',
        occurredAt: when,
        timezone: TZ,
      }),
    ).toThrow(FactValidationError);
  });
});

describe('U11 timezone and day boundaries', () => {
  it('derives the local date at write time from the baby timezone, not UTC', () => {
    const late = new Date('2026-03-10T16:30:00Z'); // 00:30 next day in Shanghai
    const sh = stampFor(late, 'Asia/Shanghai');
    expect(sh.occurred_local_date).toBe('2026-03-11');
    expect(sh.occurred_offset_min).toBe(480);

    const sg = stampFor(late, 'Asia/Singapore');
    expect(sg.occurred_local_date).toBe('2026-03-11');

    const utc = stampFor(late, 'UTC');
    expect(utc.occurred_local_date).toBe('2026-03-10');
  });

  it('keeps a late-night record on the day the caregiver experienced it', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    recordLiquid(db, {
      babyId: baby.id,
      kind: 'formula',
      amountMl: 100,
      occurredAt: new Date('2026-03-10T15:10:00Z'), // 23:10 Shanghai
      timezone: TZ,
    });
    expect(daySummary(db, baby.id, '2026-03-10').liquids.find((l) => l.kind === 'formula')!.events).toBe(1);
    expect(daySummary(db, baby.id, '2026-03-11').liquids.find((l) => l.kind === 'formula')!.events).toBe(0);
  });

  it('survives a later timezone change: stored local dates do not move', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    recordLiquid(db, {
      babyId: baby.id,
      kind: 'water',
      amountMl: 30,
      occurredAt: new Date('2026-03-10T16:30:00Z'),
      timezone: 'Asia/Shanghai',
    });
    const before = db.get<{ d: string }>('SELECT occurred_local_date AS d FROM liquid_events')!.d;
    babyWithProfile(db, raw, { timezone: 'Europe/London' });
    const after = db.get<{ d: string }>('SELECT occurred_local_date AS d FROM liquid_events')!.d;
    expect(after).toBe(before);
    expect(after).toBe('2026-03-11');
  });

  it('round-trips a local wall-clock time through a DST transition', () => {
    // London jumps forward at 01:00 UTC on 2026-03-29.
    const before = instantFromLocal('2026-03-28', '13:00', 'Europe/London');
    const after = instantFromLocal('2026-03-30', '13:00', 'Europe/London');
    expect(stampFor(before, 'Europe/London').occurred_local_date).toBe('2026-03-28');
    expect(stampFor(after, 'Europe/London').occurred_local_date).toBe('2026-03-30');
    expect(before.toISOString()).toBe('2026-03-28T13:00:00.000Z');
    expect(after.toISOString()).toBe('2026-03-30T12:00:00.000Z');
  });

  it('computes age in whole months and days without drifting', () => {
    expect(ageInMonths('2025-06-15', '2026-03-10')).toBe(8);
    expect(ageInMonths('2025-06-15', '2025-06-15')).toBe(0);
    expect(ageInMonths(null, '2026-03-10')).toBeNull();
    expect(ageInDays('2025-06-15', '2025-06-25')).toBe(10);
    expect(shiftLocalDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftLocalDate('2024-03-01', -1)).toBe('2024-02-29');
  });
});

describe('weekly summary', () => {
  it('counts only days that actually have records and never fills gaps', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    for (const d of ['2026-03-08', '2026-03-10']) {
      const slot = createSlot(db, baby.id, d, '午餐');
      addPlanItem(db, slot.id, { ingredient_id: 'veg_carrot' });
      recordFeeding(db, {
        babyId: baby.id,
        mealSlotId: slot.id,
        mealLabel: '午餐',
        occurredAt: new Date(`${d}T04:00:00Z`),
        timezone: TZ,
        snapshot: snapshotFromSlot(db, slot.id),
        intakeMode: 'ratio',
        intakeRatio: 1,
      });
    }
    const r = rangeSummary(db, baby.id, '2026-03-10', 7);
    expect(r.from).toBe('2026-03-04');
    expect(r.days).toBe(7);
    expect(r.days_with_any_record).toBe(2);
    expect(r.feeding_events).toBe(2);
    expect(r.distinct_eaten_ingredients).toBe(1);
    expect(r.coverage_notes.length).toBeGreaterThan(0);
  });
});
