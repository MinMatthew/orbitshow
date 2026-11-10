import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import build_ranks  # noqa: E402
import fetch_netflix  # noqa: E402
import fetch_tmdb  # noqa: E402


def country_row(cc, category, rank, title, season="N/A", weeks="1"):
    return {"country_iso2": cc.upper(), "country_name": cc, "category": category, "weekly_rank": str(rank),
            "show_title": title, "season_title": season, "cumulative_weeks_in_top_10": weeks}


def global_row(category, rank, title, views, hours="0"):
    return {"category": category, "weekly_rank": str(rank), "show_title": title, "season_title": "N/A",
            "weekly_hours_viewed": hours, "weekly_views": views, "cumulative_weeks_in_top_10": "2"}


class NetflixStep(unittest.TestCase):
    def test_country_block_splits_tv_and_films(self):
        block = fetch_netflix.countries_block([
            country_row("kr", "TV", 1, "Show", "Show: Season 1", "4"),
            country_row("kr", "Films", 1, "Movie"),
        ])
        self.assertEqual(block["kr"]["tv"][0], {"rank": 1, "title": "Show", "seasonTitle": "Show: Season 1", "weeksInTop10": 4})
        self.assertIsNone(block["kr"]["film"][0]["seasonTitle"])

    def test_world_block_merges_english_and_non_english_by_views(self):
        world = fetch_netflix.world_block([
            global_row("TV (English)", 1, "A", "100"),
            global_row("TV (Non-English)", 1, "B", "300"),
            global_row("TV (English)", 2, "C", "200"),
            global_row("Films (English)", 1, "F", "50"),
        ])
        self.assertEqual([r["title"] for r in world["tv"]], ["B", "C", "A"])
        self.assertEqual([r["rank"] for r in world["tv"]], [1, 2, 3])
        self.assertFalse(world["tv"][0]["english"])
        self.assertEqual(len(world["film"]), 1)


class TmdbStep(unittest.TestCase):
    def test_normalize_ignores_case_accents_and_punctuation(self):
        self.assertEqual(fetch_tmdb.normalize("Amélie: The  Movie!"), "amelie the movie")
        self.assertEqual(fetch_tmdb.cache_key("tv", "Lupin"), "tv:lupin")

    def test_score_prefers_exact_titles_and_checks_original_titles(self):
        self.assertEqual(fetch_tmdb.score({"name": "Lupin"}, ["lupin"]), 1.0)
        self.assertEqual(fetch_tmdb.score({"name": "Other", "original_name": "Lupin"}, ["lupin"]), 1.0)
        self.assertLess(fetch_tmdb.score({"name": "Something else"}, ["lupin"]), fetch_tmdb.THRESHOLD)

    def test_build_extracts_rating_translations_and_netflix_countries(self):
        data = {
            "id": 42, "name": "Lupin", "original_name": "Lupin", "first_air_date": "2021-01-08",
            "genres": [{"id": 18}, {"id": 80}], "vote_average": 7.84, "vote_count": 100,
            "poster_path": "/p.jpg", "overview": "English text", "number_of_seasons": 3, "episode_run_time": [45],
            "translations": {"translations": [
                {"iso_639_1": "ko", "iso_3166_1": "KR", "data": {"name": "뤼팽", "overview": "한국어"}},
                {"iso_639_1": "xx", "iso_3166_1": "XX", "data": {"name": "ignored", "overview": "ignored"}},
            ]},
            "watch/providers": {"results": {
                "KR": {"flatrate": [{"provider_id": 8}]},
                "US": {"flatrate": [{"provider_id": 337}]},
                "FR": {"flatrate": [{"provider_id": 8}]},
            }},
        }
        record = fetch_tmdb.build("tv", data, 1.0, "2026-11-10")
        self.assertEqual(record["rating"], 7.8)
        self.assertEqual(record["year"], 2021)
        self.assertEqual(record["genreIds"], [18, 80])
        self.assertEqual(record["overview"], {"en": "English text", "ko": "한국어"})
        self.assertEqual(record["titles"], {"ko": "뤼팽"})
        self.assertEqual(record["netflixCountries"], ["fr", "kr"])
        self.assertEqual(record["mediaType"], "tv")

    def test_unrated_titles_have_no_rating(self):
        record = fetch_tmdb.build("film", {"id": 1, "title": "New", "vote_average": 0, "vote_count": 0}, 0.9, "2026-11-10")
        self.assertIsNone(record["rating"])


class MergeStep(unittest.TestCase):
    NETFLIX = {"countries": {
        "kr": {"name": "KR", "tv": [{"rank": 1, "title": "Lupin", "seasonTitle": None, "weeksInTop10": 1}], "film": []},
        "fr": {"name": "FR", "tv": [{"rank": 1, "title": "Lupin", "seasonTitle": None, "weeksInTop10": 1}], "film": []},
    }}

    def test_ranking_proves_availability_without_tmdb(self):
        seen = build_ranks.presence(self.NETFLIX)
        entry = build_ranks.make_entry("tv", {"rank": 1, "title": "Lupin", "seasonTitle": None, "weeksInTop10": 1}, {}, seen)
        self.assertIsNone(entry["tmdb"])
        self.assertEqual(entry["availability"]["netflixCountries"], ["fr", "kr"])

    def test_matched_titles_merge_tmdb_and_ranked_countries(self):
        seen = build_ranks.presence(self.NETFLIX)
        items = {"tv:lupin": {"status": "matched", "id": 42, "mediaType": "tv", "title": "Lupin", "genreIds": [18], "rating": 7.8,
                              "posterPath": "/p.jpg", "overview": {"en": "x"}, "confidence": 1.0, "netflixCountries": ["us"], "backdropPath": "/b.jpg"}}
        entry = build_ranks.make_entry("tv", {"rank": 1, "title": "Lupin", "seasonTitle": None, "weeksInTop10": 1}, items, seen)
        self.assertEqual(entry["tmdb"]["rating"], 7.8)
        self.assertNotIn("backdropPath", entry["tmdb"])
        self.assertEqual(entry["availability"]["netflixCountries"], ["fr", "kr", "us"])

    def test_unmatched_cache_entries_do_not_leak_into_output(self):
        seen = build_ranks.presence(self.NETFLIX)
        items = {"tv:lupin": {"status": "unmatched", "query": "Lupin", "kind": "tv", "checkedAt": "2026-11-10"}}
        entry = build_ranks.make_entry("tv", {"rank": 1, "title": "Lupin", "seasonTitle": None, "weeksInTop10": 1}, items, seen)
        self.assertIsNone(entry["tmdb"])

    def test_validate_rejects_gaps_in_ranks(self):
        doc = {"country": "kr", "lists": {"tv": [{"rank": 2, "type": "tv", "netflix": {"title": "A"}}], "film": []}}
        with self.assertRaises(ValueError):
            build_ranks.validate(doc)

    def test_generated_files_parse(self):
        index = json.loads((build_ranks.OUT / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(index["schema"], 1)


if __name__ == "__main__":
    unittest.main()
