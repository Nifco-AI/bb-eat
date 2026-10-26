#!/usr/bin/env python3
"""Parse WHO Child Growth Standards expanded z-score tables into a JSON pack.

Input : the four official .xlsx files downloaded from cdn.who.int
Output: app/src/data/packs/growth-who-2006.json

Only the L, M, S parameters and the published SD columns are read. The SD
columns are used purely to self-check our own LMS implementation against WHO's
own published numbers; nothing is interpolated or invented.
"""
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def read_sheet(path: Path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        import xml.etree.ElementTree as ET

        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall(f"{NS}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))

    import xml.etree.ElementTree as ET

    root = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for row in root.iter(f"{NS}row"):
        cells = {}
        for c in row.findall(f"{NS}c"):
            ref = c.get("r") or ""
            col = re.sub(r"\d", "", ref)
            v = c.find(f"{NS}v")
            if v is None or v.text is None:
                continue
            if c.get("t") == "s":
                cells[col] = shared[int(v.text)]
            else:
                cells[col] = v.text
        if cells:
            rows.append(cells)
    return rows


def col_index(letters: str) -> int:
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def to_table(rows):
    header_row = None
    for r in rows:
        vals = {k: str(v).strip().lower() for k, v in r.items()}
        if any(v in ("day", "month", "age") for v in vals.values()) and any(v == "l" for v in vals.values()):
            header_row = r
            break
    if header_row is None:
        raise SystemExit("header row with Day/L/M/S not found")

    headers = {}
    for col, val in header_row.items():
        headers[str(val).strip().lower()] = col

    age_col = headers.get("day") or headers.get("month") or headers.get("age")
    age_unit = "day" if "day" in headers else "month"
    out = []
    started = False
    for r in rows:
        if r is header_row:
            started = True
            continue
        if not started:
            continue
        try:
            age = float(r[age_col])
            l = float(r[headers["l"]])
            m = float(r[headers["m"]])
            s = float(r[headers["s"]])
        except (KeyError, ValueError):
            continue
        rec = {"age": age, "l": l, "m": m, "s": s, "unit": age_unit}
        for sd_name in ("sd3neg", "sd2neg", "sd0", "sd2", "sd3"):
            if sd_name in headers and headers[sd_name] in r:
                try:
                    rec[sd_name] = float(r[headers[sd_name]])
                except ValueError:
                    pass
        out.append(rec)
    return out, age_unit, sorted(headers.keys())


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


FILES = {
    ("weight_for_age", "male"): (
        "wfa-boys-zscore-expanded-tables.xlsx",
        "https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/weight-for-age/expanded-tables/wfa-boys-zscore-expanded-tables.xlsx",
    ),
    ("weight_for_age", "female"): (
        "wfa-girls-zscore-expanded-tables.xlsx",
        "https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/weight-for-age/expanded-tables/wfa-girls-zscore-expanded-tables.xlsx",
    ),
    ("length_for_age", "male"): (
        "lhfa-boys-zscore-expanded-tables.xlsx",
        "https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/length-height-for-age/expandable-tables/lhfa-boys-zscore-expanded-tables.xlsx",
    ),
    ("length_for_age", "female"): (
        "lhfa-girls-zscore-expanded-tables.xlsx",
        "https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/length-height-for-age/expandable-tables/lhfa-girls-zscore-expanded-tables.xlsx",
    ),
}

# The app only needs 0-36 months; keep the pack small but keep real rows only.
MAX_AGE_DAYS = 1157


def main():
    src_dir = Path(sys.argv[1])
    out_path = Path(sys.argv[2])
    retrieved = sys.argv[3]

    pack = {
        "pack_id": "growth-who-2006",
        "kind": "growth",
        "version": "WHO-CGS-2006.r1",
        "retrieved_at": retrieved,
        "age_unit": "day",
        "age_range_days": [0, MAX_AGE_DAYS],
        "files": [],
        "rows": [],
        "verification": {},
    }

    checks = []
    for (indicator, sex), (fname, url) in FILES.items():
        p = src_dir / fname
        rows, unit, headers = to_table(read_sheet(p))
        pack["files"].append(
            {
                "indicator": indicator,
                "sex": sex,
                "file": fname,
                "source_url": url,
                "sha256": sha256(p),
                "bytes": p.stat().st_size,
                "age_unit": unit,
                "columns_seen": headers,
                "rows_in_file": len(rows),
            }
        )
        kept = 0
        for r in rows:
            age_days = int(round(r["age"])) if unit == "day" else int(round(r["age"] * 30.4375))
            if age_days > MAX_AGE_DAYS:
                continue
            pack["rows"].append(
                [indicator, sex, age_days, round(r["l"], 6), round(r["m"], 6), round(r["s"], 6)]
            )
            kept += 1
            if "sd0" in r and "sd2" in r and "sd2neg" in r:
                checks.append(
                    {
                        "indicator": indicator,
                        "sex": sex,
                        "age_days": age_days,
                        "l": r["l"],
                        "m": r["m"],
                        "s": r["s"],
                        "sd0": r["sd0"],
                        "sd2neg": r["sd2neg"],
                        "sd2": r["sd2"],
                        "sd3neg": r.get("sd3neg"),
                        "sd3": r.get("sd3"),
                    }
                )
        print(f"{indicator}/{sex}: file rows={len(rows)} kept={kept} unit={unit} cols={headers}")

    # Keep a spread of WHO's own published SD values as regression fixtures.
    step = max(1, len(checks) // 60)
    pack["verification"]["who_published_sd_fixtures"] = checks[::step][:60]
    pack["verification"]["fixture_note"] = (
        "Each fixture is a row of WHO's own expanded table. Our LMS implementation "
        "must reproduce sd0/sd2neg/sd2 from L,M,S within 0.01 of WHO's printed value."
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(pack, ensure_ascii=False, separators=(",", ":")))
    print(f"wrote {out_path} rows={len(pack['rows'])} fixtures={len(pack['verification']['who_published_sd_fixtures'])}")


if __name__ == "__main__":
    main()
