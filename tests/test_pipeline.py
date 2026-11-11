import json
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import build_ranks  # noqa: E402
import fetch_disney  # noqa: E402
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


class DisneyStep(unittest.TestCase):
    @staticmethod
    def results(count, start=1):
        return [{"id": start + i, "name": f"T{start + i}", "popularity": 100 - i} for i in range(count)]

    def test_window_widens_until_ten_titles_are_found(self):
        calls = []

        def fake(kind, cc, since=None):
            calls.append(since)
            return {"results": self.results(3 if len(calls) < 3 else 12)}

        with mock.patch.object(fetch_disney, "discover", fake):
            days, rows = fetch_disney.top("tv", "kr")
        self.assertEqual(days, 365)
        self.assertEqual([r["rank"] for r in rows], list(range(1, 11)))

    def test_the_first_window_is_kept_when_it_is_enough(self):
        with mock.patch.object(fetch_disney, "discover", lambda *a, **k: {"results": self.results(15)}):
            days, rows = fetch_disney.top("film", "us")
        self.assertEqual((days, len(rows)), (90, 10))

    def test_countries_without_a_catalog_are_skipped(self):
        with mock.patch.object(fetch_disney, "discover", lambda *a, **k: {"total_results": 11}):
            self.assertEqual(fetch_disney.country("ad"), ("ad", None))

    def test_world_ranks_titles_by_how_widely_and_highly_they_appear(self):
        def block(ids):
            rows = [{"rank": i + 1, "id": tid, "title": f"T{tid}", "popularity": 10.0 + tid} for i, tid in enumerate(ids)]
            return {"windowDays": {"tv": 90, "film": 180}, "tv": rows, "film": rows}

        result = fetch_disney.world({"kr": block([1, 2, 3]), "us": block([2, 1, 4]), "jp": block([2, 5])})
        self.assertEqual([r["id"] for r in result["tv"]][:2], [2, 1])
        self.assertEqual(result["tv"][0]["regions"], 3)
        self.assertEqual(result["windowDays"], {"tv": 90, "film": 180})


class TmdbStep(unittest.TestCase):
    def test_normalize_ignores_case_accents_and_punctuation(self):
        self.assertEqual(fetch_tmdb.normalize("Amélie: The  Movie!"), "amelie the movie")
        self.assertEqual(fetch_tmdb.cache_key("tv", "Lupin"), "tv:lupin")
        self.assertEqual(fetch_tmdb.id_key("film", 7), "id:movie:7")

    def test_score_prefers_exact_titles_and_checks_original_titles(self):
        self.assertEqual(fetch_tmdb.score({"name": "Lupin"}, ["lupin"]), 1.0)
        self.assertEqual(fetch_tmdb.score({"name": "Other", "original_name": "Lupin"}, ["lupin"]), 1.0)
        self.assertLess(fetch_tmdb.score({"name": "Something else"}, ["lupin"]), fetch_tmdb.THRESHOLD)

    def test_build_extracts_rating_translations_and_streaming_countries(self):
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
                "FR": {"flatrate": [{"provider_id": 8}, {"provider_id": 337}]},
                "DE": {"rent": [{"provider_id": 8}]},
            }},
        }
        record = fetch_tmdb.build("tv", data, 1.0, "2026-11-10")
        self.assertEqual(record["rating"], 7.8)
        self.assertEqual(record["year"], 2021)
        self.assertEqual(record["genreIds"], [18, 80])
        self.assertEqual(record["overview"], {"en": "English text", "ko": "한국어"})
        self.assertEqual(record["titles"], {"ko": "뤼팽"})
        self.assertEqual(record["streaming"], {"netflix": ["fr", "kr"], "disney": ["fr", "us"]})
        self.assertEqual(record["mediaType"], "tv")
        self.assertEqual(fetch_tmdb.build("tv", {**data, "original_language": "cn"}, 1.0, "2026-11-10")["originalLanguage"], "zh")

    def test_trailers_pick_the_best_official_youtube_trailer_per_language(self):
        def video(site, kind, lang, key, official=False, published="2024-01-01"):
            return {"site": site, "type": kind, "iso_639_1": lang, "key": key, "official": official, "published_at": published}

        videos = {"results": [
            video("YouTube", "Trailer", "en", "aaaaaaaaaaa", False, "2024-05-01"),
            video("YouTube", "Trailer", "en", "bbbbbbbbbbb", True),
            video("YouTube", "Trailer", "ko", "ccccccccccc", True),
            video("Vimeo", "Trailer", "ja", "ddddddddddd"),
            video("YouTube", "Teaser", "de", "eeeeeeeeeee"),
            video("YouTube", "Trailer", "fr", "bad key!"),
            video("YouTube", "Trailer", "xx", "fffffffffff"),
        ]}
        self.assertEqual(fetch_tmdb.trailers({"videos": videos}), {"en": "bbbbbbbbbbb", "ko": "ccccccccccc"})
        self.assertEqual(fetch_tmdb.trailers({}), {})

    def test_unrated_titles_have_no_rating(self):
        record = fetch_tmdb.build("film", {"id": 1, "title": "New", "vote_average": 0, "vote_count": 0}, 0.9, "2026-11-10")
        self.assertIsNone(record["rating"])

    def test_wanted_collects_netflix_titles_and_disney_ids(self):
        netflix = {"countries": {"kr": {"tv": [{"title": "Lupin"}], "film": []}}, "world": {"tv": [], "film": []}}
        disney = {"countries": {"kr": {"tv": [{"id": 9, "title": "Show"}], "film": []}}, "world": {"tv": [], "film": []}}
        jobs = fetch_tmdb.wanted(netflix, disney)
        self.assertEqual(set(jobs), {"tv:lupin", "id:tv:9"})
        self.assertEqual(jobs["id:tv:9"]["id"], 9)


class MergeStep(unittest.TestCase):
    NETFLIX = {"kr": {"tv": [{"rank": 1, "title": "Lupin"}], "film": []}, "fr": {"tv": [{"rank": 1, "title": "Lupin"}], "film": []}}
    ROW = {"rank": 1, "title": "Lupin", "seasonTitle": None, "weeksInTop10": 1}

    def test_ranking_proves_availability_without_tmdb(self):
        seen = build_ranks.presence("netflix", self.NETFLIX)
        entry = build_ranks.make_entry("netflix", "tv", self.ROW, {}, seen)
        self.assertIsNone(entry["tmdb"])
        self.assertEqual(entry["availability"]["countries"], ["fr", "kr"])
        self.assertEqual(entry["listing"], {"title": "Lupin", "seasonTitle": None, "weeksInTop10": 1})

    def test_matched_titles_merge_tmdb_and_ranked_countries(self):
        seen = build_ranks.presence("netflix", self.NETFLIX)
        items = {"tv:lupin": {"status": "matched", "id": 42, "mediaType": "tv", "title": "Lupin", "genreIds": [18], "rating": 7.8,
                              "posterPath": "/p.jpg", "overview": {"en": "x"}, "confidence": 1.0, "backdropPath": "/b.jpg",
                              "streaming": {"netflix": ["us"], "disney": ["jp"]}}}
        entry = build_ranks.make_entry("netflix", "tv", self.ROW, items, seen)
        self.assertEqual(entry["tmdb"]["rating"], 7.8)
        self.assertNotIn("backdropPath", entry["tmdb"])
        self.assertEqual(entry["availability"]["countries"], ["fr", "kr", "us"])

    def test_disney_entries_are_matched_by_tmdb_id(self):
        blocks = {"kr": {"tv": [{"rank": 1, "id": 9, "title": "Show", "popularity": 5.0}], "film": []}}
        seen = build_ranks.presence("disney", blocks)
        items = {"id:tv:9": {"status": "matched", "id": 9, "mediaType": "tv", "title": "Show", "genreIds": [], "rating": 8.0,
                             "posterPath": None, "overview": {}, "confidence": 1.0, "streaming": {"netflix": ["us"], "disney": ["jp"]}}}
        entry = build_ranks.make_entry("disney", "tv", blocks["kr"]["tv"][0], items, seen)
        self.assertEqual(entry["availability"]["countries"], ["jp", "kr"])
        self.assertEqual(entry["listing"], {"title": "Show", "popularity": 5.0})
        self.assertEqual(entry["tmdb"]["rating"], 8.0)

    def test_unmatched_cache_entries_do_not_leak_into_output(self):
        seen = build_ranks.presence("netflix", self.NETFLIX)
        items = {"tv:lupin": {"status": "unmatched", "query": "Lupin", "kind": "tv", "checkedAt": "2026-11-10"}}
        self.assertIsNone(build_ranks.make_entry("netflix", "tv", self.ROW, items, seen)["tmdb"])

    def test_validate_rejects_gaps_in_ranks(self):
        doc = {"service": "netflix", "country": "kr", "lists": {"tv": [{"rank": 2, "type": "tv", "listing": {"title": "A"}}], "film": []}}
        with self.assertRaises(ValueError):
            build_ranks.validate(doc)

    def test_generated_indexes_parse(self):
        for folder, service in ((build_ranks.OUT, "netflix"), (build_ranks.OUT / "disney", "disney")):
            index = json.loads((folder / "index.json").read_text(encoding="utf-8"))
            self.assertEqual((index["schema"], index["service"]), (1, service))


if __name__ == "__main__":
    unittest.main()
