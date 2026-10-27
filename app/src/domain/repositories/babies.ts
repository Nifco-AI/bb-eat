import { SqlDriver } from '../../db/driver';
import { newId } from '../ids';
import { deviceTimezone } from '../time';
import { Baby, Region, Sex } from '../types';

export function getSetting(db: SqlDriver, key: string): string | null {
  return db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key])?.value ?? null;
}

export function setSetting(db: SqlDriver, key: string, value: string): void {
  db.run('INSERT INTO app_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ]);
}

export function getFlag(db: SqlDriver, key: string, fallback = false): boolean {
  const v = getSetting(db, key);
  return v === null ? fallback : v === '1';
}

export function setFlag(db: SqlDriver, key: string, value: boolean): void {
  setSetting(db, key, value ? '1' : '0');
}

/**
 * Single-baby build. The profile is intentionally skippable: a row exists so
 * facts can always be recorded, but birth_date may stay NULL, which disables
 * every age-dependent feature rather than guessing an age.
 */
export function ensureBaby(db: SqlDriver): Baby {
  const existing = db.get<Baby>("SELECT * FROM babies WHERE status = 'active' ORDER BY created_at LIMIT 1");
  if (existing) return existing;
  const now = new Date().toISOString();
  const id = newId('baby');
  db.run(
    'INSERT INTO babies (id, name, birth_date, sex, region, timezone, created_at, updated_at, status) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, null, null, 'unknown', 'CN', deviceTimezone(), now, now, 'active'],
  );
  return db.get<Baby>('SELECT * FROM babies WHERE id = ?', [id])!;
}

export function getBaby(db: SqlDriver): Baby | undefined {
  return db.get<Baby>("SELECT * FROM babies WHERE status = 'active' ORDER BY created_at LIMIT 1");
}

export interface BabyPatch {
  name?: string | null;
  birth_date?: string | null;
  sex?: Sex;
  region?: Region;
  timezone?: string;
}

export function updateBaby(db: SqlDriver, id: string, patch: BabyPatch): Baby | undefined {
  const fields = Object.keys(patch) as (keyof BabyPatch)[];
  if (fields.length === 0) return db.get<Baby>('SELECT * FROM babies WHERE id = ?', [id]);
  db.run(
    `UPDATE babies SET ${fields.map((f) => `${f} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
    [...fields.map((f) => patch[f] as unknown), new Date().toISOString(), id],
  );
  return db.get<Baby>('SELECT * FROM babies WHERE id = ?', [id]);
}

/** YYYY-MM-DD, or null when the caregiver has not entered a birth date. */
export function validateBirthDate(input: string): { ok: true; value: string } | { ok: false; error: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!m) return { ok: false, error: '请使用 YYYY-MM-DD 格式' };
  const [, y, mo, d] = m;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (
    date.getUTCFullYear() !== Number(y) ||
    date.getUTCMonth() !== Number(mo) - 1 ||
    date.getUTCDate() !== Number(d)
  ) {
    return { ok: false, error: '日期不存在' };
  }
  if (date.getTime() > Date.now() + 86400000) return { ok: false, error: '出生日期不能晚于今天' };
  if (Number(y) < 2000) return { ok: false, error: '请检查年份' };
  return { ok: true, value: `${y}-${mo}-${d}` };
}
