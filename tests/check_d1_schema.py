"""Run with: python3 tests/check_d1_schema.py

Uses Python's standard sqlite3 module to validate the D1-compatible migrations.
This checks schema integrity, not the Cloudflare runtime or auth APIs.
"""
from pathlib import Path
import sqlite3
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "cloudflare" / "migrations"


class D1SchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            self.db.executescript(migration.read_text(encoding="utf-8"))

    def tearDown(self):
        self.db.close()

    def seed_project(self):
        self.db.execute(
            "INSERT INTO users(id, github_user_id, github_login) VALUES ('u1','gh-1','writer')"
        )
        self.db.execute(
            "INSERT INTO projects(id, owner_id, title) VALUES ('p1','u1','Novel One')"
        )

    def test_expected_tables_exist(self):
        expected = {
            "users", "sessions", "oauth_states", "oauth_credentials",
            "projects", "chapters", "project_memories", "snapshots",
            "characters", "relationships", "plot_threads", "world_lore",
            "timeline_events", "story_notes", "project_assets",
        }
        actual = {
            row[0] for row in self.db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        self.assertTrue(expected.issubset(actual), expected - actual)

    def test_chapters_store_word_counts_and_character_references(self):
        columns = {
            row[1] for row in self.db.execute("PRAGMA table_info(chapters)")
        }
        self.assertIn("word_count", columns)
        self.assertIn("character_ids_json", columns)
        self.assertEqual(
            self.db.execute("SELECT dflt_value FROM pragma_table_info('chapters') WHERE name='character_ids_json'").fetchone()[0],
            "'[]'",
        )

    def test_chapter_character_references_are_kept_within_project(self):
        self.seed_project()
        self.db.execute("INSERT INTO characters(id, project_id, name) VALUES ('char-1','p1','Mira')")
        self.db.execute(
            "INSERT INTO chapters(id, project_id, title, character_ids_json) VALUES ('chapter-1','p1','Chapter', ?)",
            ('["char-1"]',),
        )
        self.assertEqual(
            self.db.execute("SELECT character_ids_json FROM chapters WHERE id='chapter-1'").fetchone()[0],
            '["char-1"]',
        )
        with self.assertRaises(Exception):
            self.db.execute(
                "UPDATE chapters SET character_ids_json = ? WHERE id='chapter-1'",
                ('["character-from-another-project"]',),
            )

    def test_child_rows_require_a_real_project(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO chapters(id, project_id, title) VALUES ('c1', 'missing', 'Chapter')"
            )

    def test_relationship_cannot_cross_project_boundaries(self):
        self.seed_project()
        self.db.execute(
            "INSERT INTO projects(id, owner_id, title) VALUES ('p2','u1','Novel Two')"
        )
        self.db.execute(
            "INSERT INTO characters(id, project_id, name) VALUES ('a','p1','Mira')"
        )
        self.db.execute(
            "INSERT INTO characters(id, project_id, name) VALUES ('b','p2','Mira')"
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                "INSERT INTO relationships(id, project_id, source_character_id, target_character_id) VALUES ('r1','p1','a','b')"
            )

    def test_plot_world_timeline_store_character_reference_arrays(self):
        for table in ("plot_threads", "world_lore", "timeline_events"):
            columns = {row[1] for row in self.db.execute("PRAGMA table_info(" + table + ")")}
            self.assertIn("character_ids_json", columns)
        self.seed_project()
        self.db.execute("INSERT INTO characters(id, project_id, name) VALUES ('char-1','p1','Mira')")
        self.db.execute("INSERT INTO plot_threads(id, project_id, title, character_ids_json) VALUES ('plot-1','p1','Main', ?)", ('["char-1"]',))
        self.assertEqual(self.db.execute("SELECT character_ids_json FROM plot_threads WHERE id='plot-1'").fetchone()[0], '["char-1"]')

    def test_character_delete_removes_stale_canonical_references(self):
        self.seed_project()
        self.db.execute("INSERT INTO characters(id, project_id, name) VALUES ('char-1','p1','Mira')")
        self.db.execute("INSERT INTO plot_threads(id, project_id, title, character_ids_json) VALUES ('plot-1','p1','Main', ?)", ('["char-1"]',))
        self.db.execute("INSERT INTO world_lore(id, project_id, title, character_ids_json) VALUES ('world-1','p1','Kingdom', ?)", ('["char-1"]',))
        self.db.execute("INSERT INTO timeline_events(id, project_id, title, character_ids_json) VALUES ('event-1','p1','Battle', ?)", ('["char-1"]',))
        self.db.execute("INSERT INTO story_notes(id, project_id, title, character_ids_json) VALUES ('note-1','p1','Secret', ?)", ('["char-1"]',))
        for table in ("plot_threads", "world_lore", "timeline_events", "story_notes"):
            self.db.execute(
                "UPDATE " + table + " SET character_ids_json = COALESCE((SELECT json_group_array(value) FROM json_each(" + table + ".character_ids_json) WHERE value <> ?), '[]') WHERE project_id = ? AND EXISTS (SELECT 1 FROM json_each(" + table + ".character_ids_json) WHERE value = ?)",
                ("char-1", "p1", "char-1"),
            )
        self.db.execute("DELETE FROM characters WHERE id='char-1' AND project_id='p1'")
        for table, row_id in (("plot_threads", "plot-1"), ("world_lore", "world-1"), ("timeline_events", "event-1"), ("story_notes", "note-1")):
            self.assertEqual(self.db.execute("SELECT character_ids_json FROM " + table + " WHERE id=?", (row_id,)).fetchone()[0], "[]")

    def test_chapter_snapshot_retention_keeps_latest_100(self):
        self.seed_project()
        self.db.execute(
            "INSERT INTO chapters(id, project_id, title) VALUES ('c1','p1','Chapter')"
        )
        self.db.executemany(
            "INSERT INTO snapshots(id, project_id, resource_type, resource_id, content_json, created_at) "
            "VALUES (?, 'p1', 'chapter', 'c1', '{}', ?)",
            [
                (f"s{i:03d}", f"2026-12-01T00:00:00.{i:03d}Z")
                for i in range(105)
            ],
        )
        self.db.execute(
            "DELETE FROM snapshots WHERE resource_type = 'chapter' AND resource_id = ? "
            "AND project_id = (SELECT project_id FROM chapters WHERE id = ?) "
            "AND id NOT IN (SELECT id FROM snapshots WHERE resource_type = 'chapter' "
            "AND resource_id = ? AND project_id = (SELECT project_id FROM chapters WHERE id = ?) "
            "ORDER BY created_at DESC, id DESC LIMIT 100)",
            ("c1", "c1", "c1", "c1"),
        )
        rows = self.db.execute(
            "SELECT id FROM snapshots WHERE resource_type='chapter' AND resource_id='c1' "
            "ORDER BY created_at, id"
        ).fetchall()
        self.assertEqual(len(rows), 100)
        self.assertEqual(rows[0][0], "s005")
        self.assertEqual(rows[-1][0], "s104")

    def test_project_delete_cascades_to_children(self):
        self.seed_project()
        self.db.execute(
            "INSERT INTO chapters(id, project_id, title) VALUES ('c2','p1','Chapter')"
        )
        self.db.execute("DELETE FROM projects WHERE id='p1'")
        count = self.db.execute(
            "SELECT COUNT(*) FROM chapters WHERE id='c2'"
        ).fetchone()[0]
        self.assertEqual(count, 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
