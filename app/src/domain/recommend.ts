import { SqlDriver } from '../db/driver';
import { Ingredient, Recipe, Region, meetsClinicalGate } from './types';

/**
 * Full-day plan recommendation — fail-closed by design.
 *
 * Personalised age-suitability and allergy-safety filtering requires recipe and
 * ingredient records that passed *external professional review*. A coding agent
 * cannot grant that status, so on a real profile this module reports why it
 * cannot recommend instead of guessing.
 *
 * A clearly-labelled synthetic demo mode exists so the ranking UI can be
 * exercised; its output is never described as nutrition or medical advice.
 */

export type BlockReason =
  | 'no_expert_reviewed_recipes'
  | 'birth_date_unknown'
  | 'no_meal_slots'
  | 'region_pack_unreviewed'
  | 'insufficient_candidates';

export const BLOCK_TEXT: Record<BlockReason, string> = {
  no_expert_reviewed_recipes:
    '目前内置食谱均未通过外部专业审核，无法生成适龄安全的全天推荐。你仍可手动安排每一餐。',
  birth_date_unknown: '未填写出生日期，无法判断月龄适用性。填写后仍需通过专业审核的知识包才能推荐。',
  no_meal_slots: '还没有设置今天的餐次。请先添加你家实际的餐次安排。',
  region_pack_unreviewed: '当前地区的临床内容尚未通过独立审核，不跨地区借用其他地区的建议。',
  insufficient_candidates: '通过硬性安全条件的候选不足，不会用未达标的食谱凑数。',
};

export interface PlanCandidate {
  id: string;
  slots: { label: string; recipe: Recipe; reasons: string[] }[];
  score: number;
  explanation: string[];
  variety_groups: number;
  total_time_min: number;
  knowledge_versions: string[];
  is_synthetic: boolean;
}

export interface RecommendInput {
  babyId: string;
  ageMonths: number | null;
  region: Region;
  slotLabels: string[];
  /** Ingredient ids the caregiver flagged as suspected or to avoid. */
  avoidIngredientIds: string[];
  inventoryIngredientIds: string[];
  maxPrepMinutes: number | null;
  /** Ingredients already eaten in the last few days, used to reduce repetition. */
  recentIngredientIds: string[];
  demoMode: boolean;
}

export interface RecommendOutput {
  available: boolean;
  candidates: PlanCandidate[];
  /** Why fewer than three (or zero) plans were produced. Never padded. */
  blocked: { reason: BlockReason; message: string }[];
  diagnostics: {
    recipes_total: number;
    recipes_expert_reviewed: number;
    recipes_passing_hard_constraints: number;
    hard_constraint_rejections: { recipe: string; reason: string }[];
  };
  is_synthetic: boolean;
}

interface HardCheckResult {
  pass: boolean;
  reason?: string;
}

/**
 * Hard safety constraints are evaluated BEFORE any scoring.
 * Unknown is treated as failing, never as permission.
 */
function hardConstraints(
  recipe: Recipe,
  recipeIngredients: Ingredient[],
  input: RecommendInput,
  requireExpertReview: boolean,
): HardCheckResult {
  if (requireExpertReview && !meetsClinicalGate(recipe.review_status)) {
    return { pass: false, reason: '食谱未通过外部专业审核' };
  }
  const regions = JSON.parse(recipe.region_json) as string[];
  if (!regions.includes(input.region) && !regions.includes('GLOBAL')) {
    return { pass: false, reason: `内容未标注适用于 ${input.region}` };
  }
  if (input.ageMonths === null) return { pass: false, reason: '月龄未知' };
  if (recipe.age_status !== 'source_specific' || recipe.min_age_months === null) {
    return { pass: false, reason: '食谱缺少可溯源的适用月龄依据' };
  }
  if (input.ageMonths < recipe.min_age_months) {
    return { pass: false, reason: `适用月龄 ${recipe.min_age_months}m 起` };
  }
  for (const ing of recipeIngredients) {
    if (input.avoidIngredientIds.includes(ing.id)) {
      return { pass: false, reason: `包含需回避的「${ing.name_zh}」` };
    }
    if (ing.choking_risk === 'high') {
      return { pass: false, reason: `「${ing.name_zh}」噎食风险标注为较高` };
    }
    if (ing.choking_risk === 'unknown') {
      return { pass: false, reason: `「${ing.name_zh}」噎食风险未核验` };
    }
    if (requireExpertReview && !meetsClinicalGate(ing.review_status)) {
      return { pass: false, reason: `食材「${ing.name_zh}」未通过外部专业审核` };
    }
    if (ing.age_status !== 'source_specific' || ing.min_age_months === null) {
      return { pass: false, reason: `食材「${ing.name_zh}」缺少可溯源的适用月龄` };
    }
    if (input.ageMonths < ing.min_age_months) {
      return { pass: false, reason: `食材「${ing.name_zh}」适用月龄 ${ing.min_age_months}m 起` };
    }
  }
  if (input.maxPrepMinutes !== null && (recipe.time_cost_min ?? 999) > input.maxPrepMinutes) {
    return { pass: false, reason: `制作约 ${recipe.time_cost_min} 分钟，超过偏好` };
  }
  return { pass: true };
}

function loadRecipeIngredients(db: SqlDriver, recipeId: string): Ingredient[] {
  return db.all<Ingredient>(
    `SELECT i.* FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id WHERE ri.recipe_id = ?`,
    [recipeId],
  );
}

export function recommend(db: SqlDriver, input: RecommendInput): RecommendOutput {
  const blocked: { reason: BlockReason; message: string }[] = [];
  const recipes = db.all<Recipe>(
    input.demoMode
      ? 'SELECT * FROM recipes WHERE is_synthetic = 1'
      : 'SELECT * FROM recipes WHERE is_synthetic = 0',
  );
  const expertCount = recipes.filter((r) => meetsClinicalGate(r.review_status)).length;

  const diagnostics: RecommendOutput['diagnostics'] = {
    recipes_total: recipes.length,
    recipes_expert_reviewed: expertCount,
    recipes_passing_hard_constraints: 0,
    hard_constraint_rejections: [],
  };

  if (input.slotLabels.length === 0) blocked.push({ reason: 'no_meal_slots', message: BLOCK_TEXT.no_meal_slots });
  if (input.ageMonths === null) blocked.push({ reason: 'birth_date_unknown', message: BLOCK_TEXT.birth_date_unknown });
  if (!input.demoMode && expertCount === 0) {
    blocked.push({ reason: 'no_expert_reviewed_recipes', message: BLOCK_TEXT.no_expert_reviewed_recipes });
  }

  if (blocked.length > 0) {
    return { available: false, candidates: [], blocked, diagnostics, is_synthetic: input.demoMode };
  }

  const passing: { recipe: Recipe; ingredients: Ingredient[] }[] = [];
  for (const r of recipes) {
    const ings = loadRecipeIngredients(db, r.id);
    const check = hardConstraints(r, ings, input, !input.demoMode);
    if (check.pass) passing.push({ recipe: r, ingredients: ings });
    else diagnostics.hard_constraint_rejections.push({ recipe: r.name_zh, reason: check.reason ?? '未通过' });
  }
  diagnostics.recipes_passing_hard_constraints = passing.length;

  if (passing.length < input.slotLabels.length) {
    blocked.push({ reason: 'insufficient_candidates', message: BLOCK_TEXT.insufficient_candidates });
    return { available: false, candidates: [], blocked, diagnostics, is_synthetic: input.demoMode };
  }

  const candidates = assemble(passing, input);
  if (candidates.length < 3) {
    blocked.push({
      reason: 'insufficient_candidates',
      message: `只能组合出 ${candidates.length} 套满足条件的全天方案，不会用未达标食谱补足。`,
    });
  }
  return {
    available: candidates.length > 0,
    candidates,
    blocked,
    diagnostics,
    is_synthetic: input.demoMode,
  };
}

/**
 * Builds up to three *distinct* full-day plans by rotating the candidate pool,
 * then scores for food-group variety, inventory fit, prep cost and repetition.
 */
function assemble(
  pool: { recipe: Recipe; ingredients: Ingredient[] }[],
  input: RecommendInput,
): PlanCandidate[] {
  const out: PlanCandidate[] = [];
  const n = pool.length;
  const slotCount = input.slotLabels.length;
  const seen = new Set<string>();

  for (let offset = 0; offset < n && out.length < 3; offset += 1) {
    const chosen: { recipe: Recipe; ingredients: Ingredient[] }[] = [];
    for (let i = 0; i < slotCount; i += 1) chosen.push(pool[(offset + i) % n]);
    const key = chosen
      .map((c) => c.recipe.id)
      .sort()
      .join('|');
    if (seen.has(key)) continue;
    // A full-day plan that repeats the same recipe twice is not a real option.
    if (new Set(chosen.map((c) => c.recipe.id)).size < slotCount) continue;
    seen.add(key);

    const groups = new Set<string>();
    const ingIds = new Set<string>();
    let inInventory = 0;
    let time = 0;
    let repeats = 0;
    for (const c of chosen) {
      time += c.recipe.time_cost_min ?? 0;
      for (const ing of c.ingredients) {
        groups.add(ing.food_group);
        ingIds.add(ing.id);
        if (input.inventoryIngredientIds.includes(ing.id)) inInventory += 1;
        if (input.recentIngredientIds.includes(ing.id)) repeats += 1;
      }
    }
    const varietyScore = groups.size * 10;
    const inventoryScore = ingIds.size === 0 ? 0 : (inInventory / ingIds.size) * 20;
    const timeScore = Math.max(0, 20 - time / 5);
    const repeatPenalty = ingIds.size === 0 ? 0 : (repeats / ingIds.size) * 15;
    const score = varietyScore + inventoryScore + timeScore - repeatPenalty;

    out.push({
      id: `plan_${offset}`,
      slots: chosen.map((c, i) => ({
        label: input.slotLabels[i],
        recipe: c.recipe,
        reasons: [
          `食物组：${[...new Set(c.ingredients.map((x) => x.food_group))].join('、')}`,
          c.recipe.age_evidence ? `适龄依据：${c.recipe.age_evidence}` : '适龄依据：未核验',
        ],
      })),
      score: Math.round(score * 10) / 10,
      explanation: [
        `覆盖 ${groups.size} 个食物组`,
        `${inInventory}/${ingIds.size} 项食材已在家庭库存`,
        `预计备餐约 ${time} 分钟`,
        repeats > 0 ? `与近期记录有 ${repeats} 处重复，已降权` : '与近期记录无明显重复',
      ],
      variety_groups: groups.size,
      total_time_min: time,
      knowledge_versions: [...new Set(chosen.map((c) => c.recipe.pack_version))],
      is_synthetic: chosen.some((c) => c.recipe.is_synthetic === 1),
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}
