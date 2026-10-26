import { SqlDriver } from './driver';

/**
 * Versioned forward-only migrations.
 *
 * Every user-recorded fact carries:
 *  - a stable text id (future multi-device sync)
 *  - occurred_at (UTC) + occurred_offset_min + occurred_tz + occurred_local_date
 *  - recorded_at (UTC, when the caregiver typed it)
 *  - status: active | superseded | undone   (corrections never destroy history)
 *  - client_op_id UNIQUE  (idempotency against double-taps / retries)
 */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'core_schema',
    sql: `
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE babies (
  id          TEXT PRIMARY KEY,
  name        TEXT,
  birth_date  TEXT,              -- YYYY-MM-DD, nullable (profile is skippable)
  sex         TEXT NOT NULL DEFAULT 'unknown',   -- male | female | unknown
  region      TEXT NOT NULL DEFAULT 'CN',        -- CN | SG  (content applicability)
  timezone    TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active'
);

-- ---------- knowledge packs (bundled, read-only, versioned) ----------
CREATE TABLE knowledge_packs (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,       -- ingredient | recipe | region | growth | nutrition
  version    TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  loaded_at  TEXT NOT NULL
);

CREATE TABLE sources (
  id             TEXT PRIMARY KEY,
  publisher      TEXT NOT NULL,
  title          TEXT NOT NULL,
  source_url     TEXT NOT NULL,
  source_version TEXT,
  source_date    TEXT,
  retrieved_at   TEXT,
  region         TEXT,            -- GLOBAL | CN | SG | US
  claim_scope    TEXT,
  license        TEXT,
  attribution    TEXT,
  redistributable TEXT NOT NULL DEFAULT 'unclear', -- yes | no | metadata_only | unclear
  review_status  TEXT NOT NULL DEFAULT 'collected',
  last_verified  TEXT
);

CREATE TABLE ingredients (
  id                TEXT PRIMARY KEY,
  pack_version      TEXT NOT NULL,
  name_zh           TEXT NOT NULL,
  name_en           TEXT,
  aliases_json      TEXT NOT NULL DEFAULT '[]',
  food_group        TEXT NOT NULL,
  common_allergen   INTEGER NOT NULL DEFAULT 0,
  allergen_note     TEXT,
  choking_risk      TEXT NOT NULL DEFAULT 'unknown',  -- unknown | low | moderate | high
  choking_note      TEXT,
  preparation_note  TEXT,
  min_age_months    INTEGER,       -- NULL == not established by a citable source
  max_age_months    INTEGER,
  age_status        TEXT NOT NULL DEFAULT 'unknown',
     -- unknown | general_principle_only | source_specific
  age_evidence      TEXT,
  region_json       TEXT NOT NULL DEFAULT '["GLOBAL"]',
  source_id         TEXT,
  review_status     TEXT NOT NULL DEFAULT 'collected',
     -- collected | transcribed | machine_validated | expert_reviewed | publishable
  is_synthetic      INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);
CREATE INDEX idx_ingredients_group ON ingredients(food_group);

CREATE TABLE recipes (
  id              TEXT PRIMARY KEY,
  pack_version    TEXT NOT NULL,
  recipe_version  TEXT NOT NULL DEFAULT '1',
  name_zh         TEXT NOT NULL,
  name_en         TEXT,
  texture         TEXT NOT NULL,    -- puree | mashed | minced | soft_pieces | finger_food
  steps_json      TEXT NOT NULL DEFAULT '[]',
  time_cost_min   INTEGER,
  min_age_months  INTEGER,
  age_status      TEXT NOT NULL DEFAULT 'unknown',
  age_evidence    TEXT,
  safety_note     TEXT,
  allergen_note   TEXT,
  region_json     TEXT NOT NULL DEFAULT '["GLOBAL"]',
  source_id       TEXT,
  license_note    TEXT,
  review_status   TEXT NOT NULL DEFAULT 'collected',
  is_synthetic    INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

CREATE TABLE recipe_ingredients (
  recipe_id      TEXT NOT NULL,
  ingredient_id  TEXT NOT NULL,
  amount_g       REAL,
  amount_unknown INTEGER NOT NULL DEFAULT 1,
  note           TEXT,
  PRIMARY KEY (recipe_id, ingredient_id),
  FOREIGN KEY (recipe_id) REFERENCES recipes(id),
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
);

-- WHO growth reference, loaded only from verified official tables.
CREATE TABLE growth_reference (
  indicator  TEXT NOT NULL,      -- weight_for_age | length_for_age
  sex        TEXT NOT NULL,      -- male | female
  age_days   INTEGER NOT NULL,
  l          REAL NOT NULL,
  m          REAL NOT NULL,
  s          REAL NOT NULL,
  pack_version TEXT NOT NULL,
  PRIMARY KEY (indicator, sex, age_days)
);

CREATE TABLE nutrition_values (
  ingredient_id TEXT NOT NULL,
  nutrient      TEXT NOT NULL,   -- energy_kcal | protein_g | iron_mg ...
  value_per_100g REAL NOT NULL,
  food_state    TEXT NOT NULL,   -- raw | cooked | unknown
  edible_portion_note TEXT,
  source_id     TEXT NOT NULL,
  region        TEXT,
  PRIMARY KEY (ingredient_id, nutrient, food_state),
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id),
  FOREIGN KEY (source_id) REFERENCES sources(id)
);

-- ---------- user data ----------
CREATE TABLE inventory_items (
  id            TEXT PRIMARY KEY,
  ingredient_id TEXT NOT NULL,
  qty_note      TEXT,
  updated_at    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
);

CREATE TABLE meal_slots (
  id          TEXT PRIMARY KEY,
  baby_id     TEXT NOT NULL,
  local_date  TEXT NOT NULL,      -- YYYY-MM-DD in the baby's timezone
  slot_order  INTEGER NOT NULL,
  label       TEXT NOT NULL,
  planned_time TEXT,              -- HH:MM local, optional
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY (baby_id) REFERENCES babies(id)
);
CREATE INDEX idx_meal_slots_date ON meal_slots(baby_id, local_date, status);

CREATE TABLE plan_items (
  id            TEXT PRIMARY KEY,
  meal_slot_id  TEXT NOT NULL,
  recipe_id     TEXT,
  ingredient_id TEXT,
  free_text     TEXT,
  amount_g      REAL,
  amount_unknown INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  FOREIGN KEY (meal_slot_id) REFERENCES meal_slots(id)
);
CREATE INDEX idx_plan_items_slot ON plan_items(meal_slot_id, status);

-- An actual feeding. served_snapshot_json freezes what was offered at the time,
-- so later edits to plans/recipes can never rewrite feeding history.
CREATE TABLE feeding_events (
  id                 TEXT PRIMARY KEY,
  baby_id            TEXT NOT NULL,
  meal_slot_id       TEXT,
  meal_label         TEXT,
  occurred_at        TEXT NOT NULL,
  occurred_offset_min INTEGER NOT NULL,
  occurred_tz        TEXT NOT NULL,
  occurred_local_date TEXT NOT NULL,
  recorded_at        TEXT NOT NULL,
  served_snapshot_json TEXT NOT NULL,
  intake_mode        TEXT NOT NULL,   -- ratio | absolute | unknown | none
  intake_ratio       REAL,
  intake_amount_g    REAL,
  note               TEXT,
  revision           INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'active',
  supersedes_id      TEXT,
  client_op_id       TEXT NOT NULL UNIQUE,
  FOREIGN KEY (baby_id) REFERENCES babies(id)
);
CREATE INDEX idx_feeding_date ON feeding_events(baby_id, occurred_local_date, status);

-- Per-ingredient facts of a feeding. Intake per ingredient is only ever stored
-- when the caregiver explicitly provided it; it is never derived from a total.
CREATE TABLE feeding_event_ingredients (
  id                TEXT PRIMARY KEY,
  feeding_event_id  TEXT NOT NULL,
  ingredient_id     TEXT,
  free_text         TEXT,
  served_amount_g   REAL,
  served_unknown    INTEGER NOT NULL DEFAULT 1,
  intake_amount_g   REAL,
  intake_known      INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (feeding_event_id) REFERENCES feeding_events(id)
);
CREATE INDEX idx_fei_event ON feeding_event_ingredients(feeding_event_id);

CREATE TABLE liquid_events (
  id                 TEXT PRIMARY KEY,
  baby_id            TEXT NOT NULL,
  kind               TEXT NOT NULL,   -- breastmilk | formula | water | other
  amount_ml          REAL,
  amount_unknown     INTEGER NOT NULL DEFAULT 1,
  occurred_at        TEXT NOT NULL,
  occurred_offset_min INTEGER NOT NULL,
  occurred_tz        TEXT NOT NULL,
  occurred_local_date TEXT NOT NULL,
  recorded_at        TEXT NOT NULL,
  note               TEXT,
  revision           INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'active',
  supersedes_id      TEXT,
  client_op_id       TEXT NOT NULL UNIQUE,
  FOREIGN KEY (baby_id) REFERENCES babies(id)
);
CREATE INDEX idx_liquid_date ON liquid_events(baby_id, occurred_local_date, status);

-- Four strictly separate fact kinds. None of them may be auto-promoted
-- into another (exposure != symptom != suspicion != clinician-reported).
CREATE TABLE exposure_events (
  id                 TEXT PRIMARY KEY,
  baby_id            TEXT NOT NULL,
  ingredient_id      TEXT,
  free_text          TEXT,
  amount_g           REAL,
  amount_unknown     INTEGER NOT NULL DEFAULT 1,
  occurred_at        TEXT NOT NULL,
  occurred_offset_min INTEGER NOT NULL,
  occurred_tz        TEXT NOT NULL,
  occurred_local_date TEXT NOT NULL,
  recorded_at        TEXT NOT NULL,
  note               TEXT,
  revision           INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'active',
  supersedes_id      TEXT,
  client_op_id       TEXT NOT NULL UNIQUE,
  FOREIGN KEY (baby_id) REFERENCES babies(id)
);
CREATE INDEX idx_exposure_date ON exposure_events(baby_id, occurred_local_date, status);

CREATE TABLE symptom_observations (
  id                 TEXT PRIMARY KEY,
  baby_id            TEXT NOT NULL,
  description        TEXT NOT NULL,
  body_site          TEXT,
  observed_severity  TEXT NOT NULL DEFAULT 'unspecified', -- mild|moderate|severe|unspecified
  occurred_at        TEXT NOT NULL,
  occurred_offset_min INTEGER NOT NULL,
  occurred_tz        TEXT NOT NULL,
  occurred_local_date TEXT NOT NULL,
  recorded_at        TEXT NOT NULL,
  revision           INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'active',
  supersedes_id      TEXT,
  client_op_id       TEXT NOT NULL UNIQUE,
  FOREIGN KEY (baby_id) REFERENCES babies(id)
);
CREATE INDEX idx_symptom_date ON symptom_observations(baby_id, occurred_local_date, status);

CREATE TABLE caregiver_suspicions (
  id                 TEXT PRIMARY KEY,
  baby_id            TEXT NOT NULL,
  ingredient_id      TEXT,
  free_text          TEXT,
  rationale          TEXT,
  occurred_at        TEXT NOT NULL,
  occurred_offset_min INTEGER NOT NULL,
  occurred_tz        TEXT NOT NULL,
  occurred_local_date TEXT NOT NULL,
  recorded_at        TEXT NOT NULL,
  revision           INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'active',
  supersedes_id      TEXT,
  client_op_id       TEXT NOT NULL UNIQUE,
  FOREIGN KEY (baby_id) REFERENCES babies(id)
);

-- Always and only "what the caregiver says a clinician told them".
CREATE TABLE reported_clinical_notes (
  id                 TEXT PRIMARY KEY,
  baby_id            TEXT NOT NULL,
  content            TEXT NOT NULL,
  clinician_role     TEXT,
  occurred_at        TEXT NOT NULL,
  occurred_offset_min INTEGER NOT NULL,
  occurred_tz        TEXT NOT NULL,
  occurred_local_date TEXT NOT NULL,
  recorded_at        TEXT NOT NULL,
  revision           INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'active',
  supersedes_id      TEXT,
  client_op_id       TEXT NOT NULL UNIQUE,
  FOREIGN KEY (baby_id) REFERENCES babies(id)
);

CREATE TABLE growth_measurements (
  id                 TEXT PRIMARY KEY,
  baby_id            TEXT NOT NULL,
  kind               TEXT NOT NULL,   -- weight | length
  value              REAL NOT NULL,
  unit               TEXT NOT NULL,   -- kg | g | cm
  method             TEXT,            -- lying | standing | unknown
  occurred_at        TEXT NOT NULL,
  occurred_offset_min INTEGER NOT NULL,
  occurred_tz        TEXT NOT NULL,
  occurred_local_date TEXT NOT NULL,
  recorded_at        TEXT NOT NULL,
  note               TEXT,
  revision           INTEGER NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'active',
  supersedes_id      TEXT,
  client_op_id       TEXT NOT NULL UNIQUE,
  FOREIGN KEY (baby_id) REFERENCES babies(id)
);
CREATE INDEX idx_growth_baby ON growth_measurements(baby_id, kind, status);

CREATE TABLE audit_log (
  id          TEXT PRIMARY KEY,
  entity      TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  action      TEXT NOT NULL,       -- create | revise | undo | restore
  at          TEXT NOT NULL,
  detail_json TEXT
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
`,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export function migrate(db: SqlDriver): { from: number; to: number; applied: number[] } {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
  const row = db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations');
  const from = row?.v ?? 0;
  const applied: number[] = [];

  for (const m of MIGRATIONS) {
    if (m.version <= from) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
        m.version,
        m.name,
        new Date().toISOString(),
      ]);
    });
    applied.push(m.version);
  }
  return { from, to: SCHEMA_VERSION, applied };
}
