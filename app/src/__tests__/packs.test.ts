import { createNodeDriver } from '../db/nodeDriver';
import { migrate, SCHEMA_VERSION } from '../db/migrations';
import { loadPacks, WHO_SD_FIXTURES } from '../data/loadPacks';
import { freshDb } from './helpers';

describe('migrations', () => {
  it('applies from scratch and is idempotent on a second open', () => {
    const db = createNodeDriver(':memory:');
    const first = migrate(db);
    expect(first.applied).toEqual([1]);
    expect(first.to).toBe(SCHEMA_VERSION);

    const second = migrate(db);
    expect(second.applied).toEqual([]);
    expect(second.from).toBe(SCHEMA_VERSION);
  });

  it('creates every fact table with the audit columns the domain relies on', () => {
    const { db } = freshDb();
    for (const table of [
      'feeding_events',
      'liquid_events',
      'exposure_events',
      'symptom_observations',
      'caregiver_suspicions',
      'reported_clinical_notes',
      'growth_measurements',
    ]) {
      const cols = db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);
      expect(cols).toEqual(
        expect.arrayContaining([
          'occurred_at',
          'occurred_offset_min',
          'occurred_tz',
          'occurred_local_date',
          'recorded_at',
          'revision',
          'status',
          'supersedes_id',
          'client_op_id',
        ]),
      );
    }
  });
});

describe('knowledge packs', () => {
  it('loads sources, ingredients, recipes and the WHO reference', () => {
    const { db } = freshDb();
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sources')!.n).toBeGreaterThanOrEqual(10);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ingredients WHERE is_synthetic = 0')!.n).toBe(45);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM recipes WHERE is_synthetic = 0')!.n).toBe(20);
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM growth_reference')!.n).toBe(4632);
  });

  it('is idempotent: reloading the same version does not duplicate rows', () => {
    const { db } = freshDb();
    const before = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ingredients')!.n;
    const report = loadPacks(db);
    expect(report.skipped).toEqual(expect.arrayContaining(['ingredients-core', 'recipes-core']));
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM ingredients')!.n).toBe(before);
  });

  it('never assigns a per-ingredient minimum age, because no readable source publishes one', () => {
    const { db } = freshDb();
    const withAge = db.all<{ id: string }>(
      'SELECT id FROM ingredients WHERE is_synthetic = 0 AND min_age_months IS NOT NULL',
    );
    expect(withAge).toEqual([]);

    const statuses = db.all<{ age_status: string }>(
      'SELECT DISTINCT age_status FROM ingredients WHERE is_synthetic = 0',
    );
    expect(statuses.map((s) => s.age_status)).toEqual(['general_principle_only']);
  });

  it('never claims expert review for any bundled content', () => {
    const { db } = freshDb();
    const approved = db.all<{ id: string }>(
      "SELECT id FROM ingredients WHERE review_status IN ('expert_reviewed','publishable')",
    );
    const approvedRecipes = db.all<{ id: string }>(
      "SELECT id FROM recipes WHERE review_status IN ('expert_reviewed','publishable')",
    );
    expect(approved).toEqual([]);
    expect(approvedRecipes).toEqual([]);
  });

  it('keeps synthetic demo content strictly separated from authoritative content', () => {
    const { db } = freshDb();
    const leak = db.all<{ id: string }>(
      "SELECT id FROM ingredients WHERE is_synthetic = 1 AND source_id <> 'bbeat_synthetic_demo'",
    );
    expect(leak).toEqual([]);

    const mixedRecipe = db.all<{ id: string }>(
      `SELECT r.id FROM recipes r
       JOIN recipe_ingredients ri ON ri.recipe_id = r.id
       JOIN ingredients i ON i.id = ri.ingredient_id
       WHERE r.is_synthetic <> i.is_synthetic`,
    );
    expect(mixedRecipe).toEqual([]);
  });

  it('records a redistribution decision for every source', () => {
    const { db } = freshDb();
    const bad = db.all<{ id: string }>(
      "SELECT id FROM sources WHERE redistributable NOT IN ('yes','no','metadata_only','unclear')",
    );
    expect(bad).toEqual([]);
  });

  it('bundles no nutrition values, so energy figures cannot be invented', () => {
    const { db } = freshDb();
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM nutrition_values')!.n).toBe(0);
  });
});

describe('WHO reference data integrity', () => {
  it('carries both indicators for both sexes across the 0-36 month range', () => {
    const { db } = freshDb();
    for (const indicator of ['weight_for_age', 'length_for_age']) {
      for (const sex of ['male', 'female']) {
        const row = db.get<{ n: number; lo: number; hi: number }>(
          'SELECT COUNT(*) AS n, MIN(age_days) AS lo, MAX(age_days) AS hi FROM growth_reference WHERE indicator = ? AND sex = ?',
          [indicator, sex],
        )!;
        expect(row.n).toBe(1158);
        expect(row.lo).toBe(0);
        expect(row.hi).toBe(1157);
      }
    }
  });

  it('ships WHO-published SD fixtures for on-device self-checking', () => {
    expect(WHO_SD_FIXTURES.length).toBeGreaterThanOrEqual(40);
    for (const f of WHO_SD_FIXTURES) {
      expect(Number.isFinite(f.l)).toBe(true);
      expect(f.m).toBeGreaterThan(0);
      expect(f.s).toBeGreaterThan(0);
    }
  });
});
