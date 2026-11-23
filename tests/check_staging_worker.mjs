import assert from "node:assert/strict";

const base = (process.env.STORYFORGE_STAGING_URL || "https://storyforge-staging.jastsadakorn-n.workers.dev").replace(/\/$/, "");
const request = async (path, redirect = "error") => fetch(base + path, {
  headers: { "Accept": path.startsWith("/api/") ? "application/json" : "*/*" },
  signal: AbortSignal.timeout(20000),
  redirect
});

const healthResponse = await request("/api/health");
assert.equal(healthResponse.status, 200, "staging health endpoint must be available");
const health = await healthResponse.json();
assert.equal(health.ok, true, "staging Worker must respond healthy");
assert.equal(health.databaseReady, true, "staging Worker must reach its isolated D1 database");
assert.equal(typeof health.authConfigured, "boolean", "health must report OAuth readiness without exposing secrets");

const projectsResponse = await request("/api/projects");
assert.equal(projectsResponse.status, 401, "project API must reject unauthenticated requests");
const authError = await projectsResponse.json();
assert.equal(authError.error, "UNAUTHENTICATED", "unauthenticated API must fail closed");
const sessionResponse = await request("/api/session");
if (health.authConfigured) {
  assert.equal(sessionResponse.status, 200, "configured OAuth must allow anonymous session inspection");
  assert.equal((await sessionResponse.json()).authenticated, false);
  const loginResponse = await request("/auth/login", "manual");
  assert.equal(loginResponse.status, 302, "configured OAuth login must redirect to GitHub");
  const loginLocation = new URL(loginResponse.headers.get("location"));
  assert.equal(loginLocation.origin, "https://github.com");
  assert.equal(loginLocation.pathname, "/login/oauth/authorize");
  assert.equal(loginLocation.searchParams.get("redirect_uri"), base + "/auth/callback");
  assert.ok(loginLocation.searchParams.get("client_id"), "OAuth redirect must include the configured client ID");
} else {
  assert.equal(sessionResponse.status, 503, "session endpoint must report missing OAuth configuration");
  assert.equal((await sessionResponse.json()).error, "AUTH_NOT_CONFIGURED");
  const loginResponse = await request("/auth/login");
  assert.equal(loginResponse.status, 503, "login must fail closed when OAuth is not configured");
  assert.equal((await loginResponse.json()).error, "AUTH_NOT_CONFIGURED");
}


const htmlResponse = await request("/");
assert.equal(htmlResponse.status, 200, "staging home page must be served");
assert.match(htmlResponse.headers.get("content-type") || "", /text\/html/i);
const html = await htmlResponse.text();
assert.match(html, /STORYFORGE/i, "staging HTML must contain the StoryForge app");

const appResponse = await request("/app.js");
assert.equal(appResponse.status, 200, "staging JavaScript asset must be served");
assert.match(appResponse.headers.get("content-type") || "", /javascript/i);
assert.match(await appResponse.text(), /setupManuscriptEditor|setupCharacterVault/);

const cssResponse = await request("/style.css");
assert.equal(cssResponse.status, 200, "staging stylesheet must be served");
assert.match(cssResponse.headers.get("content-type") || "", /text\/css/i);
assert.match(await cssResponse.text(), /--navy:#101827/);

console.log("Staging Worker smoke tests passed: D1 health, auth readiness, fail-closed session/login behavior, and frontend assets.");
