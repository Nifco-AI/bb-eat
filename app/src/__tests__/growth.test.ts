import { freshDb, babyWithProfile, TZ } from './helpers';
import { WHO_SD_FIXTURES } from '../data/loadPacks';
import { lmsZScore, valueAtZ, normalCdf, computeZScore, referenceBand } from '../domain/growthRef';
import { recordGrowth, listGrowth, normalisedValue } from '../domain/repositories/growth';
import { FactValidationError } from '../domain/repositories/events';

describe('WHO LMS maths', () => {
  it('reproduces every WHO-published SD column from the bundled L/M/S values', () => {
    let worst = 0;
    let checked = 0;
    const columns: [number, 'sd0' | 'sd2neg' | 'sd2' | 'sd3neg' | 'sd3'][] = [
      [0, 'sd0'],
      [-2, 'sd2neg'],
      [2, 'sd2'],
      [-3, 'sd3neg'],
      [3, 'sd3'],
    ];
    for (const f of WHO_SD_FIXTURES) {
      for (const [z, key] of columns) {
        const expected = f[key];
        if (expected === undefined || expected === null) continue;
        worst = Math.max(worst, Math.abs(valueAtZ(z, f.l, f.m, f.s) - expected));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(200);
    // WHO prints these columns rounded; agreement to <1e-3 means our inverse
    // LMS implementation matches theirs rather than merely looking plausible.
    expect(worst).toBeLessThan(0.001);
  });

  it('round-trips value -> z -> value for the normal-modelled indicator', () => {
    const f = WHO_SD_FIXTURES.find((x) => x.indicator === 'length_for_age')!;
    for (const z of [-2.5, -1, 0, 1.3, 2.7]) {
      const v = valueAtZ(z, f.l, f.m, f.s);
      expect(lmsZScore(v, f.l, f.m, f.s, false)).toBeCloseTo(z, 9);
    }
  });

  it('applies the flat tail adjustment beyond 3 SD only for weight', () => {
    const f = WHO_SD_FIXTURES.find((x) => x.indicator === 'weight_for_age')!;
    const heavy = valueAtZ(3, f.l, f.m, f.s) * 1.6;
    const adjusted = lmsZScore(heavy, f.l, f.m, f.s, true);
    const unadjusted = lmsZScore(heavy, f.l, f.m, f.s, false);
    expect(adjusted).toBeGreaterThan(3);
    expect(adjusted).not.toBeCloseTo(unadjusted, 3);
    // Inside +/-3 SD the two must agree exactly: the adjustment is tail-only.
    const mid = valueAtZ(1.5, f.l, f.m, f.s);
    expect(lmsZScore(mid, f.l, f.m, f.s, true)).toBeCloseTo(lmsZScore(mid, f.l, f.m, f.s, false), 12);
  });

  it('computes the standard normal CDF accurately at known points', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(-1.959964)).toBeCloseTo(0.025, 5);
    expect(normalCdf(1.281552)).toBeCloseTo(0.9, 5);
  });
});

describe('growth gating: unknown is never treated as permission', () => {
  it('refuses a percentile when sex is unknown', () => {
    const { db } = freshDb();
    const r = computeZScore(db, { indicator: 'weight_for_age', sex: 'unknown', ageDays: 200, value: 7.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('sex_unknown');
  });

  it('refuses a percentile when the birth date is unknown', () => {
    const { db } = freshDb();
    const r = computeZScore(db, { indicator: 'weight_for_age', sex: 'female', ageDays: null, value: 7.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('birth_date_unknown');
  });

  it('refuses a length percentile when the measurement method is not recorded', () => {
    const { db } = freshDb();
    const r = computeZScore(db, { indicator: 'length_for_age', sex: 'female', ageDays: 300, value: 65 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('measurement_method_unknown');
  });

  it('refuses when the recorded method contradicts the WHO convention for that age', () => {
    const { db } = freshDb();
    const tooOldForLying = computeZScore(db, {
      indicator: 'length_for_age',
      sex: 'female',
      ageDays: 900,
      value: 86,
      method: 'lying',
    });
    expect(tooOldForLying.ok).toBe(false);
    const correct = computeZScore(db, {
      indicator: 'length_for_age',
      sex: 'female',
      ageDays: 900,
      value: 86,
      method: 'standing',
    });
    expect(correct.ok).toBe(true);
  });

  it('refuses beyond the bundled age range instead of extrapolating', () => {
    const { db } = freshDb();
    const r = computeZScore(db, { indicator: 'weight_for_age', sex: 'male', ageDays: 2000, value: 14 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('age_out_of_range');
  });

  it('produces a percentile once every precondition is actually satisfied', () => {
    const { db } = freshDb();
    const r = computeZScore(db, { indicator: 'weight_for_age', sex: 'female', ageDays: 365, value: 8.9 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Math.abs(r.z)).toBeLessThan(1);
      expect(r.percentile).toBeGreaterThan(20);
      expect(r.percentile).toBeLessThan(80);
      expect(r.pack_version).toBeTruthy();
    }
  });

  it('withholds the reference band when sex is unknown', () => {
    const { db } = freshDb();
    expect(referenceBand(db, 'weight_for_age', 'unknown', 0, 400)).toBeNull();
    expect(referenceBand(db, 'weight_for_age', 'male', 0, 400)!.length).toBe(401);
  });
});

describe('growth measurements', () => {
  it('stores the entered unit and normalises for comparison without losing the original', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    const m = recordGrowth(db, {
      babyId: baby.id,
      kind: 'weight',
      value: 8500,
      unit: 'g',
      occurredAt: new Date('2026-03-10T02:00:00Z'),
      timezone: TZ,
    });
    expect(m.value).toBe(8500);
    expect(m.unit).toBe('g');
    expect(normalisedValue(m)).toBeCloseTo(8.5, 6);
  });

  it('rejects physiologically impossible entries rather than charting them', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    const bad = (value: number, unit: string, kind: 'weight' | 'length' = 'weight') =>
      recordGrowth(db, {
        babyId: baby.id,
        kind,
        value,
        unit: unit as any,
        occurredAt: new Date('2026-03-10T02:00:00Z'),
        timezone: TZ,
      });
    expect(() => bad(850, 'kg')).toThrow(FactValidationError);
    expect(() => bad(0, 'kg')).toThrow(FactValidationError);
    expect(() => bad(500, 'cm', 'length')).toThrow(FactValidationError);
  });

  it('returns measurements in chronological order for charting', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    for (const day of ['2026-03-01', '2026-01-05', '2026-02-10']) {
      recordGrowth(db, {
        babyId: baby.id,
        kind: 'weight',
        value: 8 + Math.random(),
        unit: 'kg',
        occurredAt: new Date(`${day}T02:00:00Z`),
        timezone: TZ,
      });
    }
    const dates = listGrowth(db, baby.id, 'weight').map((m) => m.occurred_local_date);
    expect(dates).toEqual([...dates].sort());
  });
});
