import { SqlDriver } from '../db/driver';
import { shiftLocalDate } from './time';
import { ExposureEvent, LiquidEvent, LIQUID_LABELS, LiquidKind } from './types';

/**
 * Day / week / month review.
 *
 * Every number carries its own coverage statement. Unknown is never folded
 * into zero, plans are never counted as intake, and nothing is estimated from
 * a total that was not actually measured.
 */

export interface LiquidSummary {
  kind: LiquidKind;
  label: string;
  events: number;
  known_events: number;
  unknown_events: number;
  known_total_ml: number;
  /** True when at least one event had no amount, so the total is a floor. */
  has_unknown: boolean;
}

export interface FoodSummary {
  feeding_events: number;
  /** Distinct ingredients the baby actually ate or was offered and ate some of. */
  eaten_ingredient_ids: string[];
  /** Offered but intake explicitly 0 or recorded as not eaten. */
  offered_not_eaten_ingredient_ids: string[];
  /** Offered, but whether any was eaten is unknown. */
  offered_unknown_ingredient_ids: string[];
  intake_unknown_events: number;
  intake_none_events: number;
}

export interface DaySummary {
  local_date: string;
  liquids: LiquidSummary[];
  food: FoodSummary;
  exposures: ExposureEvent[];
  symptom_count: number;
  planned_slots: number;
  slots_with_feeding: number;
  coverage_notes: string[];
}

const LIQUID_KINDS: LiquidKind[] = ['breastmilk', 'formula', 'water', 'other'];

/**
 * Every liquid kind is always returned, including kinds with no record at all.
 * Callers must be able to distinguish "no record" (events = 0) from a
 * confirmed zero and from an unknown amount; dropping empty kinds here would
 * silently merge the first two. Hiding empty rows is a presentation choice.
 */
export function summariseLiquids(events: LiquidEvent[]): LiquidSummary[] {
  return LIQUID_KINDS.map((kind) => {
    const of = events.filter((e) => e.kind === kind);
    const known = of.filter((e) => !e.amount_unknown && e.amount_ml !== null);
    return {
      kind,
      label: LIQUID_LABELS[kind],
      events: of.length,
      known_events: known.length,
      unknown_events: of.length - known.length,
      known_total_ml: known.reduce((a, e) => a + (e.amount_ml ?? 0), 0),
      has_unknown: of.length - known.length > 0,
    };
  });
}

export function daySummary(db: SqlDriver, babyId: string, localDate: string): DaySummary {
  const liquidEvents = db.all<LiquidEvent>(
    "SELECT * FROM liquid_events WHERE baby_id = ? AND occurred_local_date = ? AND status = 'active'",
    [babyId, localDate],
  );
  const liquids = summariseLiquids(liquidEvents);

  const feedings = db.all<{
    id: string;
    intake_mode: string;
    intake_ratio: number | null;
    intake_amount_g: number | null;
  }>(
    'SELECT id, intake_mode, intake_ratio, intake_amount_g FROM feeding_events ' +
      "WHERE baby_id = ? AND occurred_local_date = ? AND status = 'active'",
    [babyId, localDate],
  );

  const eaten = new Set<string>();
  const notEaten = new Set<string>();
  const unknown = new Set<string>();

  for (const f of feedings) {
    const rows = db.all<{ ingredient_id: string | null; intake_amount_g: number | null; intake_known: number }>(
      'SELECT ingredient_id, intake_amount_g, intake_known FROM feeding_event_ingredients WHERE feeding_event_id = ?',
      [f.id],
    );
    for (const r of rows) {
      if (!r.ingredient_id) continue;
      if (r.intake_known) {
        // The caregiver stated this ingredient's intake explicitly.
        if ((r.intake_amount_g ?? 0) > 0) eaten.add(r.ingredient_id);
        else notEaten.add(r.ingredient_id);
        continue;
      }
      // No per-ingredient figure. A whole-portion figure describes the bowl,
      // not any single ingredient inside it.
      //  - 'none' / a stated zero portion: nothing in the bowl was eaten, so
      //    every ingredient is a known not-eaten.
      //  - a positive portion on a SINGLE-ingredient meal: the bowl figure is
      //    unambiguously that ingredient's figure.
      //  - a positive portion on a MIXED meal: the baby ate some of the bowl,
      //    but which ingredients reached the mouth is genuinely unknown. We
      //    must not apportion it (U04), and "ate half the bowl" is not
      //    evidence that any particular ingredient was tasted.
      //  - a NULL figure under mode 'ratio'/'absolute': the mode claims a
      //    figure exists but none was stored. `recordFeeding` rejects this, but
      //    a restored or foreign backup can still contain it, and treating a
      //    missing number as zero would silently turn an unknown into a known
      //    not-eaten. Unknown is the only safe reading.
      const portionIsZero =
        (f.intake_mode === 'ratio' && f.intake_ratio !== null && f.intake_ratio <= 0) ||
        (f.intake_mode === 'absolute' && f.intake_amount_g !== null && f.intake_amount_g <= 0);
      const portionIsMissing =
        (f.intake_mode === 'ratio' && f.intake_ratio === null) ||
        (f.intake_mode === 'absolute' && f.intake_amount_g === null);

      if (f.intake_mode === 'none' || portionIsZero) notEaten.add(r.ingredient_id);
      else if (
        (f.intake_mode === 'ratio' || f.intake_mode === 'absolute') &&
        !portionIsMissing &&
        rows.length === 1
      )
        eaten.add(r.ingredient_id);
      else unknown.add(r.ingredient_id);
    }
  }
  for (const id of eaten) {
    notEaten.delete(id);
    unknown.delete(id);
  }
  for (const id of notEaten) unknown.delete(id);

  const exposures = db.all<ExposureEvent>(
    "SELECT * FROM exposure_events WHERE baby_id = ? AND occurred_local_date = ? AND status = 'active' ORDER BY occurred_at",
    [babyId, localDate],
  );
  const symptom_count =
    db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM symptom_observations WHERE baby_id = ? AND occurred_local_date = ? AND status = 'active'",
      [babyId, localDate],
    )?.n ?? 0;

  const planned_slots =
    db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM meal_slots WHERE baby_id = ? AND local_date = ? AND status = 'active'",
      [babyId, localDate],
    )?.n ?? 0;
  const slots_with_feeding =
    db.get<{ n: number }>(
      `SELECT COUNT(DISTINCT meal_slot_id) AS n FROM feeding_events
       WHERE baby_id = ? AND occurred_local_date = ? AND status = 'active' AND meal_slot_id IS NOT NULL`,
      [babyId, localDate],
    )?.n ?? 0;

  const notes: string[] = [];
  const unknownLiquid = liquids.filter((l) => l.has_unknown);
  if (unknownLiquid.length > 0) {
    notes.push(
      `${unknownLiquid.map((l) => l.label).join('、')}有 ${unknownLiquid.reduce((a, l) => a + l.unknown_events, 0)} 次未记录数量，合计 mL 只是已知部分的下限。`,
    );
  }
  const unknownIntake = feedings.filter((f) => f.intake_mode === 'unknown').length;
  if (unknownIntake > 0) notes.push(`${unknownIntake} 次喂食未记录吃下多少，未计入「已吃」判断。`);
  if (unknown.size > 0) notes.push(`${unknown.size} 种食材只知道已提供，是否吃下未知。`);
  if (planned_slots > slots_with_feeding) {
    notes.push(`${planned_slots - slots_with_feeding} 餐有计划但还没有实际记录；计划不计为已吃。`);
  }
  if (feedings.length === 0 && liquidEvents.length === 0) notes.push('今天还没有任何实际记录。');

  return {
    local_date: localDate,
    liquids,
    food: {
      feeding_events: feedings.length,
      eaten_ingredient_ids: [...eaten],
      offered_not_eaten_ingredient_ids: [...notEaten],
      offered_unknown_ingredient_ids: [...unknown],
      intake_unknown_events: unknownIntake,
      intake_none_events: feedings.filter((f) => f.intake_mode === 'none').length,
    },
    exposures,
    symptom_count,
    planned_slots,
    slots_with_feeding,
    coverage_notes: notes,
  };
}

export interface RangeSummary {
  from: string;
  to: string;
  days: number;
  days_with_any_record: number;
  liquids: LiquidSummary[];
  distinct_eaten_ingredients: number;
  distinct_eaten_food_groups: number;
  feeding_events: number;
  symptom_count: number;
  coverage_notes: string[];
}

export function rangeSummary(db: SqlDriver, babyId: string, toDate: string, days: number): RangeSummary {
  const from = shiftLocalDate(toDate, -(days - 1));
  const liquidEvents = db.all<LiquidEvent>(
    `SELECT * FROM liquid_events WHERE baby_id = ? AND occurred_local_date BETWEEN ? AND ? AND status = 'active'`,
    [babyId, from, toDate],
  );

  // Diversity must use exactly the same evidence rule as the daily summary:
  // an explicit positive per-ingredient figure, or a positive whole-portion
  // figure on a meal that contained only this one ingredient. A mixed-bowl
  // ratio is never apportioned, and a stated zero is never "eaten".
  const eatenRows = db.all<{ ingredient_id: string; food_group: string }>(
    `SELECT DISTINCT fei.ingredient_id, i.food_group
     FROM feeding_events fe
     JOIN feeding_event_ingredients fei ON fei.feeding_event_id = fe.id
     JOIN ingredients i ON i.id = fei.ingredient_id
     WHERE fe.baby_id = ? AND fe.occurred_local_date BETWEEN ? AND ? AND fe.status = 'active'
       AND fei.ingredient_id IS NOT NULL
       AND ( (fei.intake_known = 1 AND fei.intake_amount_g > 0)
             OR ( fei.intake_known = 0
                  AND ( (fe.intake_mode = 'ratio' AND COALESCE(fe.intake_ratio, 0) > 0)
                        OR (fe.intake_mode = 'absolute' AND COALESCE(fe.intake_amount_g, 0) > 0) )
                  AND (SELECT COUNT(*) FROM feeding_event_ingredients x
                       WHERE x.feeding_event_id = fe.id) = 1 ) )`,
    [babyId, from, toDate],
  );

  const feeding_events =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM feeding_events WHERE baby_id = ? AND occurred_local_date BETWEEN ? AND ? AND status = 'active'`,
      [babyId, from, toDate],
    )?.n ?? 0;
  const symptom_count =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM symptom_observations WHERE baby_id = ? AND occurred_local_date BETWEEN ? AND ? AND status = 'active'`,
      [babyId, from, toDate],
    )?.n ?? 0;

  const daysWithRecord =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (
         SELECT occurred_local_date FROM feeding_events WHERE baby_id = ? AND occurred_local_date BETWEEN ? AND ? AND status = 'active'
         UNION
         SELECT occurred_local_date FROM liquid_events WHERE baby_id = ? AND occurred_local_date BETWEEN ? AND ? AND status = 'active'
         UNION
         SELECT occurred_local_date FROM exposure_events WHERE baby_id = ? AND occurred_local_date BETWEEN ? AND ? AND status = 'active'
       )`,
      [babyId, from, toDate, babyId, from, toDate, babyId, from, toDate],
    )?.n ?? 0;

  const liquids = summariseLiquids(liquidEvents);
  const notes: string[] = [];
  if (daysWithRecord < days) {
    notes.push(`${days} 天中有 ${days - daysWithRecord} 天没有任何记录，下列汇总只覆盖有记录的 ${daysWithRecord} 天。`);
  }
  if (liquids.some((l) => l.has_unknown)) notes.push('部分奶/水没有数量，总量是已知部分的下限，不是真实总摄入。');
  notes.push('食材多样性只统计有实际摄入证据的记录；只是计划或只提供未确认的不计入。');

  return {
    from,
    to: toDate,
    days,
    days_with_any_record: daysWithRecord,
    liquids,
    distinct_eaten_ingredients: eatenRows.length,
    distinct_eaten_food_groups: new Set(eatenRows.map((r) => r.food_group)).size,
    feeding_events,
    symptom_count,
    coverage_notes: notes,
  };
}

/**
 * Energy estimation is deliberately refused unless every precondition holds.
 * In this build no licensed composition table matched to our ingredient IDs is
 * bundled, so this always returns a reason rather than a number.
 */
export interface EnergyEstimate {
  ok: false;
  reason: string;
  missing: string[];
}

export function estimateEnergy(db: SqlDriver, babyId: string, localDate: string): EnergyEstimate {
  const missing: string[] = [];
  const nutritionRows = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM nutrition_values')?.n ?? 0;
  if (nutritionRows === 0) missing.push('没有内置具备合法再分发许可、且已匹配到本应用食材 ID 的食物成分表');

  const unknownAmounts =
    db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM feeding_events fe
       JOIN feeding_event_ingredients fei ON fei.feeding_event_id = fe.id
       WHERE fe.baby_id = ? AND fe.occurred_local_date = ? AND fe.status = 'active'
         AND fei.intake_known = 0`,
      [babyId, localDate],
    )?.n ?? 0;
  if (unknownAmounts > 0) missing.push(`${unknownAmounts} 项食材没有确切吃下克数`);
  missing.push('缺少每项食物的生熟状态与可食部比例核验');

  return {
    ok: false,
    reason: '无法可靠估算热量',
    missing,
  };
}
