import { SqlDriver } from '../db/driver';

/**
 * WHO Child Growth Standards reference lookup.
 *
 * Everything in here is *gated*. Percentiles and z-scores are only produced
 * when the loaded reference pack is marked verified AND the baby's sex, birth
 * date and (for length/height) measurement method are known. Otherwise the
 * caller receives a structured "cannot compute" reason and the UI shows the
 * raw measurements only.
 */

export interface LmsRow {
  l: number;
  m: number;
  s: number;
  age_days: number;
}

export type GrowthIndicator = 'weight_for_age' | 'length_for_age';

export type ZScoreFailure =
  | 'reference_not_loaded'
  | 'reference_not_verified'
  | 'sex_unknown'
  | 'birth_date_unknown'
  | 'age_out_of_range'
  | 'measurement_method_unknown'
  | 'measurement_method_mismatch';

export interface ZScoreResult {
  ok: true;
  z: number;
  percentile: number;
  l: number;
  m: number;
  s: number;
  age_days: number;
  pack_version: string;
}

export interface ZScoreBlocked {
  ok: false;
  reason: ZScoreFailure;
  message: string;
}

export const BLOCK_MESSAGES: Record<ZScoreFailure, string> = {
  reference_not_loaded: '未内置已核验的 WHO 生长标准数据，无法计算参考分位。',
  reference_not_verified: 'WHO 生长标准数据尚未通过核验，仅显示实测值。',
  sex_unknown: '未填写宝宝性别，WHO 参考按男/女分别建立，无法计算。',
  birth_date_unknown: '未填写出生日期，无法确定月龄，无法计算。',
  age_out_of_range: '该月龄超出已内置 WHO 参考表范围。',
  measurement_method_unknown: '未记录测量方式（卧位/立位），身长与身高参考口径不同，无法计算。',
  measurement_method_mismatch:
    'WHO 对该月龄使用的测量口径与本次记录的测量方式不一致（<24 月龄用卧位身长，≥24 月龄用立位身高），直接比较会产生系统性偏差，因此不计算。',
};

/**
 * Standard normal CDF via the Abramowitz & Stegun 7.1.26 rational
 * approximation of erf (|error| < 1.5e-7). That is far finer than the
 * percentile precision we display, but it is an approximation, not an exact
 * value.
 */
export function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * WHO LMS / Box-Cox transformation.
 *
 *   Z = ((X/M)^L - 1) / (L * S)        for L != 0
 *   Z = ln(X/M) / S                    for L == 0
 *
 * WHO additionally applies a flat adjustment beyond +/-3 SD for weight-based
 * indicators, because the distribution tails are not well described by the
 * Box-Cox model there (WHO Child Growth Standards, Chapter 7 "Computation of
 * centiles and z-scores").
 */
export function lmsZScore(x: number, l: number, m: number, s: number, applyTailAdjustment: boolean): number {
  const raw = l === 0 ? Math.log(x / m) / s : (Math.pow(x / m, l) - 1) / (l * s);
  if (!applyTailAdjustment || Math.abs(raw) <= 3) return raw;

  if (raw > 3) {
    const sd3pos = valueAtZ(3, l, m, s);
    const sd2pos = valueAtZ(2, l, m, s);
    const sd23 = sd3pos - sd2pos;
    return 3 + (x - sd3pos) / sd23;
  }
  const sd3neg = valueAtZ(-3, l, m, s);
  const sd2neg = valueAtZ(-2, l, m, s);
  const sd23 = sd2neg - sd3neg;
  return -3 + (x - sd3neg) / sd23;
}

/** Inverse of the LMS transform: the measurement at a given z-score. */
export function valueAtZ(z: number, l: number, m: number, s: number): number {
  return l === 0 ? m * Math.exp(s * z) : m * Math.pow(1 + l * s * z, 1 / l);
}

export function referencePackVersion(db: SqlDriver): string | null {
  const row = db.get<{ version: string }>("SELECT version FROM knowledge_packs WHERE kind = 'growth' LIMIT 1");
  return row?.version ?? null;
}

export function referenceIsVerified(db: SqlDriver): boolean {
  const row = db.get<{ review_status: string }>(
    "SELECT review_status FROM sources WHERE id = 'who_growth_standards_2006'",
  );
  if (!row) return false;
  // 'machine_validated' means the official table was downloaded, parsed and the
  // published worked examples reproduced. That is enough to show a WHO-labelled
  // reference curve; it is explicitly NOT a clinical interpretation.
  return row.review_status === 'machine_validated' || row.review_status === 'expert_reviewed';
}

function nearestRow(db: SqlDriver, indicator: GrowthIndicator, sex: string, ageDays: number): LmsRow | undefined {
  return db.get<LmsRow>(
    `SELECT l, m, s, age_days FROM growth_reference
     WHERE indicator = ? AND sex = ?
     ORDER BY ABS(age_days - ?) LIMIT 1`,
    [indicator, sex, ageDays],
  );
}

export interface ZScoreRequest {
  indicator: GrowthIndicator;
  sex: string;
  ageDays: number | null;
  value: number;
  /** Required for length_for_age: WHO uses recumbent length <24m, standing height >=24m. */
  method?: string | null;
}

export function computeZScore(db: SqlDriver, req: ZScoreRequest): ZScoreResult | ZScoreBlocked {
  const version = referencePackVersion(db);
  const count = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM growth_reference')?.n ?? 0;
  if (!version || count === 0) return blocked('reference_not_loaded');
  if (!referenceIsVerified(db)) return blocked('reference_not_verified');
  if (req.sex !== 'male' && req.sex !== 'female') return blocked('sex_unknown');
  if (req.ageDays === null) return blocked('birth_date_unknown');

  // Around the 24-month boundary the length/height definition changes, so an
  // unrecorded measurement method makes the comparison unsound.
  if (req.indicator === 'length_for_age') {
    const expected = req.ageDays < 731 ? 'lying' : 'standing';
    if (!req.method || req.method === 'unknown') return blocked('measurement_method_unknown');
    if (req.method !== expected) return blocked('measurement_method_mismatch');
  }

  // The WHO tables are daily and complete, so the only reason a row can be
  // "near" rather than exact is that the requested age falls outside the
  // published range. Never silently reuse the last row for an older child:
  // that would quietly extrapolate beyond the standard.
  const bounds = db.get<{ lo: number; hi: number }>(
    'SELECT MIN(age_days) AS lo, MAX(age_days) AS hi FROM growth_reference WHERE indicator = ? AND sex = ?',
    [req.indicator, req.sex],
  );
  if (!bounds || bounds.lo === null || req.ageDays < bounds.lo || req.ageDays > bounds.hi) {
    return blocked('age_out_of_range');
  }

  const row = nearestRow(db, req.indicator, req.sex, req.ageDays);
  if (!row) return blocked('age_out_of_range');
  if (Math.abs(row.age_days - req.ageDays) > 1) return blocked('age_out_of_range');

  const z = lmsZScore(req.value, row.l, row.m, row.s, req.indicator === 'weight_for_age');
  return {
    ok: true,
    z,
    percentile: normalCdf(z) * 100,
    l: row.l,
    m: row.m,
    s: row.s,
    age_days: row.age_days,
    pack_version: version,
  };
}

function blocked(reason: ZScoreFailure): ZScoreBlocked {
  return { ok: false, reason, message: BLOCK_MESSAGES[reason] };
}

export interface ReferenceBand {
  age_days: number;
  median: number;
  sd2neg: number;
  sd2pos: number;
}

/** Median and +/-2 SD band for drawing, only when the pack is verified. */
export function referenceBand(
  db: SqlDriver,
  indicator: GrowthIndicator,
  sex: string,
  fromDays: number,
  toDays: number,
): ReferenceBand[] | null {
  if (!referenceIsVerified(db)) return null;
  if (sex !== 'male' && sex !== 'female') return null;
  const rows = db.all<LmsRow>(
    `SELECT l, m, s, age_days FROM growth_reference
     WHERE indicator = ? AND sex = ? AND age_days BETWEEN ? AND ?
     ORDER BY age_days`,
    [indicator, sex, fromDays, toDays],
  );
  if (rows.length === 0) return null;
  return rows.map((r) => ({
    age_days: r.age_days,
    median: r.m,
    sd2neg: valueAtZ(-2, r.l, r.m, r.s),
    sd2pos: valueAtZ(2, r.l, r.m, r.s),
  }));
}
