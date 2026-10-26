import * as SQLite from 'expo-sqlite';
import { SqlDriver, SqlError } from './driver';

/** expo-sqlite backed driver used on the device. */
export function createExpoDriver(name = 'bbeat.db'): SqlDriver {
  const db = SQLite.openDatabaseSync(name);
  db.execSync('PRAGMA journal_mode = WAL;');
  db.execSync('PRAGMA foreign_keys = ON;');

  let depth = 0;

  return {
    exec(sql) {
      try {
        db.execSync(sql);
      } catch (e) {
        throw new SqlError(String(e), sql);
      }
    },
    run(sql, params = []) {
      try {
        db.runSync(sql, params as SQLite.SQLiteBindValue[]);
      } catch (e) {
        throw new SqlError(String(e), sql);
      }
    },
    all<T>(sql: string, params: unknown[] = []) {
      try {
        return db.getAllSync<T>(sql, params as SQLite.SQLiteBindValue[]);
      } catch (e) {
        throw new SqlError(String(e), sql);
      }
    },
    get<T>(sql: string, params: unknown[] = []) {
      try {
        return db.getFirstSync<T>(sql, params as SQLite.SQLiteBindValue[]) ?? undefined;
      } catch (e) {
        throw new SqlError(String(e), sql);
      }
    },
    transaction<T>(fn: () => T): T {
      // Nested calls join the outer transaction rather than failing.
      if (depth > 0) return fn();
      depth += 1;
      db.execSync('BEGIN IMMEDIATE');
      try {
        const out = fn();
        db.execSync('COMMIT');
        return out;
      } catch (e) {
        try {
          db.execSync('ROLLBACK');
        } catch {
          /* rollback best effort */
        }
        throw e;
      } finally {
        depth -= 1;
      }
    },
    close() {
      db.closeSync();
    },
  };
}
