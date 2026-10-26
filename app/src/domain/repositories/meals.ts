import { assertNotSynthetic } from './synthetic';
import { SqlDriver } from '../../db/driver';
import { newId } from '../ids';
import { MealSlot, PlanItem, Recipe, ServedSnapshot, ServedSnapshotItem } from '../types';

export interface PlanItemView extends PlanItem {
  display_name: string;
  recipe_name: string | null;
  ingredient_name: string | null;
}

export interface MealSlotView extends MealSlot {
  items: PlanItemView[];
  feeding_count: number;
}

/** Default labels offered when the caregiver creates a slot; never auto-applied. */
export const SLOT_LABEL_SUGGESTIONS = ['早餐', '上午加餐', '午餐', '下午加餐', '晚餐', '夜间'];

export function listSlots(db: SqlDriver, babyId: string, localDate: string): MealSlotView[] {
  const slots = db.all<MealSlot>(
    "SELECT * FROM meal_slots WHERE baby_id = ? AND local_date = ? AND status = 'active' ORDER BY slot_order, created_at",
    [babyId, localDate],
  );
  return slots.map((s) => ({
    ...s,
    items: listPlanItems(db, s.id),
    feeding_count:
      db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM feeding_events WHERE meal_slot_id = ? AND status = 'active'",
        [s.id],
      )?.n ?? 0,
  }));
}

export function listPlanItems(db: SqlDriver, slotId: string): PlanItemView[] {
  return db.all<PlanItemView>(
    `SELECT p.*,
            r.name_zh AS recipe_name,
            i.name_zh AS ingredient_name,
            COALESCE(r.name_zh, i.name_zh, p.free_text, '未命名') AS display_name
     FROM plan_items p
     LEFT JOIN recipes r ON r.id = p.recipe_id
     LEFT JOIN ingredients i ON i.id = p.ingredient_id
     WHERE p.meal_slot_id = ? AND p.status = 'active'
     ORDER BY p.created_at`,
    [slotId],
  );
}

export function createSlot(
  db: SqlDriver,
  babyId: string,
  localDate: string,
  label: string,
  plannedTime: string | null = null,
): MealSlot {
  const now = new Date().toISOString();
  const id = newId('slot');
  const max =
    db.get<{ n: number | null }>(
      "SELECT MAX(slot_order) AS n FROM meal_slots WHERE baby_id = ? AND local_date = ? AND status = 'active'",
      [babyId, localDate],
    )?.n ?? -1;
  db.run(
    'INSERT INTO meal_slots (id, baby_id, local_date, slot_order, label, planned_time, created_at, updated_at, status) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, babyId, localDate, (max ?? -1) + 1, label.trim() || '一餐', plannedTime, now, now, 'active'],
  );
  return db.get<MealSlot>('SELECT * FROM meal_slots WHERE id = ?', [id])!;
}

export function renameSlot(db: SqlDriver, slotId: string, label: string, plannedTime: string | null): void {
  db.run('UPDATE meal_slots SET label = ?, planned_time = ?, updated_at = ? WHERE id = ?', [
    label.trim() || '一餐',
    plannedTime,
    new Date().toISOString(),
    slotId,
  ]);
}

/**
 * Removing a planned slot only retires the *plan*. Feeding events keep their
 * own frozen snapshot, so history is never rewritten by a plan edit.
 */
export function removeSlot(db: SqlDriver, slotId: string): void {
  db.transaction(() => {
    db.run("UPDATE meal_slots SET status = 'removed', updated_at = ? WHERE id = ?", [
      new Date().toISOString(),
      slotId,
    ]);
    db.run("UPDATE plan_items SET status = 'removed' WHERE meal_slot_id = ?", [slotId]);
  });
}

export function addPlanItem(
  db: SqlDriver,
  slotId: string,
  item: { recipe_id?: string | null; ingredient_id?: string | null; free_text?: string | null; amount_g?: number | null },
): PlanItem {
  // The UI promises that synthetic demo content never enters real records.
  // Enforce that here rather than in each picker, so no screen can breach it:
  // a plan item becomes a feeding snapshot, which becomes the day summary.
  assertNotSynthetic(db, 'recipes', item.recipe_id ?? null);
  assertNotSynthetic(db, 'ingredients', item.ingredient_id ?? null);
  const id = newId('plan');
  const amount = item.amount_g ?? null;
  db.run(
    'INSERT INTO plan_items (id, meal_slot_id, recipe_id, ingredient_id, free_text, amount_g, amount_unknown, created_at, status) VALUES (?,?,?,?,?,?,?,?,?)',
    [
      id,
      slotId,
      item.recipe_id ?? null,
      item.ingredient_id ?? null,
      item.free_text ?? null,
      amount,
      amount === null ? 1 : 0,
      new Date().toISOString(),
      'active',
    ],
  );
  return db.get<PlanItem>('SELECT * FROM plan_items WHERE id = ?', [id])!;
}

export function removePlanItem(db: SqlDriver, itemId: string): void {
  db.run("UPDATE plan_items SET status = 'removed' WHERE id = ?", [itemId]);
}

export function copySlotsFrom(db: SqlDriver, babyId: string, fromDate: string, toDate: string): number {
  const slots = listSlots(db, babyId, fromDate);
  let created = 0;
  db.transaction(() => {
    for (const s of slots) {
      const slot = createSlot(db, babyId, toDate, s.label, s.planned_time);
      for (const it of s.items) {
        addPlanItem(db, slot.id, {
          recipe_id: it.recipe_id,
          ingredient_id: it.ingredient_id,
          free_text: it.free_text,
          amount_g: it.amount_unknown ? null : it.amount_g,
        });
      }
      created += 1;
    }
  });
  return created;
}

/**
 * Freezes the portion actually offered. Called when the caregiver opens the
 * "record what was eaten" sheet, pre-filled from the plan so nothing has to be
 * typed twice — but the result is an independent immutable copy.
 */
export function snapshotFromSlot(db: SqlDriver, slotId: string): ServedSnapshot {
  const items = listPlanItems(db, slotId);
  const out: ServedSnapshotItem[] = [];
  const recipeIds: string[] = [];
  const recipeVersions: Record<string, string> = {};
  const packVersions: Record<string, string> = {};

  for (const it of items) {
    if (it.recipe_id) {
      const recipe = db.get<Recipe>('SELECT * FROM recipes WHERE id = ?', [it.recipe_id]);
      if (recipe) {
        recipeIds.push(recipe.id);
        recipeVersions[recipe.id] = recipe.recipe_version;
        packVersions[recipe.id] = recipe.pack_version;
        const ris = db.all<{ ingredient_id: string; amount_g: number | null; amount_unknown: number; name_zh: string }>(
          `SELECT ri.ingredient_id, ri.amount_g, ri.amount_unknown, i.name_zh
           FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
           WHERE ri.recipe_id = ?`,
          [recipe.id],
        );
        for (const ri of ris) {
          out.push({
            ingredient_id: ri.ingredient_id,
            free_text: null,
            label: ri.name_zh,
            recipe_id: recipe.id,
            amount_g: ri.amount_unknown ? null : ri.amount_g,
            amount_unknown: !!ri.amount_unknown,
          });
        }
        continue;
      }
    }
    out.push({
      ingredient_id: it.ingredient_id,
      free_text: it.free_text,
      label: it.display_name,
      recipe_id: null,
      amount_g: it.amount_unknown ? null : it.amount_g,
      amount_unknown: !!it.amount_unknown,
    });
  }

  return {
    items: out,
    recipe_ids: recipeIds,
    recipe_versions: recipeVersions,
    pack_versions: packVersions,
    captured_at: new Date().toISOString(),
  };
}

export { SyntheticContentError } from './synthetic';
