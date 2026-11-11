"""Approximate Disney+ ranking for data/disney-latest.json (needs the TMDb credential).

Disney+ publishes no ranking, so this is a proxy: per country, the most popular (TMDb popularity) titles that are
streaming on Disney+ there and premiered recently (first air / release date). The window starts at 90 days and widens to 180 and 365 days until the
list has 10 titles. World = titles that appear most widely and highly across countries. Standard library only.

Refreshes at most weekly; pass --force to ignore the age check.
"""
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_tmdb  # noqa: E402

ROOT = fetch_tmdb.ROOT
OUT = ROOT / "data" / "disney-latest.json"
PROVIDER = fetch_tmdb.PROVIDERS["disney"]
WINDOWS = (90, 180, 365)
MIN_CATALOG = 100  # TMDb lists a handful of Disney+ titles in places where it has not launched
SIZE = 10
REFRESH_AFTER = timedelta(days=7)


def region_codes():
    return re.findall(r"\['([a-z]{2})','\d{3}'", (ROOT / "data.js").read_text(encoding="utf-8"))


def discover(kind, cc, since=None):
    params = {
        "watch_region": cc.upper(), "with_watch_providers": PROVIDER, "with_watch_monetization_types": "flatrate",
        "sort_by": "popularity.desc", "include_adult": "false", "language": "en-US", "page": 1,
    }
    if since:
        today = date.today().isoformat()
        field = "first_air_date" if kind == "tv" else "primary_release_date"
        params[f"{field}.gte"], params[f"{field}.lte"] = since, today
    return fetch_tmdb.request(f"/discover/{fetch_tmdb.media(kind)}", **params) or {}


def rows(results):
    return [{"rank": i + 1, "id": r["id"], "title": r.get("name") or r.get("title"), "popularity": round(r.get("popularity", 0), 1)}
            for i, r in enumerate(results[:SIZE])]


def top(kind, cc):
    for days in WINDOWS:
        results = discover(kind, cc, (date.today() - timedelta(days=days)).isoformat()).get("results", [])
        if len(results) >= SIZE or days == WINDOWS[-1]:
            return days, rows(results)


def country(cc):
    if discover("tv", cc).get("total_results", 0) < MIN_CATALOG:
        return cc, None
    block, windows = {}, {}
    for kind in ("tv", "film"):
        windows[kind], block[kind] = top(kind, cc)
    return cc, {"windowDays": windows, **block}


def world(countries):
    result = {"windowDays": {}, "tv": [], "film": []}
    for kind in ("tv", "film"):
        score, titles, seen = {}, {}, {}
        for block in countries.values():
            for row in block[kind]:
                score[row["id"]] = score.get(row["id"], 0) + SIZE + 1 - row["rank"]
                seen[row["id"]] = seen.get(row["id"], 0) + 1
                titles[row["id"]] = (row["title"], max(row["popularity"], titles.get(row["id"], ("", 0))[1]))
        ordered = sorted(score, key=lambda i: (-score[i], -titles[i][1]))[:SIZE]
        result[kind] = [{"rank": n + 1, "id": i, "title": titles[i][0], "popularity": titles[i][1], "regions": seen[i]} for n, i in enumerate(ordered)]
        result["windowDays"][kind] = max(block["windowDays"][kind] for block in countries.values())
    return result


def main():
    if not (fetch_tmdb.TOKEN or fetch_tmdb.KEY):
        print("TMDB_API_KEY / TMDB_READ_TOKEN not set; skipping Disney+ step")
        return
    if OUT.exists() and "--force" not in sys.argv:
        age = datetime.now(timezone.utc) - datetime.fromisoformat(json.loads(OUT.read_text(encoding="utf-8"))["fetchedAt"].replace("Z", "+00:00"))
        if age < REFRESH_AFTER:
            print(f"disney snapshot is {age.days} day(s) old; skipping")
            return
    countries = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for cc, block in pool.map(country, region_codes()):
            if block:
                countries[cc] = block
    if len(countries) < 20:
        sys.exit(f"only {len(countries)} countries have a Disney+ catalog; refusing to overwrite the previous snapshot")
    payload = {
        "schema": 1,
        "source": {"name": "TMDb popularity (Disney+)", "url": "https://www.themoviedb.org"},
        "provider": PROVIDER,
        "countries": dict(sorted(countries.items())),
        "world": world(countries),
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"disney countries={len(countries)}")


if __name__ == "__main__":
    main()
