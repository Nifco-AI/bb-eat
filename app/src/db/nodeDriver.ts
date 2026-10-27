import Database from 'better-sqlite3';
import { SqlDriver, SqlError } from './driver';

/**
 * better-sqlite3 driver used by the Node test suite.
 *
 * It executes exactly the same SQL strings the Android build sends to
 * expo-sqlite, so migrations and queries are genuinely exercised rather than
 * mocked.
 */
export function createNodeDriver(file = ':memory:'): SqlDriver {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  let depth = 0;

  return {
    exec(sql) {
      try {
        db.exec(sql);
      } catch (e) {
        throw new SqlError(String(e), sql);
      }
    },
    run(sql, params = []) {
      try {
        db.prepare(sql).run(...(params as never[]));
      } catch (e) {
        throw new SqlError(String(e), sql);
      }
    },
    all<T>(sql: string, params: unknown[] = []) {
      try {
        return db.prepare(sql).all(...(params as never[])) as T[];
      } catch (e) {
        throw new SqlError(String(e), sql);
      }
    },
    get<T>(sql: string, params: unknown[] = []) {
      try {
        return db.prepare(sql).get(...(params as never[])) as T | undefined;
      } catch (e) {
        throw new SqlError(String(e), sql);
      }
    },
    transaction<T>(fn: () => T): T {
      if (depth > 0) return fn();
      depth += 1;
      db.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        db.exec('COMMIT');
        return out;
      } catch (e) {
        try {
          db.exec('ROLLBACK');
        } catch {
          /* best effort */
        }
        throw e;
      } finally {
        depth -= 1;
      }
    },
    close() {
      db.close();
    },
  };
}
