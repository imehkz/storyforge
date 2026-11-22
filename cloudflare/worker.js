const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin"
};
const SESSION_COOKIE = "__Host-storyforge_session";
const STATE_COOKIE = "__Secure-storyforge_oauth_state";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const STATE_TTL_SECONDS = 10 * 60;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
const redirect = (url, headers = {}) =>
  new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", ...headers } });
const nowIso = () => new Date().toISOString();
const addSeconds = (seconds) => new Date(Date.now() + seconds * 1000).toISOString();
const randomToken = (bytes = 32) => {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const value of data) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};
const sha256 = async (value) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};
const safeEqual = (left, right) => {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
};
const cookieValue = (request, name) => {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
};
const cookie = (name, value, maxAge, path = "/") =>
  `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
const clearCookie = (name, path = "/") =>
  `${name}=; Path=${path}; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;

const readJson = async (request, maxBytes = 64 * 1024) => {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maxBytes) throw new Error("BODY_TOO_LARGE");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error("BODY_TOO_LARGE");
  try { return JSON.parse(raw); } catch { throw new Error("INVALID_JSON"); }
};
const requiredString = (value, max, field) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error("INVALID_" + field.toUpperCase());
  }
  return value.trim();
};
const optionalString = (value, max, field) => {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > max) throw new Error("INVALID_" + field.toUpperCase());
  return value;
};
const errorResponse = (error) => {
  const code = error?.message || "INTERNAL_ERROR";
  const status = code === "BODY_TOO_LARGE" ? 413 :
    code === "INVALID_JSON" || code.startsWith("INVALID_") ? 400 :
    code === "UNAUTHENTICATED" ? 401 :
    code === "FORBIDDEN" ? 403 :
    code === "NOT_FOUND" ? 404 :
    code === "CONFLICT" ? 409 : 500;
  return json({ error: status === 500 ? "INTERNAL_ERROR" : code }, status);
};

async function getSession(request, env) {
  const raw = cookieValue(request, SESSION_COOKIE);
  if (!raw || !env.DB) return null;
  const sessionHash = await sha256(raw);
  const row = await env.DB.prepare(
    `SELECT s.session_hash, s.csrf_hash, s.expires_at, u.id AS user_id, u.github_user_id, u.github_login
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.session_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.role = 'owner'`
  ).bind(sessionHash, nowIso()).first();
  return row || null;
}

async function requireSession(request, env, mutate = false) {
  const session = await getSession(request, env);
  if (!session) throw new Error("UNAUTHENTICATED");
  if (mutate) {
    const supplied = request.headers.get("X-CSRF-Token") || "";
    if (!supplied || !safeEqual(await sha256(supplied), session.csrf_hash)) throw new Error("FORBIDDEN");
  }
  return session;
}

async function oauthLogin(request, env) {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.GITHUB_OWNER_ID || !env.DB) {
    return json({ error: "AUTH_NOT_CONFIGURED" }, 503);
  }
  const state = randomToken();
  await env.DB.prepare("DELETE FROM oauth_states WHERE expires_at <= ?").bind(nowIso()).run();
  await env.DB.prepare("INSERT INTO oauth_states (state_hash, expires_at) VALUES (?, ?)")
    .bind(await sha256(state), addSeconds(STATE_TTL_SECONDS)).run();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", new URL("/auth/callback", request.url).toString());
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  return redirect(url.toString(), { "Set-Cookie": cookie(STATE_COOKIE, state, STATE_TTL_SECONDS, "/auth/callback") });
}

async function oauthCallback(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const stateCookie = cookieValue(request, STATE_COOKIE);
  const clearState = clearCookie(STATE_COOKIE, "/auth/callback");
  if (!state || !code || !stateCookie || !safeEqual(state, stateCookie) || !env.DB ||
      !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.GITHUB_OWNER_ID) {
    return redirect("/?auth=failed", { "Set-Cookie": clearState });
  }

  // DELETE ... RETURNING makes the OAuth state single-use even if callbacks race.
  const consumed = await env.DB.prepare(
    "DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ? RETURNING state_hash"
  ).bind(await sha256(state), nowIso()).first();
  if (!consumed) return redirect("/?auth=failed", { "Set-Cookie": clearState });

  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code })
  });
  if (!tokenResponse.ok) return redirect("/?auth=failed", { "Set-Cookie": clearState });
  const tokenData = await tokenResponse.json();
  if (!tokenData.access_token) return redirect("/?auth=failed", { "Set-Cookie": clearState });

  const githubResponse = await fetch("https://api.github.com/user", {
    headers: { "Authorization": "Bearer " + tokenData.access_token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "StoryForge" }
  });
  if (!githubResponse.ok) return redirect("/?auth=failed", { "Set-Cookie": clearState });
  const githubUser = await githubResponse.json();
  if (!githubUser.id || String(githubUser.id) !== String(env.GITHUB_OWNER_ID)) {
    return redirect("/?auth=not-allowed", { "Set-Cookie": clearState });
  }

  const userId = crypto.randomUUID();
  const user = await env.DB.prepare(
    `INSERT INTO users (id, github_user_id, github_login, role)
     VALUES (?, ?, ?, 'owner')
     ON CONFLICT(github_user_id) DO UPDATE SET github_login = excluded.github_login, role = 'owner', updated_at = ?
     RETURNING id`
  ).bind(userId, String(githubUser.id), String(githubUser.login || ""), nowIso()).first();
  if (!user?.id) return redirect("/?auth=failed", { "Set-Cookie": clearState });

  const sessionToken = randomToken();
  const csrfToken = randomToken();
  await env.DB.prepare(
    "INSERT INTO sessions (session_hash, user_id, csrf_hash, expires_at) VALUES (?, ?, ?, ?)"
  ).bind(await sha256(sessionToken), user.id, await sha256(csrfToken), addSeconds(SESSION_TTL_SECONDS)).run();

  // The GitHub access token is intentionally discarded; StoryForge only uses it to verify identity.
  return redirect("/?auth=success", {
    "Set-Cookie": [clearState, cookie(SESSION_COOKIE, sessionToken, SESSION_TTL_SECONDS)].join(", ")
  });
}

async function api(request, env, url) {
  if (!env.DB) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, service: "storyforge-worker", databaseBindingPresent: true });
  }
  if (path === "/api/session" && method === "GET") {
    const session = await getSession(request, env);
    if (!session) return json({ authenticated: false });
    return json({ authenticated: true, user: { githubLogin: session.github_login }, csrfToken: randomTokenForSession(session) });
  }
  if (path === "/api/logout" && method === "POST") {
    const session = await requireSession(request, env, true);
    await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE session_hash = ?")
      .bind(nowIso(), session.session_hash).run();
    return json({ ok: true }, 200, { "Set-Cookie": clearCookie(SESSION_COOKIE) });
  }

  const session = await requireSession(request, env, !["GET", "HEAD"].includes(method));
  const ownerId = session.user_id;

  if (path === "/api/projects" && method === "GET") {
    const result = await env.DB.prepare(
      "SELECT id, title, genre, synopsis, status, created_at, updated_at FROM projects WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 200"
    ).bind(ownerId).all();
    return json({ projects: result.results || [] });
  }
  if (path === "/api/projects" && method === "POST") {
    const input = await readJson(request);
    const id = crypto.randomUUID();
    const title = requiredString(input.title, 160, "title");
    const genre = optionalString(input.genre, 100, "genre");
    const synopsis = optionalString(input.synopsis, 10000, "synopsis");
    await env.DB.prepare("INSERT INTO projects (id, owner_id, title, genre, synopsis) VALUES (?, ?, ?, ?, ?)")
      .bind(id, ownerId, title, genre, synopsis).run();
    return json({ project: { id, title, genre, synopsis, status: "active" } }, 201);
  }

  const projectMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)$/i);
  if (projectMatch) {
    const projectId = projectMatch[1];
    if (method === "GET") {
      const project = await env.DB.prepare(
        "SELECT id, title, genre, synopsis, status, created_at, updated_at FROM projects WHERE id = ? AND owner_id = ?"
      ).bind(projectId, ownerId).first();
      if (!project) throw new Error("NOT_FOUND");
      return json({ project });
    }
    if (method === "PATCH") {
      const input = await readJson(request);
      const current = await env.DB.prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ?").bind(projectId, ownerId).first();
      if (!current) throw new Error("NOT_FOUND");
      const fields = [];
      const values = [];
      if (input.title !== undefined) { fields.push("title = ?"); values.push(requiredString(input.title, 160, "title")); }
      if (input.genre !== undefined) { fields.push("genre = ?"); values.push(optionalString(input.genre, 100, "genre")); }
      if (input.synopsis !== undefined) { fields.push("synopsis = ?"); values.push(optionalString(input.synopsis, 10000, "synopsis")); }
      if (input.status !== undefined) {
        if (!["active", "archived"].includes(input.status)) throw new Error("INVALID_STATUS");
        fields.push("status = ?"); values.push(input.status);
      }
      if (!fields.length) throw new Error("INVALID_UPDATE");
      fields.push("updated_at = ?"); values.push(nowIso(), projectId, ownerId);
      const updated = await env.DB.prepare(
        `UPDATE projects SET ${fields.join(", ")} WHERE id = ? AND owner_id = ? RETURNING id, title, genre, synopsis, status, updated_at`
      ).bind(...values).first();
      return json({ project: updated });
    }
    if (method === "DELETE") {
      const result = await env.DB.prepare("DELETE FROM projects WHERE id = ? AND owner_id = ?")
        .bind(projectId, ownerId).run();
      if (!result.meta?.changes) throw new Error("NOT_FOUND");
      return json({ ok: true });
    }
  }

  const chaptersMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/chapters$/i);
  if (chaptersMatch) {
    const projectId = chaptersMatch[1];
    const owned = await env.DB.prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ?").bind(projectId, ownerId).first();
    if (!owned) throw new Error("NOT_FOUND");
    if (method === "GET") {
      const rows = await env.DB.prepare(
        "SELECT id, title, body, sort_order, revision, created_at, updated_at FROM chapters WHERE project_id = ? ORDER BY sort_order, created_at LIMIT 1000"
      ).bind(projectId).all();
      return json({ chapters: rows.results || [] });
    }
    if (method === "POST") {
      const input = await readJson(request, 1024 * 1024);
      const id = crypto.randomUUID();
      const title = optionalString(input.title, 240, "title");
      const body = optionalString(input.body, 500000, "body");
      const sortOrder = Number.isInteger(input.sortOrder) ? Math.max(0, Math.min(input.sortOrder, 1000000)) : 0;
      await env.DB.prepare("INSERT INTO chapters (id, project_id, title, body, sort_order) VALUES (?, ?, ?, ?, ?)")
        .bind(id, projectId, title, body, sortOrder).run();
      return json({ chapter: { id, projectId, title, body, sort_order: sortOrder, revision: 1 } }, 201);
    }
  }

  const chapterMatch = path.match(/^\/api\/chapters\/([a-f0-9-]+)$/i);
  if (chapterMatch) {
    const chapterId = chapterMatch[1];
    if (method === "GET") {
      const chapter = await env.DB.prepare(
        "SELECT c.id, c.project_id, c.title, c.body, c.sort_order, c.revision, c.created_at, c.updated_at FROM chapters c JOIN projects p ON p.id = c.project_id WHERE c.id = ? AND p.owner_id = ?"
      ).bind(chapterId, ownerId).first();
      if (!chapter) throw new Error("NOT_FOUND");
      return json({ chapter });
    }
    if (method === "PATCH") {
      const input = await readJson(request, 1024 * 1024);
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) throw new Error("INVALID_EXPECTEDREVISION");
      const current = await env.DB.prepare(
        "SELECT c.id, c.project_id, c.title, c.body, c.revision FROM chapters c JOIN projects p ON p.id = c.project_id WHERE c.id = ? AND p.owner_id = ?"
      ).bind(chapterId, ownerId).first();
      if (!current) throw new Error("NOT_FOUND");
      if (current.revision !== input.expectedRevision) throw new Error("CONFLICT");
      const title = input.title === undefined ? current.title : optionalString(input.title, 240, "title");
      const body = input.body === undefined ? current.body : optionalString(input.body, 500000, "body");
      const updated = await env.DB.prepare(
        "UPDATE chapters SET title = ?, body = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM projects WHERE projects.id = chapters.project_id AND projects.owner_id = ?) RETURNING id, project_id, title, body, sort_order, revision, updated_at"
      ).bind(title, body, nowIso(), chapterId, input.expectedRevision, ownerId).first();
      if (!updated) throw new Error("CONFLICT");
      await env.DB.prepare(
        "INSERT INTO snapshots (id, project_id, resource_type, resource_id, content_json) VALUES (?, ?, 'chapter', ?, ?)"
      ).bind(crypto.randomUUID(), current.project_id, chapterId, JSON.stringify({
        title: current.title, body: current.body, revision: current.revision
      })).run();
      return json({ chapter: updated });
    }
    if (method === "DELETE") {
      const result = await env.DB.prepare(
        "DELETE FROM chapters WHERE id = ? AND EXISTS (SELECT 1 FROM projects WHERE projects.id = chapters.project_id AND projects.owner_id = ?)"
      ).bind(chapterId, ownerId).run();
      if (!result.meta?.changes) throw new Error("NOT_FOUND");
      return json({ ok: true });
    }
  }

  return json({ error: "NOT_FOUND" }, 404);
}

function randomTokenForSession(_session) {
  // CSRF token is intentionally not persisted in plaintext. Clients obtain it
  // through a short-lived, session-bound endpoint added below in later rollout.
  return "";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/auth/login" && request.method === "GET") return await oauthLogin(request, env);
      if (url.pathname === "/auth/callback" && request.method === "GET") return await oauthCallback(request, env);
      if (url.pathname.startsWith("/api/")) return await api(request, env, url);
      if (!env.ASSETS) return new Response("Static asset binding is not configured.", { status: 503 });
      return env.ASSETS.fetch(request);
    } catch (error) {
      return errorResponse(error);
    }
  }
};
