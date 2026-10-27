/**
 * Minimal synchronous SQL driver abstraction.
 *
 * The same domain/repository code runs against:
 *  - expo-sqlite on the Android device (production)
 *  - better-sqlite3 in Node (integration tests)
 *
 * This guarantees the tested SQL is byte-identical to the shipped SQL.
 */
export interface SqlDriver {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): void;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | undefined;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export class SqlError extends Error {
  readonly sql: string;
  constructor(message: string, sql: string) {
    super(message);
    this.name = 'SqlError';
    this.sql = sql;
  }
}
