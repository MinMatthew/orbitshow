"""Step 1 of 3: download Netflix's official weekly Top 10 and keep the latest week in data/netflix-latest.json.

Sources (public, no key): https://www.netflix.com/tudum/top10
  all-weeks-countries.tsv  per-country Top 10 for TV and Films
  all-weeks-global.tsv     global Top 10 with views, split into English / Non-English
Standard library only.
"""
import csv
import io
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "netflix-latest.json"
BASE = "https://www.netflix.com/tudum/top10/data/"
COUNTRIES_URL = BASE + "all-weeks-countries.tsv"
GLOBAL_URL = BASE + "all-weeks-global.tsv"
WORLD_SIZE = 10


def rows(url):
    request = Request(url, headers={"User-Agent": "Orbitshow-ranks/1.0"})
    with urlopen(request, timeout=120) as response:
        yield from csv.DictReader(io.TextIOWrapper(response, encoding="utf-8", newline=""), delimiter="\t")


def latest_week(url, keep):
    """Streams a multi-week file and returns (week, rows of that week) without holding older weeks."""
    week, kept = "", []
    for row in rows(url):
        if row["week"] < week:
            continue
        if row["week"] > week:
            week, kept = row["week"], []
        if keep(row):
            kept.append(row)
    return week, kept


def kind(category):
    return "tv" if category.startswith("TV") else "film" if category.startswith("Films") else None


def season(text):
    return None if text in ("", "N/A") else text


def number(text):
    try:
        return float(text)
    except (TypeError, ValueError):
        return 0.0


def countries_block(data):
    result = {}
    for row in sorted(data, key=lambda r: (r["country_iso2"], r["category"], int(r["weekly_rank"]))):
        category = kind(row["category"])
        if not category or not row["country_iso2"]:
            continue
        entry = result.setdefault(row["country_iso2"].lower(), {"name": row["country_name"], "tv": [], "film": []})
        entry[category].append({
            "rank": int(row["weekly_rank"]),
            "title": row["show_title"],
            "seasonTitle": season(row["season_title"]),
            "weeksInTop10": int(number(row["cumulative_weeks_in_top_10"])),
        })
    return result


def world_block(data):
    """English and non-English lists are merged and re-ranked by views (hours when views are missing)."""
    merged = {"tv": [], "film": []}
    for row in data:
        category = kind(row["category"])
        if not category:
            continue
        merged[category].append({
            "title": row["show_title"],
            "seasonTitle": season(row["season_title"]),
            "weeksInTop10": int(number(row["cumulative_weeks_in_top_10"])),
            "hoursViewed": int(number(row["weekly_hours_viewed"])),
            "views": int(number(row["weekly_views"])),
            "english": "Non-English" not in row["category"],
        })
    for category, items in merged.items():
        items.sort(key=lambda item: (item["views"] or item["hoursViewed"]), reverse=True)
        merged[category] = [{"rank": i + 1, **item} for i, item in enumerate(items[:WORLD_SIZE])]
    return merged


def main():
    week, country_rows = latest_week(COUNTRIES_URL, lambda r: True)
    global_week, global_rows = latest_week(GLOBAL_URL, lambda r: True)
    if not country_rows:
        sys.exit("country Top 10 file was empty")
    countries = countries_block(country_rows)
    if len(countries) < 30:
        sys.exit(f"only {len(countries)} countries parsed; refusing to overwrite the previous snapshot")
    payload = {
        "schema": 1,
        "source": {"name": "Netflix Top 10", "url": "https://www.netflix.com/tudum/top10"},
        "week": week,
        "worldWeek": global_week,
        "countries": countries,
        "world": world_block(global_rows),
    }
    if OUT.exists():
        old = json.loads(OUT.read_text(encoding="utf-8"))
        if {k: v for k, v in old.items() if k != "fetchedAt"} == payload:
            print(f"week={week} unchanged")
            return
    payload["fetchedAt"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"week={week} worldWeek={global_week} countries={len(countries)}")


if __name__ == "__main__":
    main()
