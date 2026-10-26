import { SqlDriver } from '../db/driver';
import { SCHEMA_VERSION } from '../db/migrations';
import { sha256Hex } from './sha256';
import { PACK_VERSIONS } from '../data/loadPacks';

export const BACKUP_FORMAT = 'bbeat.backup';
/**
 * v1 → v2 bumped when `pack_versions` joined the checksum payload and when
 * `inventory_items` gained `baby_id`/`free_text`. Both changes alter how a file
 * must be read, so a v1 file verified with v2 rules would fail its checksum and
 * be reported to the caregiver as corrupt when it is merely older. v1 is still
 * accepted and upgraded on restore.
 */
export const BACKUP_FORMAT_VERSION = 2;

/**
 * Only caregiver-entered data is exported.
 *
 * Knowledge packs (ingredients, recipes, WHO reference, sources) are shipped
 * inside the app and are rebuilt on restore, so they are deliberately left out:
 * a backup must never be able to downgrade or tamper with reference data.
 */
export const USER_TABLES = [
  'babies',
  'app_settings',
  'inventory_items',
  'avoid_list',
  'meal_slots',
  'plan_items',
  'feeding_events',
  'feeding_event_ingredients',
  'liquid_events',
  'exposure_events',
  'symptom_observations',
  'caregiver_suspicions',
  'reported_clinical_notes',
  'growth_measurements',
  'audit_log',
] as const;

export type UserTable = (typeof USER_TABLES)[number];

export interface BackupFile {
  format: string;
  format_version: number;
  schema_version: number;
  app_version: string;
  pack_versions: Record<string, string>;
  exported_at: string;
  row_counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
  checksum: string;
}

export interface BackupSummary {
  exported_at: string;
  app_version: string;
  schema_version: number;
  babies: { id: string; name: string | null; birth_date: string | null }[];
  row_counts: Record<string, number>;
  total_rows: number;
  earliest_record: string | null;
  latest_record: string | null;
}

export type RejectReason =
  | 'not_json'
  | 'not_a_bbeat_backup'
  | 'format_version_unsupported'
  | 'schema_version_newer'
  | 'checksum_missing'
  | 'checksum_mismatch'
  | 'tables_missing'
  | 'row_count_mismatch'
  | 'unknown_table';

export const REJECT_MESSAGES: Record<RejectReason, string> = {
  not_json: '文件不是有效的 JSON，无法读取。原有数据未改动。',
  not_a_bbeat_backup: '这不是 BB-Eat 的备份文件。原有数据未改动。',
  format_version_unsupported: '备份文件版本高于当前应用支持的版本，请先升级应用。原有数据未改动。',
  schema_version_newer: '备份来自更新版本的应用，当前版本无法安全读取。原有数据未改动。',
  checksum_missing: '备份文件缺少校验值，无法确认完整性。原有数据未改动。',
  checksum_mismatch: '备份文件校验失败，可能已损坏或被修改。原有数据未改动。',
  tables_missing: '备份文件结构不完整，缺少必要的数据表。原有数据未改动。',
  row_count_mismatch: '备份文件内容与其自身记录的条数不一致，可能已被截断。原有数据未改动。',
  unknown_table: '备份文件包含当前版本无法识别的数据表。原有数据未改动。',
};

export class BackupRejected extends Error {
  constructor(
    readonly reason: RejectReason,
    readonly detail?: string,
  ) {
    super(REJECT_MESSAGES[reason]);
  }
}

/**
 * Stable serialisation: keys sorted, so the same data always produces the same
 * checksum regardless of column order returned by SQLite.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

function payloadFor(file: Omit<BackupFile, 'checksum'>): string {
  // Every field of the file is covered, so no part of a backup can be edited
  // without invalidating the checksum. v1 files were written before
  // `pack_versions` was covered, so they must be verified with the payload
  // shape that was actually signed — otherwise an intact old backup is
  // misreported as corrupt.
  const legacy = file.format_version < 2;
  return canonical({
    format: file.format,
    format_version: file.format_version,
    schema_version: file.schema_version,
    app_version: file.app_version,
    exported_at: file.exported_at,
    ...(legacy ? {} : { pack_versions: file.pack_versions }),
    row_counts: file.row_counts,
    tables: file.tables,
  });
}

export function exportBackup(db: SqlDriver, appVersion: string, now: Date = new Date()): BackupFile {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const row_counts: Record<string, number> = {};
  for (const table of USER_TABLES) {
    const rows = db.all<Record<string, unknown>>(`SELECT * FROM ${table}`);
    tables[table] = rows;
    row_counts[table] = rows.length;
  }
  const base = {
    format: BACKUP_FORMAT,
    format_version: BACKUP_FORMAT_VERSION,
    schema_version: SCHEMA_VERSION,
    app_version: appVersion,
    pack_versions: { ...PACK_VERSIONS },
    exported_at: now.toISOString(),
    row_counts,
    tables,
  };
  return { ...base, checksum: sha256Hex(payloadFor(base)) };
}

export function serialiseBackup(file: BackupFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * Parses and fully validates a backup without touching the database.
 * Every rejection path happens here, so a restore can never half-apply.
 */
export function inspectBackup(text: string): { file: BackupFile; summary: BackupSummary } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupRejected('not_json');
  }
  if (!parsed || typeof parsed !== 'object') throw new BackupRejected('not_a_bbeat_backup');
  const file = parsed as Partial<BackupFile>;
  if (file.format !== BACKUP_FORMAT) throw new BackupRejected('not_a_bbeat_backup');
  if (typeof file.format_version !== 'number' || file.format_version > BACKUP_FORMAT_VERSION) {
    throw new BackupRejected('format_version_unsupported');
  }
  if (typeof file.schema_version !== 'number' || file.schema_version > SCHEMA_VERSION) {
    throw new BackupRejected('schema_version_newer');
  }
  if (typeof file.checksum !== 'string' || file.checksum.length !== 64) {
    throw new BackupRejected('checksum_missing');
  }
  if (!file.tables || typeof file.tables !== 'object' || !file.row_counts) {
    throw new BackupRejected('tables_missing');
  }
  for (const name of Object.keys(file.tables)) {
    if (!(USER_TABLES as readonly string[]).includes(name)) {
      throw new BackupRejected('unknown_table', name);
    }
  }
  for (const table of USER_TABLES) {
    if (!Array.isArray(file.tables[table])) throw new BackupRejected('tables_missing', table);
    if (file.row_counts[table] !== file.tables[table].length) {
      throw new BackupRejected('row_count_mismatch', table);
    }
  }

  const expected = sha256Hex(
    payloadFor({
      format: file.format,
      format_version: file.format_version,
      schema_version: file.schema_version,
      app_version: file.app_version ?? '',
      pack_versions: file.pack_versions ?? {},
      exported_at: file.exported_at ?? '',
      row_counts: file.row_counts,
      tables: file.tables,
    }),
  );
  if (expected !== file.checksum) throw new BackupRejected('checksum_mismatch');

  return { file: file as BackupFile, summary: summarise(file as BackupFile) };
}

function summarise(file: BackupFile): BackupSummary {
  const dates: string[] = [];
  for (const table of USER_TABLES) {
    for (const row of file.tables[table] ?? []) {
      const d = (row as Record<string, unknown>).occurred_local_date;
      if (typeof d === 'string') dates.push(d);
    }
  }
  dates.sort();
  return {
    exported_at: file.exported_at,
    app_version: file.app_version,
    schema_version: file.schema_version,
    babies: (file.tables.babies ?? []).map((b) => ({
      id: String(b.id),
      name: (b.name as string) ?? null,
      birth_date: (b.birth_date as string) ?? null,
    })),
    row_counts: file.row_counts,
    total_rows: Object.values(file.row_counts).reduce((a, b) => a + b, 0),
    earliest_record: dates[0] ?? null,
    latest_record: dates[dates.length - 1] ?? null,
  };
}

export interface RestoreReport {
  mode: 'replace';
  restored: Record<string, number>;
  total_rows: number;
}

/**
 * Brings a row from an older backup format up to the current schema.
 *
 * v1 `inventory_items` had no `baby_id`, which the current schema declares NOT
 * NULL. Inserting such a row raw throws a bare SQL error that the caregiver
 * would see as unexplained failure, so the single baby in the same backup is
 * adopted as the owner. If the backup has no baby to attribute them to the row
 * is left as-is and rejected below — guessing an owner would be worse.
 */
function upgradeRow(
  file: BackupFile,
  table: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (file.format_version >= 2 || table !== 'inventory_items' || 'baby_id' in row) return row;
  const babies = file.tables.babies ?? [];
  if (babies.length !== 1) return row;
  return { ...row, baby_id: babies[0].id, created_at: row.created_at ?? row.updated_at ?? null };
}

/**
 * Replaces caregiver data with the backup's contents, atomically.
 *
 * The caller is responsible for showing `inspectBackup`'s summary and getting
 * an explicit confirmation first: this function does not prompt. If anything
 * fails mid-way the transaction rolls back and the existing data survives.
 */
export function restoreBackup(db: SqlDriver, text: string): RestoreReport {
  const { file } = inspectBackup(text);

  return db.transaction(() => {
    db.exec('PRAGMA defer_foreign_keys = ON');
    for (const table of [...USER_TABLES].reverse()) {
      db.run(`DELETE FROM ${table}`);
    }
    const restored: Record<string, number> = {};
    for (const table of USER_TABLES) {
      const rows = (file.tables[table] ?? []).map((row) => upgradeRow(file, table, row));
      const columns = db.all<{ name: string }>(`PRAGMA table_info(${table})`).map((c) => c.name);
      let n = 0;
      for (const row of rows) {
        const cols = columns.filter((c) => c in row);
        if (cols.length === 0) continue;
        db.run(
          `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
          cols.map((c) => (row as Record<string, unknown>)[c] as never),
        );
        n += 1;
      }
      restored[table] = n;
    }
    return {
      mode: 'replace' as const,
      restored,
      total_rows: Object.values(restored).reduce((a, b) => a + b, 0),
    };
  });
}
