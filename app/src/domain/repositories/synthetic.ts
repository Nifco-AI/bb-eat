import { SqlDriver } from '../../db/driver';

export type SyntheticTable = 'recipes' | 'ingredients';

export class SyntheticContentError extends Error {
  constructor(public readonly table: SyntheticTable, public readonly rowId: string) {
    super('演示用的合成内容不能加入真实的计划或记录。');
    this.name = 'SyntheticContentError';
  }
}

/**
 * Fail-closed guard: synthetic demo rows exist only to show the interface when
 * there is nothing real to show. They carry no evidence, so letting one reach a
 * real record would put fabricated content into a caregiver's feeding history,
 * day summary or avoid list.
 *
 * This lives in the data layer on purpose. Filtering the pickers is necessary
 * but not sufficient: a picker is one screen, while the promise in
 * docs/DATA_QUALITY.md and on the demo-mode toggle is about every record. Any
 * future write path that accepts an ingredient or recipe id must call this, so
 * the guard is applied at each repository entry point rather than once at a UI
 * boundary that a new screen could simply bypass.
 */
export function assertNotSynthetic(
  db: SqlDriver,
  table: SyntheticTable,
  rowId: string | null | undefined,
): void {
  if (!rowId) return;
  const row = db.get<{ is_synthetic: number }>(`SELECT is_synthetic FROM ${table} WHERE id = ?`, [
    rowId,
  ]);
  if (row && row.is_synthetic) throw new SyntheticContentError(table, rowId);
}
