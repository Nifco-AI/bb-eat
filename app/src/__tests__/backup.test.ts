import { freshDb, babyWithProfile, TZ } from './helpers';
import { createSlot, addPlanItem, snapshotFromSlot } from '../domain/repositories/meals';
import { recordFeeding, listFeedings } from '../domain/repositories/feeding';
import { recordLiquid } from '../domain/repositories/events';
import { recordGrowth, listGrowth } from '../domain/repositories/growth';
import {
  exportBackup,
  serialiseBackup,
  inspectBackup,
  restoreBackup,
  BackupRejected,
  USER_TABLES,
} from '../domain/backup';
import { sha256Hex } from '../domain/sha256';
import { recommend } from '../domain/recommend';
import { SqlDriver } from '../db/driver';

function seed(db: SqlDriver, babyId: string) {
  const slot = createSlot(db, babyId, '2026-03-10', '午餐');
  addPlanItem(db, slot.id, { ingredient_id: 'veg_pumpkin', amount_g: 50 });
  recordFeeding(db, {
    babyId,
    mealSlotId: slot.id,
    mealLabel: '午餐',
    occurredAt: new Date('2026-03-10T04:00:00Z'),
    timezone: TZ,
    snapshot: snapshotFromSlot(db, slot.id),
    intakeMode: 'ratio',
    intakeRatio: 0.75,
  });
  recordLiquid(db, {
    babyId,
    kind: 'formula',
    amountMl: 150,
    occurredAt: new Date('2026-03-10T01:00:00Z'),
    timezone: TZ,
  });
  recordLiquid(db, {
    babyId,
    kind: 'breastmilk',
    amountMl: null,
    occurredAt: new Date('2026-03-10T06:00:00Z'),
    timezone: TZ,
  });
  recordGrowth(db, {
    babyId,
    kind: 'weight',
    value: 8.4,
    unit: 'kg',
    occurredAt: new Date('2026-03-10T02:00:00Z'),
    timezone: TZ,
  });
}

describe('sha256', () => {
  it('matches published vectors, including multi-byte input', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('宝宝辅食')).toBe(
      require('crypto').createHash('sha256').update('宝宝辅食', 'utf8').digest('hex'),
    );
  });
});

describe('U12 backup and restore', () => {
  it('round-trips every caregiver record into a new empty database', () => {
    const a = freshDb();
    const baby = babyWithProfile(a.db, a.baby);
    seed(a.db, baby.id);
    const text = serialiseBackup(exportBackup(a.db, '1.0.0'));

    const b = freshDb();
    const report = restoreBackup(b.db, text);
    expect(report.total_rows).toBeGreaterThan(0);

    expect(listFeedings(b.db, baby.id, '2026-03-10')).toHaveLength(1);
    expect(listGrowth(b.db, baby.id, 'weight')[0].value).toBe(8.4);
    const restoredBaby = b.db.get<{ birth_date: string }>('SELECT birth_date FROM babies WHERE id = ?', [baby.id])!;
    expect(restoredBaby.birth_date).toBe('2025-06-15');

    for (const table of USER_TABLES) {
      const na = a.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;
      const nb = b.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;
      expect([table, nb]).toEqual([table, na]);
    }
  });

  it('shows what will be restored before anything is written', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    seed(db, baby.id);
    const { summary } = inspectBackup(serialiseBackup(exportBackup(db, '1.0.0')));
    expect(summary.babies[0].birth_date).toBe('2025-06-15');
    expect(summary.earliest_record).toBe('2026-03-10');
    expect(summary.total_rows).toBeGreaterThan(4);
  });

  it('excludes bundled knowledge packs so a backup cannot tamper with reference data', () => {
    const { db, baby } = freshDb();
    const file = exportBackup(db, '1.0.0');
    expect(Object.keys(file.tables)).not.toContain('growth_reference');
    expect(Object.keys(file.tables)).not.toContain('ingredients');
    expect(Object.keys(file.tables)).not.toContain('sources');
    expect(baby.id).toBeTruthy();
  });

  it('rejects a corrupted file and leaves existing data completely intact', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    seed(db, baby.id);
    const before = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM feeding_events')!.n;

    const good = exportBackup(db, '1.0.0');
    const tampered = JSON.parse(serialiseBackup(good));
    tampered.tables.growth_measurements[0].value = 99;

    expect(() => restoreBackup(db, JSON.stringify(tampered))).toThrow(BackupRejected);
    try {
      restoreBackup(db, JSON.stringify(tampered));
    } catch (e) {
      expect((e as BackupRejected).reason).toBe('checksum_mismatch');
      expect((e as BackupRejected).message).toContain('原有数据未改动');
    }
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM feeding_events')!.n).toBe(before);
    expect(listGrowth(db, baby.id, 'weight')[0].value).toBe(8.4);
  });

  it('names the specific problem for each kind of bad file', () => {
    const { db } = freshDb();
    const good = exportBackup(db, '1.0.0');
    const cases: [string, string][] = [
      ['{ not json', 'not_json'],
      [JSON.stringify({ hello: 'world' }), 'not_a_bbeat_backup'],
      [JSON.stringify({ ...good, format_version: 99 }), 'format_version_unsupported'],
      [JSON.stringify({ ...good, schema_version: 99 }), 'schema_version_newer'],
      [JSON.stringify({ ...good, checksum: undefined }), 'checksum_missing'],
      [JSON.stringify({ ...good, tables: { ...good.tables, not_a_table: [] } }), 'unknown_table'],
      [
        JSON.stringify({ ...good, row_counts: { ...good.row_counts, babies: 77 } }),
        'row_count_mismatch',
      ],
    ];
    for (const [text, reason] of cases) {
      try {
        inspectBackup(text);
        throw new Error(`expected rejection for ${reason}`);
      } catch (e) {
        expect((e as BackupRejected).reason).toBe(reason);
      }
    }
  });

  it('rejects an empty file without destroying anything', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    seed(db, baby.id);
    expect(() => restoreBackup(db, '')).toThrow(BackupRejected);
    expect(listFeedings(db, baby.id, '2026-03-10')).toHaveLength(1);
  });
});

describe('restart persistence', () => {
  it('data written before a close is still present after reopening the same file', () => {
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const { createNodeDriver } = require('../db/nodeDriver');
    const { migrate } = require('../db/migrations');
    const { loadPacks } = require('../data/loadPacks');
    const { ensureBaby } = require('../domain/repositories/babies');

    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bbeat-')), 'bbeat.db');
    let db: SqlDriver = createNodeDriver(file);
    migrate(db);
    loadPacks(db);
    const baby = babyWithProfile(db, ensureBaby(db));
    seed(db, baby.id);
    db.close();

    db = createNodeDriver(file);
    migrate(db);
    loadPacks(db);
    expect(listFeedings(db, baby.id, '2026-03-10')).toHaveLength(1);
    expect(listGrowth(db, baby.id, 'weight')).toHaveLength(1);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ingredients')!.n).toBe(52);
    db.close();
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
});

describe('U10 recommendations fail closed', () => {
  it('produces nothing in real mode because no bundled recipe has passed expert review', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    const out = recommend(db, {
      babyId: baby.id,
      ageMonths: 8,
      region: 'CN',
      slotLabels: ['早餐', '午餐', '晚餐'],
      avoidIngredientIds: [],
      inventoryIngredientIds: [],
      maxPrepMinutes: null,
      recentIngredientIds: [],
      demoMode: false,
    });
    expect(out.available).toBe(false);
    expect(out.candidates).toHaveLength(0);
    expect(out.blocked.map((b) => b.reason)).toContain('no_expert_reviewed_recipes');
    expect(out.blocked[0].message).toContain('手动');
    expect(out.diagnostics.recipes_expert_reviewed).toBe(0);
    expect(out.diagnostics.recipes_total).toBeGreaterThan(0);
  });

  it('still refuses when the age is unknown, rather than guessing', () => {
    const { db, baby } = freshDb();
    const out = recommend(db, {
      babyId: baby.id,
      ageMonths: null,
      region: 'CN',
      slotLabels: ['午餐'],
      avoidIngredientIds: [],
      inventoryIngredientIds: [],
      maxPrepMinutes: null,
      recentIngredientIds: [],
      demoMode: false,
    });
    expect(out.available).toBe(false);
    expect(out.blocked.map((b) => b.reason)).toContain('birth_date_unknown');
  });

  it('refuses when no meal slots exist instead of inventing a schedule', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    const out = recommend(db, {
      babyId: baby.id,
      ageMonths: 8,
      region: 'CN',
      slotLabels: [],
      avoidIngredientIds: [],
      inventoryIngredientIds: [],
      maxPrepMinutes: null,
      recentIngredientIds: [],
      demoMode: true,
    });
    expect(out.available).toBe(false);
    expect(out.blocked.map((b) => b.reason)).toContain('no_meal_slots');
  });

  it('demo mode returns at most three clearly-labelled synthetic plans with reasons', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    const out = recommend(db, {
      babyId: baby.id,
      ageMonths: 8,
      region: 'CN',
      slotLabels: ['早餐', '午餐', '晚餐'],
      avoidIngredientIds: [],
      inventoryIngredientIds: [],
      maxPrepMinutes: null,
      recentIngredientIds: [],
      demoMode: true,
    });
    expect(out.is_synthetic).toBe(true);
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.candidates.length).toBeLessThanOrEqual(3);
    for (const c of out.candidates) {
      expect(c.is_synthetic).toBe(true);
      expect(c.explanation.length).toBeGreaterThan(0);
      expect(c.knowledge_versions.length).toBeGreaterThan(0);
      for (const s of c.slots) expect(s.recipe.is_synthetic).toBe(1);
    }
    const ids = out.candidates.map((c) => c.slots.map((s) => s.recipe.id).join('|'));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never recommends an ingredient the caregiver asked to avoid', () => {
    const { db, baby: raw } = freshDb();
    const baby = babyWithProfile(db, raw);
    const base = {
      babyId: baby.id,
      ageMonths: 8,
      region: 'CN' as const,
      slotLabels: ['早餐', '午餐', '晚餐'],
      inventoryIngredientIds: [],
      maxPrepMinutes: null,
      recentIngredientIds: [],
      demoMode: true,
    };
    const all = recommend(db, { ...base, avoidIngredientIds: [] });
    const used = all.candidates[0].slots.flatMap((s) =>
      db
        .all<{ ingredient_id: string }>('SELECT ingredient_id FROM recipe_ingredients WHERE recipe_id = ?', [
          s.recipe.id,
        ])
        .map((r) => r.ingredient_id),
    );
    expect(used.length).toBeGreaterThan(0);

    const avoided = recommend(db, { ...base, avoidIngredientIds: used });
    for (const c of avoided.candidates) {
      for (const s of c.slots) {
        const ings = db
          .all<{ ingredient_id: string }>('SELECT ingredient_id FROM recipe_ingredients WHERE recipe_id = ?', [
            s.recipe.id,
          ])
          .map((r) => r.ingredient_id);
        for (const i of ings) expect(used).not.toContain(i);
      }
    }
  });
});
