# Orbiview

Spin the globe, pick a country, see its Netflix **Drama Rank** and **Movie Rank**.
A static PWA built on Orbitone's globe and country selection. *The world's favorite screen.*

- Default view: country browsing (globe + arrows + search + favorites).
- Pinch the globe in at its default size (or scroll/trackpad-pinch on desktop): it shrinks, springs back, and the list switches to **World Rank**. The **World** button (bottom right of the globe) does the same; press it again to return to the country.
- Every row: title, genre, whether it is on Netflix in *your* country, TMDb rating, poster. Tap a row for the poster, synopsis, year, genres, rating and availability.
- Your Netflix country is detected from the device (locale region, then time zone, then language) and can be changed in Options. The UI language is a separate setting.

## Run

```sh
python3 server.py            # http://127.0.0.1:5173
npm test                     # node tests + python tests
```

## Data pipeline (static JSON, no server)

Netflix ranking and TMDb metadata are collected separately and merged into `ranks/`.

| Step | Script | Reads | Writes |
| --- | --- | --- | --- |
| 1 | `scripts/fetch_netflix.py` | Netflix Top 10 TSV (public, no key) | `data/netflix-latest.json` |
| 2 | `scripts/fetch_tmdb.py` | step 1 + TMDb API | `data/tmdb-cache.json` |
| 3 | `scripts/build_ranks.py` | steps 1 and 2 | `ranks/<cc>.json`, `ranks/world.json`, `ranks/index.json` |

Step 2 needs `TMDB_READ_TOKEN` (v4 bearer) or `TMDB_API_KEY` (v3) and is skipped without one; the app then shows the Netflix ranking without ratings, genres and posters. Titles are looked up once; only ratings and availability are refreshed weekly. Unmatched titles are retried after 14 days.

`.github/workflows/ranks.yml` runs all three steps daily and commits changes. Add the TMDb credential as a repository secret.

### File shape

Defined in [`schema/ranks.schema.json`](schema/ranks.schema.json). In short:

```jsonc
{
  "schema": 1, "scope": "country" /* or "world" */, "country": "kr" /* null for world */,
  "week": "2026-11-01", "updatedAt": "2026-11-10T11:15:10Z",
  "sources": { "netflix": { "name": "...", "url": "...", "week": "...", "fetchedAt": "..." }, "tmdb": { "name": "TMDb", "url": "..." } },
  "lists": {
    "tv":   [ /* entries, rank 1..10 */ ],
    "film": [ /* entries */ ]
  }
}
```

Entry: `{ rank, type, netflix: { title, seasonTitle, weeksInTop10 }, tmdb: null | { id, mediaType, title, year, genreIds, rating, voteCount, posterPath, overview: { en, ko, ... }, titles, confidence }, availability: { netflixCountries: ["kr", ...] } }`.

`availability.netflixCountries` is the union of countries where the title ranked this week (proof it is on Netflix there) and TMDb's Netflix flatrate countries. The list view compares it with your Netflix country.

## Offline and updates

`sw.js` precaches the app shell, serves `ranks/*.json` network-first (last good copy offline), and keeps up to 150 TMDb posters. The UI shows loading, error with retry, an "offline - saved ranking" label, the Netflix week and the file's `updatedAt`. Bump `VERSION` in `sw.js` when a precached file changes; open tabs get a "new version" prompt.

## Credits

Rankings: Netflix Top 10. This product uses the TMDB API but is not endorsed or certified by TMDB. Orbiview is not affiliated with Netflix. Globe geometry: world-atlas (see `assets/WORLD-ATLAS-LICENSE`), D3 and TopoJSON in `vendor/`.
