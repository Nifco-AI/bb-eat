import { SqlDriver } from '../db/driver';

import sourcesPack from './packs/sources.json';
import ingredientsPack from './packs/ingredients-core.json';
import recipesPack from './packs/recipes-core.json';
import growthPack from './packs/growth-who-2006.json';
import demoPack from './packs/demo-synthetic.json';
import regionsPack from './packs/regions.json';

/**
 * Loads the bundled, versioned knowledge packs into SQLite.
 *
 * Packs are read-only reference data. Loading is idempotent and keyed on pack
 * version, so an app update replaces reference content without ever touching
 * the caregiver's recorded facts.
 */

export interface RegionRecord {
  code: string;
  name_zh: string;
  name_en: string;
  ui_languages: string[];
  default_timezone: string;
  common_timezones: string[];
  data_jurisdiction: string;
  clinical_sources: string[];
  clinical_review_status: string;
  clinical_available: boolean;
  unavailable_reason: string;
  growth_reference: string;
  growth_reference_caveat: string;
  dietary_context_note: string;
}

export const REGIONS = regionsPack.records as RegionRecord[];

export function regionInfo(code: string): RegionRecord {
  return REGIONS.find((r) => r.code === code) ?? REGIONS[0];
}

export const PACK_VERSIONS = {
  sources: sourcesPack.version,
  ingredients: ingredientsPack.version,
  recipes: recipesPack.version,
  growth: growthPack.version,
  demo: demoPack.version,
  regions: regionsPack.version,
};

function packLoaded(db: SqlDriver, id: string, version: string): boolean {
  const row = db.get<{ version: string }>('SELECT version FROM knowledge_packs WHERE id = ?', [id]);
  return row?.version === version;
}

function markLoaded(db: SqlDriver, id: string, kind: string, version: string, count: number): void {
  db.run(
    `INSERT INTO knowledge_packs (id, kind, version, record_count, loaded_at) VALUES (?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET version = excluded.version, record_count = excluded.record_count, loaded_at = excluded.loaded_at`,
    [id, kind, version, count, new Date().toISOString()],
  );
}

export interface LoadReport {
  sources: number;
  ingredients: number;
  recipes: number;
  growth_rows: number;
  demo_ingredients: number;
  demo_recipes: number;
  skipped: string[];
}

export function loadPacks(db: SqlDriver): LoadReport {
  const report: LoadReport = {
    sources: 0,
    ingredients: 0,
    recipes: 0,
    growth_rows: 0,
    demo_ingredients: 0,
    demo_recipes: 0,
    skipped: [],
  };

  db.transaction(() => {
    if (packLoaded(db, 'sources', PACK_VERSIONS.sources)) {
      report.skipped.push('sources');
    } else {
      for (const s of sourcesPack.records) {
        db.run(
          `INSERT INTO sources (id, publisher, title, source_url, source_version, source_date, retrieved_at,
             region, claim_scope, license, attribution, redistributable, review_status, last_verified)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             publisher=excluded.publisher, title=excluded.title, source_url=excluded.source_url,
             source_version=excluded.source_version, source_date=excluded.source_date,
             retrieved_at=excluded.retrieved_at, region=excluded.region, claim_scope=excluded.claim_scope,
             license=excluded.license, attribution=excluded.attribution,
             redistributable=excluded.redistributable, review_status=excluded.review_status,
             last_verified=excluded.last_verified`,
          [
            s.id,
            s.publisher,
            s.title,
            s.source_url,
            s.source_version ?? null,
            s.source_date ?? null,
            s.retrieved_at ?? null,
            s.region ?? null,
            s.claim_scope ?? null,
            s.license ?? null,
            s.attribution ?? null,
            s.redistributable ?? 'unclear',
            s.review_status ?? 'collected',
            s.last_verified ?? null,
          ],
        );
        report.sources += 1;
      }
      markLoaded(db, 'sources', 'source', PACK_VERSIONS.sources, report.sources);
    }

    if (packLoaded(db, 'ingredients-core', PACK_VERSIONS.ingredients)) {
      report.skipped.push('ingredients-core');
    } else {
      for (const i of ingredientsPack.records) {
        db.run(
          `INSERT INTO ingredients (id, pack_version, name_zh, name_en, aliases_json, food_group,
             common_allergen, allergen_note, choking_risk, choking_note, preparation_note,
             min_age_months, max_age_months, age_status, age_evidence, region_json, source_id,
             review_status, is_synthetic)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
           ON CONFLICT(id) DO UPDATE SET
             pack_version=excluded.pack_version, name_zh=excluded.name_zh, name_en=excluded.name_en,
             aliases_json=excluded.aliases_json, food_group=excluded.food_group,
             common_allergen=excluded.common_allergen, allergen_note=excluded.allergen_note,
             choking_risk=excluded.choking_risk, choking_note=excluded.choking_note,
             preparation_note=excluded.preparation_note, min_age_months=excluded.min_age_months,
             max_age_months=excluded.max_age_months, age_status=excluded.age_status,
             age_evidence=excluded.age_evidence, region_json=excluded.region_json,
             source_id=excluded.source_id, review_status=excluded.review_status`,
          [
            i.id,
            PACK_VERSIONS.ingredients,
            i.name_zh,
            i.name_en,
            JSON.stringify(i.aliases ?? []),
            i.food_group,
            i.common_allergen ? 1 : 0,
            i.allergen_note ?? null,
            i.choking_risk,
            i.choking_note ?? null,
            i.preparation_note ?? null,
            i.min_age_months,
            i.max_age_months,
            i.age_status,
            i.age_evidence ?? null,
            JSON.stringify(i.regions ?? ['GLOBAL']),
            i.source_id ?? null,
            i.review_status,
          ],
        );
        report.ingredients += 1;
      }
      markLoaded(db, 'ingredients-core', 'ingredient', PACK_VERSIONS.ingredients, report.ingredients);
    }

    if (packLoaded(db, 'recipes-core', PACK_VERSIONS.recipes)) {
      report.skipped.push('recipes-core');
    } else {
      for (const r of recipesPack.records) {
        db.run(
          `INSERT INTO recipes (id, pack_version, recipe_version, name_zh, name_en, texture, steps_json,
             time_cost_min, min_age_months, age_status, age_evidence, safety_note, allergen_note,
             region_json, source_id, license_note, review_status, is_synthetic)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
           ON CONFLICT(id) DO UPDATE SET
             pack_version=excluded.pack_version, recipe_version=excluded.recipe_version,
             name_zh=excluded.name_zh, texture=excluded.texture, steps_json=excluded.steps_json,
             time_cost_min=excluded.time_cost_min, min_age_months=excluded.min_age_months,
             age_status=excluded.age_status, age_evidence=excluded.age_evidence,
             safety_note=excluded.safety_note, allergen_note=excluded.allergen_note,
             region_json=excluded.region_json, source_id=excluded.source_id,
             license_note=excluded.license_note, review_status=excluded.review_status`,
          [
            r.id,
            PACK_VERSIONS.recipes,
            r.recipe_version,
            r.name_zh,
            r.name_en,
            r.texture,
            JSON.stringify(r.steps),
            r.time_cost_min,
            r.min_age_months,
            r.age_status,
            r.age_evidence,
            r.safety_note,
            r.allergen_note,
            JSON.stringify(r.regions ?? ['GLOBAL']),
            r.source_id,
            r.license_note,
            r.review_status,
          ],
        );
        db.run('DELETE FROM recipe_ingredients WHERE recipe_id = ?', [r.id]);
        for (const ri of r.ingredients) {
          db.run(
            'INSERT INTO recipe_ingredients (recipe_id, ingredient_id, amount_g, amount_unknown, note) VALUES (?,?,?,?,NULL)',
            [r.id, ri.ingredient_id, ri.amount_g, ri.amount_g === null ? 1 : 0],
          );
        }
        report.recipes += 1;
      }
      markLoaded(db, 'recipes-core', 'recipe', PACK_VERSIONS.recipes, report.recipes);
    }

    if (packLoaded(db, 'growth-who-2006', PACK_VERSIONS.growth)) {
      report.skipped.push('growth-who-2006');
    } else {
      db.run('DELETE FROM growth_reference');
      for (const row of growthPack.rows as unknown as [string, string, number, number, number, number][]) {
        db.run(
          'INSERT INTO growth_reference (indicator, sex, age_days, l, m, s, pack_version) VALUES (?,?,?,?,?,?,?)',
          [row[0], row[1], row[2], row[3], row[4], row[5], PACK_VERSIONS.growth],
        );
        report.growth_rows += 1;
      }
      markLoaded(db, 'growth-who-2006', 'growth', PACK_VERSIONS.growth, report.growth_rows);
    }

    if (packLoaded(db, 'demo-synthetic', PACK_VERSIONS.demo)) {
      report.skipped.push('demo-synthetic');
    } else {
      for (const i of demoPack.ingredients) {
        db.run(
          `INSERT INTO ingredients (id, pack_version, name_zh, name_en, aliases_json, food_group,
             common_allergen, allergen_note, choking_risk, choking_note, preparation_note,
             min_age_months, max_age_months, age_status, age_evidence, region_json, source_id,
             review_status, is_synthetic)
           VALUES (?,?,?,?,'[]',?,0,NULL,?,'合成演示数据，风险分级不真实',NULL,?,NULL,'source_specific',
             '合成演示数据，不是真实依据','["GLOBAL"]','bbeat_synthetic_demo','collected',1)
           ON CONFLICT(id) DO UPDATE SET pack_version=excluded.pack_version`,
          [i.id, PACK_VERSIONS.demo, i.name_zh, i.name_en, i.food_group, i.choking_risk, i.min_age_months],
        );
        report.demo_ingredients += 1;
      }
      for (const r of demoPack.recipes) {
        db.run(
          `INSERT INTO recipes (id, pack_version, recipe_version, name_zh, name_en, texture, steps_json,
             time_cost_min, min_age_months, age_status, age_evidence, safety_note, allergen_note,
             region_json, source_id, license_note, review_status, is_synthetic)
           VALUES (?,?,'1',?,NULL,?,?,?,?,'source_specific','合成演示数据，不是真实依据',
             '合成演示数据，不可作为喂养依据',NULL,'["GLOBAL"]','bbeat_synthetic_demo','合成数据','collected',1)
           ON CONFLICT(id) DO UPDATE SET pack_version=excluded.pack_version`,
          [
            r.id,
            PACK_VERSIONS.demo,
            r.name_zh,
            r.texture,
            JSON.stringify(['演示步骤一', '演示步骤二', '演示步骤三']),
            r.time_cost_min,
            r.min_age_months,
          ],
        );
        db.run('DELETE FROM recipe_ingredients WHERE recipe_id = ?', [r.id]);
        for (const ingId of r.ingredients) {
          db.run(
            'INSERT INTO recipe_ingredients (recipe_id, ingredient_id, amount_g, amount_unknown, note) VALUES (?,?,NULL,1,NULL)',
            [r.id, ingId],
          );
        }
        report.demo_recipes += 1;
      }
      markLoaded(
        db,
        'demo-synthetic',
        'demo',
        PACK_VERSIONS.demo,
        report.demo_ingredients + report.demo_recipes,
      );
    }

    markLoaded(db, 'regions', 'region', PACK_VERSIONS.regions, REGIONS.length);
  });

  return report;
}

/** WHO fixtures kept so the app can re-prove its own LMS maths on device. */
export const WHO_SD_FIXTURES = growthPack.verification.who_published_sd_fixtures as {
  indicator: string;
  sex: string;
  age_days: number;
  l: number;
  m: number;
  s: number;
  sd0: number;
  sd2neg: number;
  sd2: number;
  sd3neg: number | null;
  sd3: number | null;
}[];

export const GROWTH_PACK_FILES = growthPack.files as {
  indicator: string;
  sex: string;
  file: string;
  source_url: string;
  sha256: string;
  bytes: number;
  rows_in_file: number;
}[];
