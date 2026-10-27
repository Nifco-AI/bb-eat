import { SqlDriver } from '../db/driver';
import { createNodeDriver } from '../db/nodeDriver';
import { migrate } from '../db/migrations';
import { loadPacks } from '../data/loadPacks';
import { ensureBaby, updateBaby } from '../domain/repositories/babies';
import { Baby } from '../domain/types';

/** A fully migrated, pack-loaded in-memory database for tests. */
export function freshDb(): { db: SqlDriver; baby: Baby } {
  const db = createNodeDriver(':memory:');
  migrate(db);
  loadPacks(db);
  const baby = ensureBaby(db);
  return { db, baby };
}

export function babyWithProfile(
  db: SqlDriver,
  baby: Baby,
  opts: { birth_date?: string; sex?: 'male' | 'female'; timezone?: string } = {},
): Baby {
  return updateBaby(db, baby.id, {
    birth_date: opts.birth_date ?? '2025-06-15',
    sex: opts.sex ?? 'female',
    timezone: opts.timezone ?? 'Asia/Shanghai',
    name: '测试宝宝',
  })!;
}

export const TZ = 'Asia/Shanghai';

export function at(iso: string): Date {
  return new Date(iso);
}
