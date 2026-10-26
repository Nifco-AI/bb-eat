#!/usr/bin/env node
/**
 * Recomputes every number in docs/DATA_QUALITY.md from the packs themselves,
 * so the report can be checked rather than trusted. Run: node scripts/data-quality.js
 */
const path = require('path');
const packs = path.join(__dirname, '..', 'src', 'data', 'packs');
const load = (n) => require(path.join(packs, n + '.json'));

const ingredients = load('ingredients-core').records;
const recipes = load('recipes-core').records;
const sources = load('sources').records;
const demo = load('demo-synthetic');

const tally = (rows, key) =>
  rows.reduce((acc, row) => {
    const k = JSON.stringify(key(row));
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

const byId = new Map(ingredients.map((i) => [i.id, i]));
const recipeIngredientIds = recipes.flatMap((r) =>
  r.ingredients.map((i) => i.ingredient_id || i)
);
const dangling = recipeIngredientIds.filter((id) => !byId.has(id));
const groupsInRecipes = new Set(
  recipeIngredientIds.filter((id) => byId.has(id)).map((id) => byId.get(id).food_group)
);

const out = {
  counts: {
    ingredients: ingredients.length,
    recipes: recipes.length,
    demo_ingredients: demo.ingredients.length,
    demo_recipes: demo.recipes.length,
    dangling_recipe_ingredient_refs: dangling.length,
  },
  food_group: tally(ingredients, (i) => i.food_group),
  food_groups_without_recipe: [...new Set(ingredients.map((i) => i.food_group))].filter(
    (g) => !groupsInRecipes.has(g)
  ),
  age_evidence: {
    ingredients_with_min_age: ingredients.filter((i) => i.min_age_months != null).length,
    recipes_with_min_age: recipes.filter((r) => r.min_age_months != null).length,
    ingredient_age_status: tally(ingredients, (i) => i.age_status),
    recipe_age_status: tally(recipes, (r) => r.age_status),
  },
  safety: {
    choking_risk: tally(ingredients, (i) => i.choking_risk),
    common_allergens: ingredients.filter((i) => i.common_allergen).length,
  },
  provenance: {
    ingredient_source: tally(ingredients, (i) => i.source_id),
    recipe_source: tally(recipes, (r) => r.source_id),
    review_status: tally([...ingredients, ...recipes], (r) => r.review_status),
    expert_reviewed_rows: [...ingredients, ...recipes].filter(
      (r) => r.review_status === 'expert_reviewed'
    ).length,
    registered_sources: sources.length,
  },
};

console.log(JSON.stringify(out, null, 2));

// These are the claims the report makes. If a pack edit ever breaks one, fail loudly.
const invariants = [
  ['no expert_reviewed rows exist', out.provenance.expert_reviewed_rows === 0],
  ['no ingredient carries a min_age threshold', out.age_evidence.ingredients_with_min_age === 0],
  ['no recipe carries a min_age threshold', out.age_evidence.recipes_with_min_age === 0],
  ['every recipe ingredient reference resolves', dangling.length === 0],
];
const broken = invariants.filter(([, ok]) => !ok).map(([label]) => label);
if (broken.length > 0) {
  console.error('\nDATA QUALITY INVARIANT BROKEN:\n' + broken.map((b) => '  - ' + b).join('\n'));
  process.exit(1);
}
console.error('\nAll documented data-quality invariants hold.');
