"""Step 3 of 3: merge data/netflix-latest.json (ranking) with data/tmdb-cache.json (metadata) into ranks/*.json.

Writes ranks/<cc>.json for every country Netflix publishes, ranks/world.json and ranks/index.json.
The shape is described in schema/ranks.schema.json. Works without TMDb data: those titles keep `tmdb: null`.
Standard library only.
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_tmdb import cache_key  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
NETFLIX = ROOT / "data" / "netflix-latest.json"
CACHE = ROOT / "data" / "tmdb-cache.json"
OUT = ROOT / "ranks"
SCHEMA = 1
TMDB_FIELDS = ("id", "mediaType", "title", "originalTitle", "year", "genreIds", "rating", "voteCount", "posterPath", "runtime", "seasons", "overview", "titles", "trailers", "confidence")


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def country_codes():
    return re.findall(r"\['([a-z]{2})','\d{3}'", (ROOT / "data.js").read_text(encoding="utf-8"))


def presence(netflix):
    """Where each title ranked this week: a Top 10 spot proves the title is on Netflix in that country."""
    seen = {}
    for cc, block in netflix["countries"].items():
        for kind in ("tv", "film"):
            for row in block[kind]:
                seen.setdefault(cache_key(kind, row["title"]), set()).add(cc)
    return seen


def make_entry(kind, row, items, seen):
    key = cache_key(kind, row["title"])
    hit = items.get(key)
    tmdb = {f: hit[f] for f in TMDB_FIELDS if f in hit} if hit and hit.get("status") == "matched" else None
    countries = set(seen.get(key, ()))
    if tmdb:
        countries |= set(hit.get("netflixCountries", []))
    netflix = {k: v for k, v in row.items() if k != "rank"}
    return {
        "rank": row["rank"],
        "type": kind,
        "netflix": netflix,
        "tmdb": tmdb,
        "availability": {"netflixCountries": sorted(countries)},
    }


def validate(doc):
    for kind in ("tv", "film"):
        rows = doc["lists"][kind]
        if [r["rank"] for r in rows] != list(range(1, len(rows) + 1)):
            raise ValueError(f"{doc.get('country') or 'world'} {kind}: ranks are not 1..n")
        for r in rows:
            if r["type"] != kind or not r["netflix"].get("title"):
                raise ValueError(f"{doc.get('country') or 'world'} {kind}: malformed entry")


def write_if_changed(path, doc):
    """`updatedAt` is carried over when nothing else changed, so unchanged runs leave no diff."""
    if path.exists():
        old = json.loads(path.read_text(encoding="utf-8"))
        if {k: v for k, v in old.items() if k != "updatedAt"} == {k: v for k, v in doc.items() if k != "updatedAt"}:
            return False
    path.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return True


def main():
    netflix = json.loads(NETFLIX.read_text(encoding="utf-8"))
    items = json.loads(CACHE.read_text(encoding="utf-8"))["items"] if CACHE.exists() else {}
    seen = presence(netflix)
    stamp = now()
    matched = total = written = 0

    def document(scope, country, week, blocks):
        nonlocal matched, total
        lists = {kind: [make_entry(kind, row, items, seen) for row in blocks[kind]] for kind in ("tv", "film")}
        for rows in lists.values():
            total += len(rows)
            matched += sum(1 for r in rows if r["tmdb"])
        doc = {
            "schema": SCHEMA,
            "scope": scope,
            "country": country,
            "week": week,
            "updatedAt": stamp,
            "sources": {
                "netflix": {**netflix["source"], "week": week, "fetchedAt": netflix["fetchedAt"]},
                "tmdb": {"name": "TMDb", "url": "https://www.themoviedb.org"},
            },
            "lists": lists,
        }
        validate(doc)
        return doc

    OUT.mkdir(exist_ok=True)
    for cc, block in sorted(netflix["countries"].items()):
        written += write_if_changed(OUT / f"{cc}.json", document("country", cc, netflix["week"], block))
    written += write_if_changed(OUT / "world.json", document("world", None, netflix["worldWeek"], netflix["world"]))

    known = sorted(set(country_codes()) | set(netflix["countries"]))
    index = {
        "schema": SCHEMA,
        "week": netflix["week"],
        "updatedAt": stamp,
        "countries": {cc: "available" if cc in netflix["countries"] else "unavailable" for cc in known},
        "world": "available",
        "tmdb": {"matched": matched, "total": total},
    }
    write_if_changed(OUT / "index.json", index)
    print(f"week={netflix['week']} countries={len(netflix['countries'])} written={written} tmdb={matched}/{total}")


if __name__ == "__main__":
    main()
