import { freshDb, babyWithProfile, TZ } from './helpers';
import { createSlot, addPlanItem, snapshotFromSlot, listSlots, removeSlot } from '../domain/repositories/meals';
import {
  recordFeeding,
  reviseIntake,
  getFeeding,
  listFeedings,
  FeedingValidationError,
} from '../domain/repositories/feeding';
import { undoFact, revisionChain } from '../domain/repositories/facts';
import { daySummary } from '../domain/summary';

function setup() {
  const { db, baby: raw } = freshDb();
  const baby = babyWithProfile(db, raw);
  const slot = createSlot(db, baby.id, '2026-03-10', '午餐', '12:00');
  return { db, baby, slot };
}

describe('U03 planned is not eaten', () => {
  it('a plan alone produces no feeding fact', () => {
    const { db, baby, slot } = setup();
    addPlanItem(db, slot.id, { ingredient_id: 'veg_pumpkin' });
    expect(listFeedings(db, baby.id, '2026-03-10')).toHaveLength(0);
    const s = daySummary(db, baby.id, '2026-03-10');
    expect(s.planned_slots).toBe(1);
    expect(s.slots_with_feeding).toBe(0);
    expect(s.food.eaten_ingredient_ids).toEqual([]);
    expect(s.coverage_notes.join()).toContain('计划不计为已吃');
  });

  it('the served snapshot is prefilled from the plan so nothing is typed twice', () => {
    const { db, slot } = setup();
    addPlanItem(db, slot.id, { recipe_id: 'rcp_pork_veg_congee' });
    const snap = snapshotFromSlot(db, slot.id);
    expect(snap.items.map((i) => i.ingredient_id).sort()).toEqual([
      'grain_rice',
      'meat_pork_lean',
      'veg_spinach',
    ]);
    expect(snap.recipe_versions['rcp_pork_veg_congee']).toBe('1');
  });

  it('editing or deleting the plan afterwards never rewrites recorded history', () => {
    const { db, baby, slot } = setup();
    addPlanItem(db, slot.id, { ingredient_id: 'veg_pumpkin' });
    const snap = snapshotFromSlot(db, slot.id);
    const fed = recordFeeding(db, {
      babyId: baby.id,
      mealSlotId: slot.id,
      mealLabel: '午餐',
      occurredAt: new Date('2026-03-10T04:00:00Z'),
      timezone: TZ,
      snapshot: snap,
      intakeMode: 'ratio',
      intakeRatio: 0.5,
    });

    removeSlot(db, slot.id);
    expect(listSlots(db, baby.id, '2026-03-10')).toHaveLength(0);

    const after = getFeeding(db, fed.id)!;
    expect(after.snapshot.items[0].ingredient_id).toBe('veg_pumpkin');
    expect(after.intake_ratio).toBe(0.5);
  });
});

describe('U04 boundary data stays distinct', () => {
  it('a mixed 80 g portion eaten 50% is never apportioned to each ingredient', () => {
    const { db, baby, slot } = setup();
    addPlanItem(db, slot.id, { ingredient_id: 'veg_carrot', amount_g: 40 });
    addPlanItem(db, slot.id, { ingredient_id: 'grain_rice', amount_g: 40 });
    const snap = snapshotFromSlot(db, slot.id);

    const fed = recordFeeding(db, {
      babyId: baby.id,
      mealSlotId: slot.id,
      mealLabel: '午餐',
      occurredAt: new Date('2026-03-10T04:00:00Z'),
      timezone: TZ,
      snapshot: snap,
      intakeMode: 'ratio',
      intakeRatio: 0.5,
    });

    const detail = getFeeding(db, fed.id)!;
    // Served amounts are known; per-ingredient *intake* is not, and stays null.
    expect(detail.ingredients.map((i) => i.served_amount_g).sort()).toEqual([40, 40]);
    for (const ing of detail.ingredients) {
      expect(ing.intake_known).toBe(0);
      expect(ing.intake_amount_g).toBeNull();
    }
  });

  it('only an explicitly stated per-ingredient amount is stored as known', () => {
    const { db, baby, slot } = setup();
    addPlanItem(db, slot.id, { ingredient_id: 'veg_carrot', amount_g: 40 });
    addPlanItem(db, slot.id, { ingredient_id: 'grain_rice', amount_g: 40 });
    const snap = snapshotFromSlot(db, slot.id);

    const fed = recordFeeding(db, {
      babyId: baby.id,
      mealSlotId: slot.id,
      mealLabel: '午餐',
      occurredAt: new Date('2026-03-10T04:00:00Z'),
      timezone: TZ,
      snapshot: snap,
      intakeMode: 'unknown',
      perIngredientIntake: [{ ingredient_id: 'veg_carrot', free_text: null, intake_amount_g: 12 }],
    });

    const detail = getFeeding(db, fed.id)!;
    const carrot = detail.ingredients.find((i) => i.ingredient_id === 'veg_carrot')!;
    const rice = detail.ingredients.find((i) => i.ingredient_id === 'grain_rice')!;
    expect(carrot.intake_known).toBe(1);
    expect(carrot.intake_amount_g).toBe(12);
    expect(rice.intake_known).toBe(0);
    expect(rice.intake_amount_g).toBeNull();
  });

  it('confirmed zero, unknown and not-recorded are three different states', () => {
    const { db, baby } = setup();
    const mk = (label: string, mode: 'none' | 'unknown' | 'ratio', ratio?: number) => {
      const slot = createSlot(db, baby.id, '2026-03-11', label);
      addPlanItem(db, slot.id, { ingredient_id: 'fruit_apple' });
      return recordFeeding(db, {
        babyId: baby.id,
        mealSlotId: slot.id,
        mealLabel: label,
        occurredAt: new Date('2026-03-11T04:00:00Z'),
        timezone: TZ,
        snapshot: snapshotFromSlot(db, slot.id),
        intakeMode: mode,
        intakeRatio: ratio ?? null,
      });
    };
    const zero = mk('早餐', 'none');
    const unknown = mk('午餐', 'unknown');
    const eaten = mk('晚餐', 'ratio', 0.3);

    expect(zero.intake_mode).toBe('none');
    expect(zero.intake_ratio).toBeNull();
    expect(unknown.intake_mode).toBe('unknown');
    expect(eaten.intake_ratio).toBe(0.3);

    // An apple eaten once counts as eaten; the zero and unknown rows must not
    // cancel that, and must not themselves create an "eaten" claim.
    const s = daySummary(db, baby.id, '2026-03-11');
    expect(s.food.eaten_ingredient_ids).toEqual(['fruit_apple']);
    expect(s.food.intake_none_events).toBe(1);
    expect(s.food.intake_unknown_events).toBe(1);
  });

  it('rejects an out-of-range ratio instead of silently clamping', () => {
    const { db, baby, slot } = setup();
    addPlanItem(db, slot.id, { ingredient_id: 'fruit_apple' });
    expect(() =>
      recordFeeding(db, {
        babyId: baby.id,
        mealSlotId: slot.id,
        mealLabel: '午餐',
        occurredAt: new Date('2026-03-10T04:00:00Z'),
        timezone: TZ,
        snapshot: snapshotFromSlot(db, slot.id),
        intakeMode: 'ratio',
        intakeRatio: 1.8,
      }),
    ).toThrow(FeedingValidationError);
  });
});

describe('corrections and undo', () => {
  it('revising intake keeps the original served snapshot and the full chain', () => {
    const { db, baby, slot } = setup();
    addPlanItem(db, slot.id, { ingredient_id: 'veg_pumpkin', amount_g: 50 });
    const original = recordFeeding(db, {
      babyId: baby.id,
      mealSlotId: slot.id,
      mealLabel: '午餐',
      occurredAt: new Date('2026-03-10T04:00:00Z'),
      timezone: TZ,
      snapshot: snapshotFromSlot(db, slot.id),
      intakeMode: 'ratio',
      intakeRatio: 0.25,
    });

    const revised = reviseIntake(db, original.id, { intakeMode: 'absolute', intakeAmountG: 30 })!;
    expect(revised.revision).toBe(2);
    expect(revised.intake_amount_g).toBe(30);
    expect(revised.intake_ratio).toBeNull();
    expect(revised.served_snapshot_json).toBe(original.served_snapshot_json);

    const stillThere = db.get<{ status: string }>('SELECT status FROM feeding_events WHERE id = ?', [original.id])!;
    expect(stillThere.status).toBe('superseded');
    expect(listFeedings(db, baby.id, '2026-03-10')).toHaveLength(1);

    const chain = revisionChain(db, 'feeding_events', revised.id);
    expect(chain).toHaveLength(2);
  });

  it('undo removes the fact from active views without deleting it', () => {
    const { db, baby, slot } = setup();
    addPlanItem(db, slot.id, { ingredient_id: 'veg_pumpkin' });
    const fed = recordFeeding(db, {
      babyId: baby.id,
      mealSlotId: slot.id,
      mealLabel: '午餐',
      occurredAt: new Date('2026-03-10T04:00:00Z'),
      timezone: TZ,
      snapshot: snapshotFromSlot(db, slot.id),
      intakeMode: 'unknown',
    });
    expect(undoFact(db, 'feeding_events', fed.id)).toBe(true);
    expect(listFeedings(db, baby.id, '2026-03-10')).toHaveLength(0);
    expect(db.get('SELECT id FROM feeding_events WHERE id = ?', [fed.id])).toBeDefined();
    expect(undoFact(db, 'feeding_events', fed.id)).toBe(false);
  });

  it('a double submission of the same action creates exactly one event', () => {
    const { db, baby, slot } = setup();
    addPlanItem(db, slot.id, { ingredient_id: 'veg_pumpkin', amount_g: 50 });
    const snap = snapshotFromSlot(db, slot.id);
    const input = {
      babyId: baby.id,
      mealSlotId: slot.id,
      mealLabel: '午餐',
      occurredAt: new Date('2026-03-10T04:00:00Z'),
      timezone: TZ,
      snapshot: snap,
      intakeMode: 'ratio' as const,
      intakeRatio: 0.5,
    };
    const a = recordFeeding(db, input);
    const b = recordFeeding(db, input);
    expect(b.id).toBe(a.id);
    expect(listFeedings(db, baby.id, '2026-03-10')).toHaveLength(1);
  });
});
