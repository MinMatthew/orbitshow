"""Step 2 of 3: match Netflix Top 10 titles to TMDb and keep ratings/metadata in data/tmdb-cache.json.

Kept separate from the Netflix step on purpose: the ranking never depends on TMDb being reachable, and each
title is looked up once and only its rating/availability is refreshed afterwards.

Needs a TMDb credential in TMDB_API_KEY (v3 key) or TMDB_READ_TOKEN (v4 bearer token). Without one the step is skipped.
Standard library only.
"""
import difflib
import json
import os
import re
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
NETFLIX = ROOT / "data" / "netflix-latest.json"
CACHE = ROOT / "data" / "tmdb-cache.json"
API = "https://api.themoviedb.org/3"
LANGS = ("en", "ko", "ja", "zh", "es", "fr", "de")  # keep in sync with SUPPORTED in i18n.js
NETFLIX_PROVIDER = 8
THRESHOLD = 0.86
REFRESH_AFTER = timedelta(days=7)
RETRY_UNMATCHED_AFTER = timedelta(days=14)
FORGET_AFTER = timedelta(days=60)


def load_env():
    """Local runs read the git-ignored .env written by scripts/set_tmdb_secrets.sh; CI passes real environment variables."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        name, sep, value = line.partition("=")
        if sep and name.strip() and not name.lstrip().startswith("#"):
            os.environ.setdefault(name.strip(), value.strip().strip("\"'"))


load_env()
TOKEN = os.environ.get("TMDB_READ_TOKEN", "")
KEY = os.environ.get("TMDB_API_KEY", "")


def normalize(text):
    text = unicodedata.normalize("NFKD", str(text or "")).lower().replace("&", " and ")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[\W_]+", " ", text).strip()


def cache_key(kind, title):
    return f"{kind}:{normalize(title)}"


def request(path, **params):
    headers = {"User-Agent": "Orbitshow-ranks/1.0", "Accept": "application/json"}
    if TOKEN or KEY.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {TOKEN or KEY}"
    elif KEY:
        params["api_key"] = KEY
    for attempt in range(4):
        try:
            with urlopen(Request(f"{API}{path}?{urlencode(params)}", headers=headers), timeout=20) as response:
                return json.loads(response.read(4_000_000))
        except HTTPError as error:
            if error.code == 404:
                return None
            if error.code == 429:
                time.sleep(int(error.headers.get("Retry-After", "2")) + 1)
            elif error.code >= 500:
                time.sleep(2 * (attempt + 1))
            else:
                raise
        except OSError:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"TMDb request failed: {path}")


def media(kind):
    return "tv" if kind == "tv" else "movie"


def score(result, queries):
    names = [normalize(result.get(k)) for k in ("name", "title", "original_name", "original_title") if result.get(k)]
    best = 0.0
    for query in queries:
        for name in names:
            best = max(best, 1.0 if name == query else difflib.SequenceMatcher(None, query, name).ratio())
    return best


def trailers(data):
    """Best official YouTube trailer per UI language: {lang: video id}."""
    best = {}
    for video in (data.get("videos") or {}).get("results", []):
        lang, key = video.get("iso_639_1"), video.get("key") or ""
        if video.get("site") != "YouTube" or video.get("type") != "Trailer" or lang not in LANGS or not re.fullmatch(r"[\w-]{11}", key):
            continue
        order = (bool(video.get("official")), video.get("published_at") or "")
        if lang not in best or order > best[lang][0]:
            best[lang] = (order, key)
    return {lang: key for lang, (_, key) in best.items()}


def build(kind, data, confidence, today):
    overview = {"en": data.get("overview") or ""}
    titles = {}
    for item in (data.get("translations") or {}).get("translations", []):
        lang = item.get("iso_639_1")
        if lang not in LANGS or lang == "en":
            continue
        body = item.get("data") or {}
        if body.get("overview") and (lang not in overview or item.get("iso_3166_1") in ("KR", "JP", "CN", "ES", "FR", "DE")):
            overview[lang] = body["overview"]
        name = body.get("name") or body.get("title")
        if name and (lang not in titles or item.get("iso_3166_1") in ("KR", "JP", "CN", "ES", "FR", "DE")):
            titles[lang] = name
    providers = (data.get("watch/providers") or {}).get("results", {})
    netflix = sorted(cc.lower() for cc, value in providers.items() if any(p.get("provider_id") == NETFLIX_PROVIDER for p in value.get("flatrate", [])))
    release = data.get("first_air_date") or data.get("release_date") or ""
    votes = data.get("vote_count") or 0
    runtime = data.get("runtime") or (data.get("episode_run_time") or [None])[0]
    return {
        "status": "matched",
        "id": data["id"],
        "mediaType": media(kind),
        "title": data.get("name") or data.get("title"),
        "originalTitle": data.get("original_name") or data.get("original_title"),
        "originalLanguage": {"cn": "zh"}.get(data.get("original_language"), data.get("original_language")),
        "year": int(release[:4]) if release[:4].isdigit() else None,
        "genreIds": [g["id"] for g in data.get("genres", [])],
        "rating": round(data["vote_average"], 1) if votes else None,
        "voteCount": votes,
        "posterPath": data.get("poster_path"),
        "backdropPath": data.get("backdrop_path"),
        "runtime": runtime or None,
        "seasons": data.get("number_of_seasons"),
        "overview": {k: v for k, v in overview.items() if v},
        "titles": titles,
        "trailers": trailers(data),
        "netflixCountries": netflix,
        "confidence": round(confidence, 2),
        "checkedAt": today,
    }


def details(kind, tmdb_id):
    return request(f"/{media(kind)}/{tmdb_id}", language="en-US", append_to_response="translations,watch/providers,videos", include_video_language=",".join(LANGS) + ",null")


def match(job, today):
    kind, query, ranked = job["kind"], job["query"], job["countries"]
    queries = [normalize(part) for part in query.split("//") if part.strip()]
    found = request(f"/search/{media(kind)}", query=query.split("//")[0].strip(), include_adult="false", language="en-US", page=1) or {}
    scored = sorted(((score(r, queries), r.get("popularity", 0), r) for r in found.get("results", [])), key=lambda x: (-x[0], -x[1]))
    candidates = [(s, r) for s, _, r in scored if s >= THRESHOLD][:3]
    if not candidates:
        return {"status": "unmatched", "query": query, "kind": kind, "checkedAt": today}
    chosen = None
    for confidence, result in candidates:
        data = details(kind, result["id"])
        if not data:
            continue
        chosen = chosen or (confidence, data)
        # Titles share names with older works; the one Netflix carries where it ranked is the right one.
        if ranked & {cc.lower() for cc, v in (data.get("watch/providers") or {}).get("results", {}).items() if any(p.get("provider_id") == NETFLIX_PROVIDER for p in v.get("flatrate", []))}:
            chosen = (confidence, data)
            break
    if not chosen:
        return {"status": "unmatched", "query": query, "kind": kind, "checkedAt": today}
    return {**build(kind, chosen[1], chosen[0], today), "query": query, "kind": kind}


def refresh(old, today):
    data = details(old["kind"], old["id"])
    if not data:
        return old
    return {**build(old["kind"], data, old.get("confidence", 1), today), "query": old["query"], "kind": old["kind"]}


def wanted(netflix):
    jobs = {}
    def add(kind, title, country):
        job = jobs.setdefault(cache_key(kind, title), {"kind": kind, "query": title, "countries": set()})
        if country:
            job["countries"].add(country)
    for cc, block in netflix["countries"].items():
        for kind in ("tv", "film"):
            for row in block[kind]:
                add(kind, row["title"], cc)
    for kind in ("tv", "film"):
        for row in netflix["world"][kind]:
            add(kind, row["title"], None)
    return jobs


def main():
    if not (TOKEN or KEY):
        print("TMDB_API_KEY / TMDB_READ_TOKEN not set; skipping TMDb step")
        return
    netflix = json.loads(NETFLIX.read_text(encoding="utf-8"))
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {"schema": 1, "items": {}}
    items = cache["items"]
    today = date.today().isoformat()
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    jobs = wanted(netflix)

    def due(key, job):
        old = items.get(key)
        if not old:
            return "match"
        age = date.today() - date.fromisoformat(old["checkedAt"])
        if old["status"] == "matched":
            # Entries cached before a field existed are filled in on the next run.
            return "refresh" if age >= REFRESH_AFTER or any(field not in old for field in ("trailers", "originalLanguage")) else None
        return "match" if age >= RETRY_UNMATCHED_AFTER else None

    todo = [(key, job, action) for key, job in jobs.items() if (action := due(key, job))][:limit]

    def work(entry):
        key, job, action = entry
        try:
            return key, (match(job, today) if action == "match" else refresh(items[key], today))
        except Exception as error:  # one bad title must not lose the whole run; it is retried next time
            print(f"  failed: {key}: {error}")
            return key, None

    with ThreadPoolExecutor(max_workers=6) as pool:
        for key, result in pool.map(work, todo):
            if result:
                items[key] = result
    cutoff = (date.today() - FORGET_AFTER).isoformat()
    for key in [k for k, v in items.items() if k not in jobs and v["checkedAt"] < cutoff]:
        del items[key]
    CACHE.write_text(json.dumps(cache, ensure_ascii=False, sort_keys=True, separators=(",", ":")), encoding="utf-8")
    matched = sum(1 for k in jobs if items.get(k, {}).get("status") == "matched")
    print(f"titles={len(jobs)} looked_up={len(todo)} matched={matched}")


if __name__ == "__main__":
    main()
