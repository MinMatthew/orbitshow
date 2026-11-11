"""Step 3 of 3: merge each service's ranking with data/tmdb-cache.json (metadata) into ranks/.

Netflix  -> ranks/<cc>.json, ranks/world.json, ranks/index.json         (data/netflix-latest.json)
Disney+  -> ranks/disney/<cc>.json, ranks/disney/world.json, ranks/disney/index.json  (data/disney-latest.json)
The shape is described in schema/ranks.schema.json. Works without TMDb data: those titles keep `tmdb: null`.
Standard library only.
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_tmdb import cache_key, id_key  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "tmdb-cache.json"
OUT = ROOT / "ranks"
SCHEMA = 1
KINDS = ("tv", "film")
TMDB_FIELDS = ("id", "mediaType", "title", "originalTitle", "originalLanguage", "year", "genreIds", "rating", "voteCount", "posterPath", "runtime", "seasons", "overview", "titles", "trailers", "confidence")


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def country_codes():
    return re.findall(r"\['([a-z]{2})','\d{3}'", (ROOT / "data.js").read_text(encoding="utf-8"))


def lookup_key(service, kind, row):
    return cache_key(kind, row["title"]) if service == "netflix" else id_key(kind, row["id"])


def presence(service, blocks):
    """Where each title ranked: a spot in a country's list is itself proof that the service carries it there."""
    seen = {}
    for cc, block in blocks.items():
        for kind in KINDS:
            for row in block[kind]:
                seen.setdefault(lookup_key(service, kind, row), set()).add(cc)
    return seen


def make_entry(service, kind, row, items, seen):
    key = lookup_key(service, kind, row)
    hit = items.get(key)
    tmdb = {f: hit[f] for f in TMDB_FIELDS if f in hit} if hit and hit.get("status") == "matched" else None
    countries = set(seen.get(key, ()))
    if tmdb:
        countries |= set(hit.get("streaming", {}).get(service, []))
    return {
        "rank": row["rank"],
        "type": kind,
        "listing": {k: v for k, v in row.items() if k not in ("rank", "id")},
        "tmdb": tmdb,
        "availability": {"countries": sorted(countries)},
    }


def validate(doc):
    where = doc.get("country") or "world"
    for kind in KINDS:
        rows = doc["lists"][kind]
        if [r["rank"] for r in rows] != list(range(1, len(rows) + 1)):
            raise ValueError(f"{doc['service']} {where} {kind}: ranks are not 1..n")
        for r in rows:
            if r["type"] != kind or not r["listing"].get("title"):
                raise ValueError(f"{doc['service']} {where} {kind}: malformed entry")


def write_if_changed(path, doc):
    """`updatedAt` is carried over when nothing else changed, so unchanged runs leave no diff."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        old = json.loads(path.read_text(encoding="utf-8"))
        if {k: v for k, v in old.items() if k != "updatedAt"} == {k: v for k, v in doc.items() if k != "updatedAt"}:
            return False
    path.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return True


def publish(service, out, snapshot, items, week, stamp):
    """Writes one service's files; `snapshot` is its latest.json."""
    seen = presence(service, snapshot["countries"])
    counts = {"matched": 0, "total": 0, "written": 0}
    source = {**snapshot["source"], "week": week, "fetchedAt": snapshot["fetchedAt"]}

    def document(scope, country, block, basis, week=week):
        lists = {kind: [make_entry(service, kind, row, items, seen) for row in block[kind]] for kind in KINDS}
        for rows in lists.values():
            counts["total"] += len(rows)
            counts["matched"] += sum(1 for r in rows if r["tmdb"])
        doc = {
            "schema": SCHEMA, "service": service, "scope": scope, "country": country, "week": week, "updatedAt": stamp,
            "basis": basis,
            "sources": {service: source, "tmdb": {"name": "TMDb", "url": "https://www.themoviedb.org"}},
            "lists": lists,
        }
        validate(doc)
        return doc

    def basis_of(block):
        if service == "netflix":
            return {"method": "netflix-top10"}
        return {"method": "tmdb-popularity", "windowDays": block["windowDays"]}

    for cc, block in sorted(snapshot["countries"].items()):
        counts["written"] += write_if_changed(out / f"{cc}.json", document("country", cc, block, basis_of(block)))
    world = snapshot["world"]
    counts["written"] += write_if_changed(out / "world.json", document("world", None, world, basis_of(world), snapshot.get("worldWeek", week)))

    known = sorted(set(country_codes()) | set(snapshot["countries"]))
    index = {
        "schema": SCHEMA, "service": service, "week": week, "updatedAt": stamp,
        "countries": {cc: "available" if cc in snapshot["countries"] else "unavailable" for cc in known},
        "world": "available",
        "tmdb": {"matched": counts["matched"], "total": counts["total"]},
    }
    write_if_changed(out / "index.json", index)
    print(f"{service}: week={week} countries={len(snapshot['countries'])} written={counts['written']} tmdb={counts['matched']}/{counts['total']}")


def main():
    items = json.loads(CACHE.read_text(encoding="utf-8"))["items"] if CACHE.exists() else {}
    stamp = now()
    netflix = json.loads((ROOT / "data" / "netflix-latest.json").read_text(encoding="utf-8"))
    publish("netflix", OUT, netflix, items, netflix["week"], stamp)
    disney_path = ROOT / "data" / "disney-latest.json"
    if disney_path.exists():
        disney = json.loads(disney_path.read_text(encoding="utf-8"))
        publish("disney", OUT / "disney", disney, items, disney["fetchedAt"][:10], stamp)


if __name__ == "__main__":
    main()
