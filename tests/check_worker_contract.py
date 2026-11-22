"""Static security and frontend contract checks.

These source-level checks are not a substitute for integration tests against a
Cloudflare Worker and D1 database.
"""
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKER = (ROOT / "cloudflare" / "worker.js").read_text(encoding="utf-8")
APP = (ROOT / "public" / "app.js").read_text(encoding="utf-8")
HTML = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
WRANGLER = (ROOT / "cloudflare" / "wrangler.toml.example").read_text(encoding="utf-8")


class IdCollector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key == "id" and value:
                self.ids.append(value)


class WorkerContractTests(unittest.TestCase):
    def test_owner_allowlist_is_required_and_enforced(self):
        self.assertIn("env.GITHUB_OWNER_ID", WORKER)
        self.assertIn('String(githubUser.id) !== String(env.GITHUB_OWNER_ID)', WORKER)
        self.assertIn("role = 'owner'", WORKER)

    def test_oauth_state_is_hashed_expiring_and_single_use(self):
        self.assertIn("sha256(state)", WORKER)
        self.assertIn("DELETE FROM oauth_states", WORKER)
        self.assertIn("RETURNING state_hash", WORKER)
        self.assertIn("STATE_TTL_SECONDS", WORKER)
        self.assertIn('redirect_uri: new URL("/auth/callback", request.url).toString()', WORKER)

    def test_sessions_are_hashed_and_csrf_protected(self):
        self.assertIn("sha256(sessionToken)", WORKER)
        self.assertIn("HttpOnly; SameSite=Lax", WORKER)
        self.assertIn("X-CSRF-Token", WORKER)
        self.assertIn('request.headers.get("Origin")', WORKER)
        self.assertIn("__Host-storyforge_csrf", WORKER)
        self.assertIn("cookieValue(request, CSRF_COOKIE)", WORKER)
        self.assertIn("HttpOnly; SameSite=Strict", WORKER)
        self.assertIn('headers.append("Set-Cookie", item)', WORKER)
        self.assertIn("revoked_at", WORKER)

    def test_project_queries_are_owner_scoped(self):
        self.assertIn("WHERE owner_id = ?", WORKER)
        self.assertIn("projects.owner_id = ?", WORKER)
        self.assertIn("project_id = ?", WORKER)

    def test_local_import_uses_stable_client_ids(self):
        self.assertIn("INSERT OR IGNORE INTO projects", WORKER)
        self.assertIn("INSERT OR IGNORE INTO chapters", WORKER)
        self.assertIn("INSERT OR IGNORE INTO ${config.table}", WORKER)
        self.assertIn("clientId", APP)
        self.assertIn("migrationMapKey", APP)

    def test_chapter_history_and_revision_are_atomic(self):
        self.assertGreaterEqual(WORKER.count("env.DB.batch(["), 2)
        self.assertIn("expectedRevision", WORKER)
        self.assertIn("'word_count', word_count, 'revision', revision", WORKER)
        self.assertIn("validateWordCount(input.wordCount, countWords(body))", WORKER)
        self.assertIn("countWords(body)", WORKER)
        self.assertIn("word_count", WORKER)
        self.assertIn("resource_type = 'chapter'", WORKER)
        self.assertIn("DELETE FROM snapshots WHERE resource_type = 'chapter'", WORKER)
        self.assertIn("/move", WORKER)
        self.assertIn("sort_order", WORKER)

    def test_frontend_has_cloud_project_and_editor_integration(self):
        for fragment in (
            "/api/projects", "/api/chapters/", "scheduleCloudSave",
            "importLocalNovelData", "showChapterHistory",
            "loadProjectModules", "createModuleItem",
            "moveActiveChapter", "deleteActiveChapter",
            "toggleCloudProjectArchive", "deleteCloudProject",
            "renderRelationshipGraph", "renderPlotBoard", "renderTimelineView",
            "saveCharacter", "countWords"
        ):
            self.assertIn(fragment, APP)

    def test_editor_backup_key_is_preserved(self):
        self.assertIn('key === "manuscriptBody" ? "sf_manuscript"', APP)
        self.assertIn("storageKeyFor", APP)
        self.assertIn("sf_manuscript", APP)

    def test_html_ids_are_unique(self):
        parser = IdCollector()
        parser.feed(HTML)
        duplicates = [value for value, count in Counter(parser.ids).items() if count > 1]
        self.assertEqual(duplicates, [], "Duplicate HTML IDs: " + ", ".join(duplicates))

    def test_worker_routes_auth_before_static_fallback(self):
        self.assertIn('run_worker_first = ["/api/*", "/auth/*"]', WRANGLER)


if __name__ == "__main__":
    unittest.main(verbosity=2)
