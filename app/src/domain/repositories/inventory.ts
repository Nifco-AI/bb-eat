import { SqlDriver } from '../../db/driver';
import { newId } from '../ids';
import { assertNotSynthetic } from './synthetic';

/**
 * Inventory and the avoid list are the two places outside meals where a
 * caregiver attaches a real ingredient id to their own data. They used to be
 * written with inline SQL from the library screen, which meant the synthetic
 * guard and the per-baby scoping lived in a component rather than in the data
 * layer, and no test could reach them. Both now go through here.
 */

export function addInventoryItem(
  db: SqlDriver,
  babyId: string,
  item: { ingredientId?: string | null; freeText?: string | null },
): string {
  const ingredientId = item.ingredientId ?? null;
  const freeText = item.freeText?.trim() || null;
  if (!ingredientId && !freeText) throw new Error('请选择或填写一种食材');
  assertNotSynthetic(db, 'ingredients', ingredientId);
  const id = newId('inv');
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO inventory_items (id, baby_id, ingredient_id, free_text, created_at, updated_at, status)
     VALUES (?,?,?,?,?,?, 'active')`,
    [id, babyId, ingredientId, freeText, now, now],
  );
  return id;
}

export function removeInventoryItem(db: SqlDriver, id: string): void {
  db.run("UPDATE inventory_items SET status = 'removed', updated_at = ? WHERE id = ?", [
    new Date().toISOString(),
    id,
  ]);
}

export function addAvoidItem(
  db: SqlDriver,
  babyId: string,
  ingredientId: string,
  reason: string | null = null,
): void {
  assertNotSynthetic(db, 'ingredients', ingredientId);
  db.run(
    `INSERT INTO avoid_list (id, baby_id, ingredient_id, reason, created_at, status)
     VALUES (?,?,?,?,?,'active')
     ON CONFLICT (baby_id, ingredient_id)
     DO UPDATE SET status = 'active', created_at = excluded.created_at`,
    [newId('avoid'), babyId, ingredientId, reason, new Date().toISOString()],
  );
}

export function removeAvoidItem(db: SqlDriver, babyId: string, ingredientId: string): void {
  db.run("UPDATE avoid_list SET status = 'removed' WHERE baby_id = ? AND ingredient_id = ?", [
    babyId,
    ingredientId,
  ]);
}

/**
 * The picker's own query, kept beside the writer so a test can execute the
 * exact SQL the screen runs. Previously this string lived inline in the
 * component, where no test, typecheck or lint could reach it.
 */
export function searchInventoryCandidates(db: SqlDriver, query: string, limit = 12) {
  const q = query.trim();
  if (!q) return [];
  // Synthetic demo rows must never become inventory: inventory feeds
  // `recommend()` and the day summary, both of which are real records.
  return db.all<{ id: string; name_zh: string; is_synthetic: number }>(
    'SELECT * FROM ingredients WHERE name_zh LIKE ? AND is_synthetic = 0 LIMIT ?',
    [`%${q}%`, limit],
  );
}
