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

    def test_chapters_store_word_counts(self):
        columns = {
            row[1] for row in self.db.execute("PRAGMA table_info(chapters)")
        }
        self.assertIn("word_count", columns)

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
