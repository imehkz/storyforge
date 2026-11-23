import assert from "node:assert/strict";

const base = (process.env.STORYFORGE_STAGING_URL || "https://storyforge-staging.jastsadakorn-n.workers.dev").replace(/\/$/, "");
const request = async path => fetch(base + path, {
  headers: { "Accept": path.startsWith("/api/") ? "application/json" : "*/*" },
  signal: AbortSignal.timeout(20000),
  redirect: "error"
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

console.log("Staging Worker smoke tests passed: D1 health, unauthenticated access rejection, and frontend assets.");
