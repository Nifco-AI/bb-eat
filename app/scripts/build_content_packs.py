#!/usr/bin/env python3
"""Generate the core ingredient and recipe packs.

Honesty rules enforced here, mechanically:

1. NO ingredient or recipe is given a numeric `min_age_months`. No first-party
   source we could actually read publishes a per-ingredient age threshold, so
   every record carries age_status = "general_principle_only" and
   min_age_months = null. The WHO general principle ("complementary foods from
   6 months") is recorded as evidence text, not converted into a per-food number.

2. Third-party claims are encoded ONLY in the restrictive direction. A
   publisher's named choking hazard or allergen becomes a risk flag; nothing a
   publisher says is ever turned into permission to feed something.

3. Anything not positively established stays "unknown", which the recommendation
   engine treats as failing, never as consent.

4. Recipe steps are written for this app. No third-party recipe prose is copied.
"""
import json
from pathlib import Path

VERSION = "2026-10-26.r1"
WHO_PRINCIPLE = (
    "WHO 一般性原则：满 6 月龄起在继续母乳喂养的基础上添加辅食（来源 who_iycf_factsheet）。"
    "该来源只给出阶段性原则，没有为单一食材规定起始月龄，因此本条目的适用月龄保持未核验。"
)

# Named choking hazards attributed to the Singapore HealthHub weaning page.
HIGH_CHOKING = {
    "nut_peanut": "整颗坚果被 HealthHub 列为噎食风险食物",
    "nut_walnut": "整颗坚果被 HealthHub 列为噎食风险食物",
    "fruit_grape": "整颗葡萄被 HealthHub 列为噎食风险食物",
    "fruit_raisin": "整颗葡萄干被 HealthHub 列为噎食风险食物",
    "veg_carrot_raw": "生胡萝卜被 HealthHub 列为噎食风险食物",
}

ALLERGEN_NOTE = (
    "常见致敏食物提示（来源 sg_healthhub_allergy）。这是提醒家长留意的标记，"
    "不是对你家宝宝是否过敏的判断，也不构成引入或回避的建议。"
)

# (id, zh, en, aliases, food_group, allergen)
ITEMS = [
    ("grain_rice", "大米", "Rice", ["稻米", "白米"], "grain", False),
    ("grain_rice_cereal_fortified", "强化铁米粉", "Iron-fortified infant rice cereal", ["婴儿米粉"], "grain", False),
    ("grain_oat", "燕麦", "Oat", ["燕麦片"], "grain", False),
    ("grain_wheat_noodle", "小麦面条", "Wheat noodle", ["面条", "挂面"], "grain", True),
    ("grain_millet", "小米", "Millet", ["粟米"], "grain", False),
    ("grain_corn", "玉米", "Corn", ["粟米", "甜玉米"], "grain", False),
    ("veg_potato", "马铃薯", "Potato", ["土豆", "洋芋"], "vegetable", False),
    ("veg_sweet_potato", "红薯", "Sweet potato", ["地瓜", "番薯"], "vegetable", False),
    ("veg_pumpkin", "南瓜", "Pumpkin", ["北瓜"], "vegetable", False),
    ("veg_carrot", "胡萝卜（熟）", "Carrot, cooked", ["红萝卜"], "vegetable", False),
    ("veg_carrot_raw", "胡萝卜（生）", "Carrot, raw", ["生胡萝卜"], "vegetable", False),
    ("veg_broccoli", "西兰花", "Broccoli", ["绿花椰菜"], "vegetable", False),
    ("veg_spinach", "菠菜", "Spinach", [], "vegetable", False),
    ("veg_bok_choy", "小白菜", "Bok choy", ["青菜"], "vegetable", False),
    ("veg_tomato", "番茄", "Tomato", ["西红柿"], "vegetable", False),
    ("veg_zucchini", "西葫芦", "Zucchini", ["夏南瓜"], "vegetable", False),
    ("veg_cauliflower", "花椰菜", "Cauliflower", ["白花菜"], "vegetable", False),
    ("veg_mushroom_shiitake", "香菇", "Shiitake mushroom", ["冬菇"], "vegetable", False),
    ("fruit_apple", "苹果", "Apple", [], "fruit", False),
    ("fruit_pear", "梨", "Pear", [], "fruit", False),
    ("fruit_banana", "香蕉", "Banana", [], "fruit", False),
    ("fruit_avocado", "牛油果", "Avocado", ["鳄梨"], "fruit", False),
    ("fruit_blueberry", "蓝莓", "Blueberry", [], "fruit", False),
    ("fruit_grape", "葡萄", "Grape", ["提子"], "fruit", False),
    ("fruit_raisin", "葡萄干", "Raisin", [], "fruit", False),
    ("fruit_papaya", "木瓜", "Papaya", [], "fruit", False),
    ("fruit_orange", "橙", "Orange", ["柳橙"], "fruit", False),
    ("meat_pork_lean", "猪瘦肉", "Pork, lean", ["猪肉"], "meat", False),
    ("meat_beef_lean", "牛瘦肉", "Beef, lean", ["牛肉"], "meat", False),
    ("meat_chicken_breast", "鸡胸肉", "Chicken breast", ["鸡肉"], "meat", False),
    ("meat_pork_liver", "猪肝", "Pork liver", ["猪肝泥"], "meat", False),
    ("fish_cod", "鳕鱼", "Cod", [], "fish", True),
    ("fish_salmon", "三文鱼", "Salmon", ["鲑鱼"], "fish", True),
    ("fish_shrimp", "虾", "Shrimp", ["虾仁"], "fish", True),
    ("egg_whole", "鸡蛋", "Egg", ["全蛋"], "egg", True),
    ("egg_yolk", "蛋黄", "Egg yolk", [], "egg", True),
    ("dairy_cheese", "奶酪", "Cheese", ["芝士"], "dairy", True),
    ("dairy_yogurt_plain", "无糖酸奶", "Plain yogurt", ["原味酸奶"], "dairy", True),
    ("legume_tofu", "豆腐", "Tofu", ["嫩豆腐"], "legume", True),
    ("legume_lentil", "小扁豆", "Lentil", ["兵豆"], "legume", False),
    ("legume_pea", "豌豆", "Green pea", ["青豆"], "legume", False),
    ("nut_peanut", "花生", "Peanut", ["落花生"], "nut_seed", True),
    ("nut_walnut", "核桃", "Walnut", [], "nut_seed", True),
    ("nut_sesame_paste", "芝麻酱", "Sesame paste", ["麻酱"], "nut_seed", True),
    ("fat_vegetable_oil", "植物油", "Vegetable oil", ["食用油"], "fat", False),
]

PREP = {
    "grain_rice": "煮至软烂，按宝宝咀嚼能力调整稠度。",
    "grain_rice_cereal_fortified": "按包装说明用温水或奶液调配，不另加糖盐。",
    "veg_carrot_raw": "生食形态质地坚硬，本应用不将其用于任何推荐。",
    "fruit_grape": "整颗形态风险较高；是否以及如何改变形态需由专业指导决定，本应用不给出切法建议。",
    "nut_peanut": "整颗形态风险较高；本应用不提供适龄处理建议。",
    "nut_walnut": "整颗形态风险较高；本应用不提供适龄处理建议。",
    "meat_pork_liver": "彻底煮熟后制成泥状；肝脏类食材的摄入频率需专业指导。",
    "egg_whole": "彻底煮熟，不使用溏心或生蛋。",
    "fish_cod": "彻底煮熟并仔细去刺。",
    "fish_salmon": "彻底煮熟并仔细去刺。",
    "fish_shrimp": "彻底煮熟并去壳去肠线。",
}


def ingredient(i):
    iid, zh, en, aliases, group, allergen = i
    choking = "high" if iid in HIGH_CHOKING else "unknown"
    return {
        "id": iid,
        "name_zh": zh,
        "name_en": en,
        "aliases": aliases,
        "food_group": group,
        "common_allergen": bool(allergen),
        "allergen_note": ALLERGEN_NOTE if allergen else None,
        "choking_risk": choking,
        "choking_note": HIGH_CHOKING.get(iid)
        or "本应用没有找到针对该食材、可溯源的噎食风险分级，因此标记为未核验。",
        "preparation_note": PREP.get(iid),
        "min_age_months": None,
        "max_age_months": None,
        "age_status": "general_principle_only",
        "age_evidence": WHO_PRINCIPLE,
        "regions": ["GLOBAL"],
        "source_id": "sg_healthhub_weaning" if iid in HIGH_CHOKING else "bbeat_editorial",
        "review_status": "transcribed",
        "is_synthetic": False,
    }


# App-authored recipes. Steps are original text written for BB-Eat.
RECIPES = [
    ("rcp_rice_congee", "软烂米粥", "Soft rice congee", "puree", 25, ["grain_rice"],
     ["大米洗净，加约 8 倍水。", "大火煮开后转小火，加盖焖煮约 20 分钟。", "搅拌至顺滑，放至温热再喂。"]),
    ("rcp_iron_cereal", "铁强化米粉糊", "Iron-fortified cereal", "puree", 5, ["grain_rice_cereal_fortified"],
     ["按包装说明量取米粉。", "用温水或温奶液边倒边搅拌。", "调至适合的稠度，不加糖盐。"]),
    ("rcp_pumpkin_puree", "南瓜泥", "Pumpkin purée", "puree", 20, ["veg_pumpkin"],
     ["南瓜去皮去籽，切块。", "蒸约 15 分钟至能用勺子轻易压碎。", "压成泥，视需要加少量温水调稀。"]),
    ("rcp_sweet_potato_puree", "红薯泥", "Sweet potato purée", "puree", 25, ["veg_sweet_potato"],
     ["红薯洗净去皮切块。", "蒸约 20 分钟至软透。", "压成泥，放至温热。"]),
    ("rcp_apple_puree", "苹果泥", "Apple purée", "puree", 15, ["fruit_apple"],
     ["苹果去皮去核切小块。", "蒸约 10 分钟至软。", "压成泥，放至温热。"]),
    ("rcp_pear_puree", "梨泥", "Pear purée", "puree", 15, ["fruit_pear"],
     ["梨去皮去核切块。", "蒸约 10 分钟。", "压成细泥。"]),
    ("rcp_banana_mash", "香蕉泥", "Banana mash", "puree", 3, ["fruit_banana"],
     ["选用成熟香蕉，剥皮。", "用叉子压成泥。", "现做现吃。"]),
    ("rcp_avocado_mash", "牛油果泥", "Avocado mash", "puree", 3, ["fruit_avocado"],
     ["牛油果对半切开去核。", "取果肉压成泥。", "现做现吃。"]),
    ("rcp_pork_puree", "猪瘦肉泥", "Pork purée", "puree", 30, ["meat_pork_lean"],
     ["猪瘦肉去筋膜，切小块。", "冷水下锅煮约 20 分钟至全熟。", "加少量煮肉汤，打成细腻肉泥。"]),
    ("rcp_chicken_puree", "鸡肉泥", "Chicken purée", "puree", 25, ["meat_chicken_breast"],
     ["鸡胸肉切块。", "蒸或煮约 15 分钟至全熟。", "加少量汤汁打成泥。"]),
    ("rcp_liver_puree", "猪肝泥", "Pork liver purée", "puree", 30, ["meat_pork_liver"],
     ["猪肝反复冲洗后切片。", "彻底煮熟，中心无血色。", "打成细泥，少量使用。"]),
    ("rcp_cod_puree", "鳕鱼泥", "Cod purée", "puree", 20, ["fish_cod"],
     ["鳕鱼解冻后仔细检查并剔除鱼刺。", "蒸约 10 分钟至全熟。", "再次检查鱼刺后压成泥。"]),
    ("rcp_egg_yolk_puree", "蛋黄泥", "Egg yolk purée", "puree", 15, ["egg_yolk"],
     ["鸡蛋冷水下锅煮约 10 分钟至全熟。", "取出蛋黄。", "加少量温水或奶液调成泥。"]),
    ("rcp_tofu_mash", "豆腐泥", "Tofu mash", "mashed", 10, ["legume_tofu"],
     ["嫩豆腐冲洗后切块。", "蒸或焯烫约 5 分钟。", "压成泥，沥去多余水分。"]),
    ("rcp_broccoli_mash", "西兰花泥", "Broccoli mash", "mashed", 15, ["veg_broccoli"],
     ["西兰花切小朵，充分洗净。", "蒸约 8 分钟至软。", "压成泥或切成细碎。"]),
    ("rcp_veg_rice_bowl", "蔬菜软饭", "Vegetable soft rice", "minced",
     30, ["grain_rice", "veg_carrot", "veg_broccoli"],
     ["大米加较多水煮成软饭。", "胡萝卜与西兰花蒸熟后切碎。", "拌入软饭中混合均匀。"]),
    ("rcp_pork_veg_congee", "猪肉蔬菜粥", "Pork and vegetable congee", "mashed",
     35, ["grain_rice", "meat_pork_lean", "veg_spinach"],
     ["大米煮成软粥。", "猪瘦肉煮熟后打成泥。", "菠菜焯烫后切细碎，与肉泥一起拌入粥中。"]),
    ("rcp_chicken_pumpkin_puree", "鸡肉南瓜泥", "Chicken and pumpkin purée", "puree",
     30, ["meat_chicken_breast", "veg_pumpkin"],
     ["鸡胸肉与南瓜分别蒸熟。", "一起打成细泥。", "视需要加少量温水调稀。"]),
    ("rcp_tofu_veg_soup", "豆腐蔬菜羹", "Tofu and vegetable soup", "mashed",
     20, ["legume_tofu", "veg_tomato", "veg_bok_choy"],
     ["番茄去皮切小块，小白菜焯烫切碎。", "加水煮软后放入豆腐块。", "略煮后压碎，放至温热。"]),
    ("rcp_oat_fruit_porridge", "燕麦水果糊", "Oat and fruit porridge", "puree",
     15, ["grain_oat", "fruit_apple"],
     ["燕麦加水煮约 10 分钟至软烂。", "苹果蒸软压泥。", "两者混合拌匀。"]),
]

RECIPE_AGE_EVIDENCE = (
    "本食谱由 BB-Eat 自行撰写，用料与做法可复现。适用月龄未核验："
    "判断一道辅食是否适龄，除食材外还需评估质地、切法、熟制程度、噎食风险与食材组合，"
    "这需要专业审核，不能由最晚引入的单一食材月龄推导。"
)


def main():
    out_dir = Path("src/data/packs")
    out_dir.mkdir(parents=True, exist_ok=True)

    ing_pack = {
        "pack_id": "ingredients-core",
        "kind": "ingredient",
        "version": VERSION,
        "note": "适用月龄一律未核验。第三方来源仅以限制方向（风险提示）编码，绝不转化为可以喂食的许可。",
        "records": [ingredient(i) for i in ITEMS],
    }
    (out_dir / "ingredients-core.json").write_text(
        json.dumps(ing_pack, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    known = {r["id"] for r in ing_pack["records"]}
    rec_records = []
    for rid, zh, en, texture, mins, ings, steps in RECIPES:
        for i in ings:
            assert i in known, f"recipe {rid} references unknown ingredient {i}"
        rec_records.append(
            {
                "id": rid,
                "recipe_version": "1",
                "name_zh": zh,
                "name_en": en,
                "texture": texture,
                "steps": steps,
                "time_cost_min": mins,
                "ingredients": [{"ingredient_id": i, "amount_g": None} for i in ings],
                "min_age_months": None,
                "age_status": "unknown",
                "age_evidence": RECIPE_AGE_EVIDENCE,
                "safety_note": "喂食全程需成人看护。食物温度、质地与分量应由照护者判断。",
                "allergen_note": "若含常见致敏食材，食材详情页会单独标注。",
                "regions": ["GLOBAL"],
                "source_id": "bbeat_editorial",
                "license_note": "做法由 BB-Eat 自行撰写，未转载受版权保护的食谱文本。",
                "review_status": "transcribed",
                "is_synthetic": False,
            }
        )

    rec_pack = {
        "pack_id": "recipes-core",
        "kind": "recipe",
        "version": VERSION,
        "note": "做法为自主撰写。所有食谱适用月龄为 unknown，因此不会进入自动推荐，只能由家长手动安排。",
        "records": rec_records,
    }
    (out_dir / "recipes-core.json").write_text(
        json.dumps(rec_pack, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    print(f"ingredients={len(ing_pack['records'])} recipes={len(rec_records)}")
    groups = {}
    for r in ing_pack["records"]:
        groups[r["food_group"]] = groups.get(r["food_group"], 0) + 1
    print("food groups:", groups)


if __name__ == "__main__":
    main()
