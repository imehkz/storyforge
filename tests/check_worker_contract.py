"""Static security-contract checks for the Cloudflare Worker.

These checks guard important source-level invariants. They are not a substitute
for integration tests against a deployed Worker and D1 database.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKER = (ROOT / "cloudflare" / "worker.js").read_text(encoding="utf-8")
WRANGLER = (ROOT / "cloudflare" / "wrangler.toml.example").read_text(encoding="utf-8")


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

    def test_sessions_are_hashed_and_csrf_protected(self):
        self.assertIn("sha256(sessionToken)", WORKER)
        self.assertIn("HttpOnly; SameSite=Lax", WORKER)
        self.assertIn("X-CSRF-Token", WORKER)
        self.assertIn("storyforge_csrf", WORKER)
        self.assertIn("revoked_at", WORKER)

    def test_project_queries_are_owner_scoped(self):
        self.assertIn("WHERE owner_id = ?", WORKER)
        self.assertIn("projects.owner_id = ?", WORKER)
        self.assertIn("project_id = ?", WORKER)

    def test_editor_is_not_claimed_as_cloud_synced(self):
        app = (ROOT / "public" / "app.js").read_text(encoding="utf-8")
        self.assertIn("ยังไม่ซิงก์ขึ้นเซิร์ฟเวอร์", app)
        self.assertIn('localStorage.setItem("sf_" + key', app)

    def test_worker_routes_auth_before_static_fallback(self):
        self.assertIn('run_worker_first = ["/api/*", "/auth/*"]', WRANGLER)


if __name__ == "__main__":
    unittest.main(verbosity=2)
