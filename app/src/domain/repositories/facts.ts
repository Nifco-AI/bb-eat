import { SqlDriver } from '../../db/driver';
import { newId } from '../ids';

/**
 * Shared behaviour for every user-recorded fact table.
 *
 * Corrections are *append-only*: revising a fact marks the old row
 * `superseded` and writes a new `active` row that points back at it.
 * Undo marks the row `undone`. Nothing is ever deleted, so the audit trail
 * and any future sync can always reconstruct what the caregiver actually did.
 */
export const FACT_TABLES = [
  'feeding_events',
  'liquid_events',
  'exposure_events',
  'symptom_observations',
  'caregiver_suspicions',
  'reported_clinical_notes',
  'growth_measurements',
] as const;

export type FactTable = (typeof FACT_TABLES)[number];

export function audit(
  db: SqlDriver,
  entity: string,
  entityId: string,
  action: 'create' | 'revise' | 'undo' | 'restore',
  detail?: unknown,
): void {
  db.run('INSERT INTO audit_log (id, entity, entity_id, action, at, detail_json) VALUES (?,?,?,?,?,?)', [
    newId('aud'),
    entity,
    entityId,
    action,
    new Date().toISOString(),
    detail === undefined ? null : JSON.stringify(detail),
  ]);
}

/** Returns the existing row id if this exact operation was already recorded. */
export function findByOpId(db: SqlDriver, table: FactTable, opId: string): string | null {
  const row = db.get<{ id: string }>(`SELECT id FROM ${table} WHERE client_op_id = ?`, [opId]);
  return row?.id ?? null;
}

export function undoFact(db: SqlDriver, table: FactTable, id: string): boolean {
  return db.transaction(() => {
    const row = db.get<{ status: string }>(`SELECT status FROM ${table} WHERE id = ?`, [id]);
    if (!row || row.status !== 'active') return false;
    db.run(`UPDATE ${table} SET status = 'undone' WHERE id = ?`, [id]);
    audit(db, table, id, 'undo');
    return true;
  });
}

export function restoreFact(db: SqlDriver, table: FactTable, id: string): boolean {
  return db.transaction(() => {
    const row = db.get<{ status: string }>(`SELECT status FROM ${table} WHERE id = ?`, [id]);
    if (!row || row.status !== 'undone') return false;
    db.run(`UPDATE ${table} SET status = 'active' WHERE id = ?`, [id]);
    audit(db, table, id, 'restore');
    return true;
  });
}

/**
 * Revise an active fact. Copies the row, applies `changes`, bumps `revision`,
 * links `supersedes_id`, and marks the original `superseded`.
 */
export function reviseFact(
  db: SqlDriver,
  table: FactTable,
  idPrefix: string,
  id: string,
  changes: Record<string, unknown>,
): string | null {
  return db.transaction(() => {
    const current = db.get<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    if (!current || current.status !== 'active') return null;

    const next: Record<string, unknown> = { ...current, ...changes };
    const newRowId = newId(idPrefix);
    next.id = newRowId;
    next.revision = Number(current.revision ?? 1) + 1;
    next.status = 'active';
    next.supersedes_id = id;
    next.recorded_at = new Date().toISOString();
    next.client_op_id = `${String(current.client_op_id)}#r${next.revision}`;

    const cols = Object.keys(next);
    db.run(
      `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
      cols.map((c) => next[c] as unknown),
    );
    db.run(`UPDATE ${table} SET status = 'superseded' WHERE id = ?`, [id]);
    audit(db, table, newRowId, 'revise', { from: id, changes });
    return newRowId;
  });
}

export function revisionChain(db: SqlDriver, table: FactTable, id: string): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  let cursor: string | null = id;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const row: Record<string, unknown> | undefined = db.get(`SELECT * FROM ${table} WHERE id = ?`, [cursor]);
    if (!row) break;
    chain.push(row);
    cursor = (row.supersedes_id as string | null) ?? null;
  }
  return chain;
}
