export type Region = 'CN' | 'SG';
export type Sex = 'male' | 'female' | 'unknown';
export type FactStatus = 'active' | 'superseded' | 'undone';

/** How thoroughly a knowledge record has been checked. Strictly ordered. */
export type ReviewStatus =
  | 'collected'
  | 'transcribed'
  | 'machine_validated'
  | 'expert_reviewed'
  | 'publishable';

export const REVIEW_RANK: Record<ReviewStatus, number> = {
  collected: 0,
  transcribed: 1,
  machine_validated: 2,
  expert_reviewed: 3,
  publishable: 4,
};

/**
 * Personalised health output (age-suitability, allergy safety, growth
 * percentiles, nutrient adequacy) requires at least this level.
 * A coding agent cannot award `expert_reviewed`; only a qualified external
 * reviewer can, so in this build the gate is closed by design.
 */
export const CLINICAL_GATE: ReviewStatus = 'expert_reviewed';

export function meetsClinicalGate(status: string): boolean {
  const rank = REVIEW_RANK[status as ReviewStatus];
  return rank !== undefined && rank >= REVIEW_RANK[CLINICAL_GATE];
}

export type AgeStatus = 'unknown' | 'general_principle_only' | 'source_specific';

export interface Baby {
  id: string;
  name: string | null;
  birth_date: string | null;
  sex: Sex;
  region: Region;
  timezone: string;
  created_at: string;
  updated_at: string;
  status: string;
}

export interface Ingredient {
  id: string;
  pack_version: string;
  name_zh: string;
  name_en: string | null;
  aliases_json: string;
  food_group: string;
  common_allergen: number;
  allergen_note: string | null;
  choking_risk: 'unknown' | 'low' | 'moderate' | 'high';
  choking_note: string | null;
  preparation_note: string | null;
  min_age_months: number | null;
  max_age_months: number | null;
  age_status: AgeStatus;
  age_evidence: string | null;
  region_json: string;
  source_id: string | null;
  review_status: ReviewStatus;
  is_synthetic: number;
}

export interface Recipe {
  id: string;
  pack_version: string;
  recipe_version: string;
  name_zh: string;
  name_en: string | null;
  texture: 'puree' | 'mashed' | 'minced' | 'soft_pieces' | 'finger_food';
  steps_json: string;
  time_cost_min: number | null;
  min_age_months: number | null;
  age_status: AgeStatus;
  age_evidence: string | null;
  safety_note: string | null;
  allergen_note: string | null;
  region_json: string;
  source_id: string | null;
  license_note: string | null;
  review_status: ReviewStatus;
  is_synthetic: number;
}

export interface SourceRecord {
  id: string;
  publisher: string;
  title: string;
  source_url: string;
  source_version: string | null;
  source_date: string | null;
  retrieved_at: string | null;
  region: string | null;
  claim_scope: string | null;
  license: string | null;
  attribution: string | null;
  redistributable: string;
  review_status: string;
  last_verified: string | null;
}

export interface MealSlot {
  id: string;
  baby_id: string;
  local_date: string;
  slot_order: number;
  label: string;
  planned_time: string | null;
  created_at: string;
  updated_at: string;
  status: string;
}

export interface PlanItem {
  id: string;
  meal_slot_id: string;
  recipe_id: string | null;
  ingredient_id: string | null;
  free_text: string | null;
  amount_g: number | null;
  amount_unknown: number;
  created_at: string;
  status: string;
}

export type IntakeMode = 'ratio' | 'absolute' | 'unknown' | 'none';

export interface ServedSnapshotItem {
  ingredient_id: string | null;
  free_text: string | null;
  label: string;
  recipe_id: string | null;
  amount_g: number | null;
  amount_unknown: boolean;
}

export interface ServedSnapshot {
  /** Frozen description of the single portion actually offered this time. */
  items: ServedSnapshotItem[];
  recipe_ids: string[];
  recipe_versions: Record<string, string>;
  pack_versions: Record<string, string>;
  captured_at: string;
}

export interface FeedingEvent {
  id: string;
  baby_id: string;
  meal_slot_id: string | null;
  meal_label: string | null;
  occurred_at: string;
  occurred_offset_min: number;
  occurred_tz: string;
  occurred_local_date: string;
  recorded_at: string;
  served_snapshot_json: string;
  intake_mode: IntakeMode;
  intake_ratio: number | null;
  intake_amount_g: number | null;
  note: string | null;
  revision: number;
  status: FactStatus;
  supersedes_id: string | null;
  client_op_id: string;
}

export type LiquidKind = 'breastmilk' | 'formula' | 'water' | 'other';

export interface LiquidEvent {
  id: string;
  baby_id: string;
  kind: LiquidKind;
  amount_ml: number | null;
  amount_unknown: number;
  occurred_at: string;
  occurred_offset_min: number;
  occurred_tz: string;
  occurred_local_date: string;
  recorded_at: string;
  note: string | null;
  revision: number;
  status: FactStatus;
  supersedes_id: string | null;
  client_op_id: string;
}

export interface ExposureEvent {
  id: string;
  baby_id: string;
  ingredient_id: string | null;
  free_text: string | null;
  amount_g: number | null;
  amount_unknown: number;
  occurred_at: string;
  occurred_offset_min: number;
  occurred_tz: string;
  occurred_local_date: string;
  recorded_at: string;
  note: string | null;
  revision: number;
  status: FactStatus;
  supersedes_id: string | null;
  client_op_id: string;
}

export interface SymptomObservation {
  id: string;
  baby_id: string;
  description: string;
  body_site: string | null;
  observed_severity: 'mild' | 'moderate' | 'severe' | 'unspecified';
  occurred_at: string;
  occurred_offset_min: number;
  occurred_tz: string;
  occurred_local_date: string;
  recorded_at: string;
  revision: number;
  status: FactStatus;
  supersedes_id: string | null;
  client_op_id: string;
}

export interface GrowthMeasurement {
  id: string;
  baby_id: string;
  kind: 'weight' | 'length';
  value: number;
  unit: 'kg' | 'g' | 'cm';
  method: string | null;
  occurred_at: string;
  occurred_offset_min: number;
  occurred_tz: string;
  occurred_local_date: string;
  recorded_at: string;
  note: string | null;
  revision: number;
  status: FactStatus;
  supersedes_id: string | null;
  client_op_id: string;
}

export const FOOD_GROUP_LABELS: Record<string, string> = {
  grain: '谷薯类',
  vegetable: '蔬菜类',
  fruit: '水果类',
  meat: '畜禽肉',
  fish: '水产类',
  egg: '蛋类',
  dairy: '奶类',
  legume: '豆类',
  nut_seed: '坚果籽类',
  fat: '油脂类',
  other: '其他',
};

export const TEXTURE_LABELS: Record<string, string> = {
  puree: '细泥',
  mashed: '粗泥/碎末',
  minced: '碎丁',
  soft_pieces: '软块',
  finger_food: '手指食物',
};

export const LIQUID_LABELS: Record<LiquidKind, string> = {
  breastmilk: '母乳',
  formula: '配方奶',
  water: '水',
  other: '其他液体',
};

export const CHOKING_LABELS: Record<string, string> = {
  unknown: '未核验',
  low: '较低',
  moderate: '中等',
  high: '较高',
};

export const REVIEW_LABELS: Record<string, string> = {
  collected: '已采集',
  transcribed: '已转录',
  machine_validated: '程序校验',
  expert_reviewed: '专业审核',
  publishable: '可发布',
};

export const INTAKE_MODE_LABELS: Record<IntakeMode, string> = {
  unknown: '吃了多少不详',
  none: '一口没吃',
  ratio: '按比例记录',
  absolute: '按克数记录',
};
