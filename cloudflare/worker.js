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
const redirect = (url, extraHeaders = {}) => {
  const headers = new Headers({ Location: url, "Cache-Control": "no-store" });
  for (const [key, value] of Object.entries(extraHeaders)) {
    if (key.toLowerCase() === "set-cookie" && Array.isArray(value)) {
      for (const item of value) headers.append("Set-Cookie", item);
    } else {
      headers.set(key, value);
    }
  }
  return new Response(null, { status: 302, headers });
};
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
    if (part.slice(0, index).trim() === name) {
      try { return decodeURIComponent(part.slice(index + 1).trim()); } catch { return null; }
    }
  }
  return null;
};
const cookie = (name, value, maxAge, path = "/") =>
  `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;
const clearCookie = (name, path = "/") =>
  `${name}=; Path=${path}; Max-Age=0; Secure; HttpOnly; SameSite=Lax`;
const csrfCookie = (value, maxAge = SESSION_TTL_SECONDS) =>
  `storyforge_csrf=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; Secure; SameSite=Strict`;

const readJson = async (request, maxBytes = 64 * 1024) => {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > maxBytes) throw new Error("BODY_TOO_LARGE");
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error("BODY_TOO_LARGE");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_JSON");
    return parsed;
  } catch { throw new Error("INVALID_JSON"); }
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
  const constraint = /FOREIGN KEY constraint failed|UNIQUE constraint failed|CHECK constraint failed/i.test(code);
  const status = code === "BODY_TOO_LARGE" ? 413 :
    code === "INVALID_JSON" || code.startsWith("INVALID_") ? 400 :
    code === "UNAUTHENTICATED" ? 401 :
    code === "FORBIDDEN" ? 403 :
    code === "NOT_FOUND" ? 404 :
    code === "CONFLICT" || constraint ? 409 : 500;
  return json({ error: status === 500 ? "INTERNAL_ERROR" : constraint ? "CONSTRAINT_VIOLATION" : code }, status);
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
    const origin = request.headers.get("Origin") || "";
    if (!origin || origin !== new URL(request.url).origin) throw new Error("FORBIDDEN");
    const supplied = request.headers.get("X-CSRF-Token") || "";
    const csrfCookieValue = cookieValue(request, "storyforge_csrf") || "";
    if (!supplied || !csrfCookieValue || !safeEqual(supplied, csrfCookieValue) ||
        !safeEqual(await sha256(supplied), session.csrf_hash)) throw new Error("FORBIDDEN");
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
    "Set-Cookie": [
      clearState,
      cookie(SESSION_COOKIE, sessionToken, SESSION_TTL_SECONDS),
      csrfCookie(csrfToken)
    ]
  });
}

async function api(request, env, url) {
  if (!env.DB) return json({ error: "DATABASE_NOT_CONFIGURED" }, 503);
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, service: "storyforge-worker", databaseBindingPresent: true });
  }
  if (path === "/api/telegram-backup" && method === "POST") {
    if (!env.BACKUP_SECRET || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
      return json({ error: "TELEGRAM_BACKUP_NOT_CONFIGURED" }, 503);
    }
    const supplied = request.headers.get("x-backup-secret") || "";
    if (!safeEqual(supplied, env.BACKUP_SECRET)) return json({ error: "FORBIDDEN" }, 403);
    const input = await readJson(request, 20 * 1024 * 1024);
    const filename = requiredString(input.filename || "storyforge-backup.json", 120, "filename")
      .replace(/[^a-zA-Z0-9._-]/g, "_");
    const content = requiredString(input.content, 19 * 1024 * 1024, "content");
    const form = new FormData();
    form.append("chat_id", env.TELEGRAM_CHAT_ID);
    form.append("document", new Blob([content], { type: "application/json" }), filename);
    const telegram = await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendDocument", {
      method: "POST",
      body: form
    });
    const result = await telegram.json();
    if (!telegram.ok || !result.ok) return json({ error: "TELEGRAM_SEND_FAILED" }, 502);
    return json({ success: true });
  }
  if (path === "/api/session" && method === "GET") {
    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.GITHUB_OWNER_ID) {
      return json({ error: "AUTH_NOT_CONFIGURED" }, 503);
    }
    const session = await getSession(request, env);
    if (!session) return json({ authenticated: false });
    const csrfToken = cookieValue(request, "storyforge_csrf") || "";
    if (!csrfToken || !safeEqual(await sha256(csrfToken), session.csrf_hash)) {
      return json({ authenticated: false }, 401);
    }
    return json({ authenticated: true, user: { githubLogin: session.github_login }, userId: session.user_id, csrfToken });
  }
  if (path === "/api/logout" && method === "POST") {
    const session = await requireSession(request, env, true);
    await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE session_hash = ?")
      .bind(nowIso(), session.session_hash).run();
    return json({ ok: true }, 200, {
      "Set-Cookie": [clearCookie(SESSION_COOKIE), clearCookie("storyforge_csrf")]
    });
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
    const clientId = input.clientId;
    if (clientId !== undefined && (typeof clientId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId))) {
      throw new Error("INVALID_CLIENTID");
    }
    const id = clientId || crypto.randomUUID();
    const title = requiredString(input.title, 160, "title");
    const genre = optionalString(input.genre, 100, "genre");
    const synopsis = optionalString(input.synopsis, 10000, "synopsis");
    const inserted = await env.DB.prepare(
      "INSERT OR IGNORE INTO projects (id, owner_id, title, genre, synopsis) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, ownerId, title, genre, synopsis).run();
    const project = await env.DB.prepare(
      "SELECT id, owner_id, title, genre, synopsis, status, created_at, updated_at FROM projects WHERE id = ?"
    ).bind(id).first();
    if (!project || project.owner_id !== ownerId) throw new Error("CONFLICT");
    return json({ project, created: Boolean(inserted.meta?.changes) }, inserted.meta?.changes ? 201 : 200);
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

  const moduleMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/(characters|relationships|plot-threads|world-lore|timeline|notes)(?:\/([a-f0-9-]+))?$/i);
  if (moduleMatch) {
    const projectId = moduleMatch[1];
    const collection = moduleMatch[2];
    const itemId = moduleMatch[3] || null;
    const modules = {
      characters: { table: "characters", fields: { name: ["string", 160], role: ["string", 80], profile_json: ["json", 20000], sort_order: ["number", 1000000] }, required: ["name"] },
      relationships: { table: "relationships", fields: { source_character_id: ["id", 80], target_character_id: ["id", 80], relationship_type: ["string", 100], description: ["string", 5000] }, required: ["source_character_id", "target_character_id"] },
      "plot-threads": { table: "plot_threads", fields: { title: ["string", 200], summary: ["string", 10000], status: ["status", 30], sort_order: ["number", 1000000] }, required: ["title"] },
      "world-lore": { table: "world_lore", fields: { category: ["string", 80], title: ["string", 200], content: ["string", 30000], sort_order: ["number", 1000000] }, required: ["title"] },
      timeline: { table: "timeline_events", fields: { title: ["string", 200], description: ["string", 10000], story_time: ["string", 120], sort_order: ["number", 1000000] }, required: ["title"] },
      notes: { table: "story_notes", fields: { title: ["string", 200], content: ["string", 30000], note_type: ["string", 60], pinned: ["boolean", 1] }, required: [] }
    };
    const config = modules[collection];
    const owned = await env.DB.prepare("SELECT id FROM projects WHERE id = ? AND owner_id = ?").bind(projectId, ownerId).first();
    if (!owned) throw new Error("NOT_FOUND");

    const normalize = (field, value) => {
      const [type, limit] = config.fields[field];
      if (type === "string") return optionalString(value, limit, field);
      if (type === "id") return requiredString(value, limit, field);
      if (type === "number") {
        if (!Number.isInteger(value) || value < 0 || value > limit) throw new Error("INVALID_" + field.toUpperCase());
        return value;
      }
      if (type === "boolean") {
        if (typeof value !== "boolean") throw new Error("INVALID_" + field.toUpperCase());
        return value ? 1 : 0;
      }
      if (type === "status") {
        if (!["planned", "in_progress", "completed", "paused"].includes(value)) throw new Error("INVALID_STATUS");
        return value;
      }
      if (type === "json") {
        const serialized = typeof value === "string" ? value : JSON.stringify(value);
        if (typeof serialized !== "string" || serialized.length > limit) throw new Error("INVALID_" + field.toUpperCase());
        try { JSON.parse(serialized); } catch { throw new Error("INVALID_" + field.toUpperCase()); }
        return serialized;
      }
      throw new Error("INVALID_FIELD");
    };

    if (!itemId && method === "GET") {
      const rows = await env.DB.prepare(
        `SELECT * FROM ${config.table} WHERE project_id = ? ORDER BY created_at DESC LIMIT 500`
      ).bind(projectId).all();
      return json({ items: rows.results || [] });
    }
    if (!itemId && method === "POST") {
      const input = await readJson(request, 128 * 1024);
      const values = {};
      for (const [field, spec] of Object.entries(config.fields)) {
        if (input[field] !== undefined) values[field] = normalize(field, input[field]);
        else if (config.required.includes(field)) throw new Error("INVALID_" + field.toUpperCase());
      }
      if (collection === "relationships" && values.source_character_id === values.target_character_id) throw new Error("INVALID_RELATIONSHIP");
      const clientId = input.clientId;
      if (clientId !== undefined && (typeof clientId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId))) {
        throw new Error("INVALID_CLIENTID");
      }
      const id = clientId || crypto.randomUUID();
      const columns = ["id", "project_id", ...Object.keys(values)];
      const params = [id, projectId, ...Object.values(values)];
      const marks = columns.map(() => "?").join(", ");
      const inserted = await env.DB.prepare(
        `INSERT OR IGNORE INTO ${config.table} (${columns.join(", ")}) VALUES (${marks})`
      ).bind(...params).run();
      const item = await env.DB.prepare(
        `SELECT * FROM ${config.table} WHERE id = ?`
      ).bind(id).first();
      if (!item || item.project_id !== projectId) throw new Error("CONFLICT");
      return json({ item, created: Boolean(inserted.meta?.changes) }, inserted.meta?.changes ? 201 : 200);
    }
    if (itemId && method === "PATCH") {
      const input = await readJson(request, 128 * 1024);
      const values = {};
      for (const field of Object.keys(config.fields)) {
        if (input[field] !== undefined) values[field] = normalize(field, input[field]);
      }
      if (!Object.keys(values).length) throw new Error("INVALID_UPDATE");
      if (collection === "relationships") {
        const existing = await env.DB.prepare(
          "SELECT source_character_id, target_character_id FROM relationships WHERE id = ? AND project_id = ?"
        ).bind(itemId, projectId).first();
        if (!existing) throw new Error("NOT_FOUND");
        const source = values.source_character_id ?? existing.source_character_id;
        const target = values.target_character_id ?? existing.target_character_id;
        if (source === target) throw new Error("INVALID_RELATIONSHIP");
      }
      const sets = Object.keys(values).map(field => field + " = ?");
      const params = [...Object.values(values), nowIso(), itemId, projectId];
      sets.push("updated_at = ?");
      const updated = await env.DB.prepare(
        `UPDATE ${config.table} SET ${sets.join(", ")} WHERE id = ? AND project_id = ? RETURNING *`
      ).bind(...params).first();
      if (!updated) throw new Error("NOT_FOUND");
      return json({ item: updated });
    }
    if (itemId && method === "DELETE") {
      const deleted = await env.DB.prepare(
        `DELETE FROM ${config.table} WHERE id = ? AND project_id = ? RETURNING id`
      ).bind(itemId, projectId).first();
      if (!deleted) throw new Error("NOT_FOUND");
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
      const input = await readJson(request, 2 * 1024 * 1024);
      const clientId = input.clientId;
      if (clientId !== undefined && (typeof clientId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId))) {
        throw new Error("INVALID_CLIENTID");
      }
      const id = clientId || crypto.randomUUID();
      const title = optionalString(input.title, 240, "title");
      const body = optionalString(input.body, 500000, "body");
      const sortOrder = Number.isInteger(input.sortOrder) ? Math.max(0, Math.min(input.sortOrder, 1000000)) : 0;
      const inserted = await env.DB.prepare(
        "INSERT OR IGNORE INTO chapters (id, project_id, title, body, sort_order) VALUES (?, ?, ?, ?, ?)"
      ).bind(id, projectId, title, body, sortOrder).run();
      const chapter = await env.DB.prepare(
        "SELECT id, project_id, title, body, sort_order, revision, created_at, updated_at FROM chapters WHERE id = ?"
      ).bind(id).first();
      if (!chapter || chapter.project_id !== projectId) throw new Error("CONFLICT");
      return json({ chapter, created: Boolean(inserted.meta?.changes) }, inserted.meta?.changes ? 201 : 200);
    }
  }

  const chapterMoveMatch = path.match(/^\/api\/chapters\/([a-f0-9-]+)\/move$/i);
  if (chapterMoveMatch && method === "POST") {
    const chapterId = chapterMoveMatch[1];
    const input = await readJson(request);
    if (!["up", "down"].includes(input.direction)) throw new Error("INVALID_DIRECTION");
    const current = await env.DB.prepare(
      "SELECT c.id, c.project_id, c.sort_order FROM chapters c JOIN projects p ON p.id = c.project_id WHERE c.id = ? AND p.owner_id = ?"
    ).bind(chapterId, ownerId).first();
    if (!current) throw new Error("NOT_FOUND");
    const operator = input.direction === "up" ? "<" : ">";
    const ordering = input.direction === "up" ? "DESC" : "ASC";
    const neighbor = await env.DB.prepare(
      `SELECT id, sort_order FROM chapters WHERE project_id = ? AND sort_order ${operator} ? ORDER BY sort_order ${ordering}, created_at ${ordering} LIMIT 1`
    ).bind(current.project_id, current.sort_order).first();
    if (!neighbor) return json({ ok: true, moved: false });
    await env.DB.batch([
      env.DB.prepare("UPDATE chapters SET sort_order = ?, updated_at = ? WHERE id = ? AND project_id = ?")
        .bind(neighbor.sort_order, nowIso(), current.id, current.project_id),
      env.DB.prepare("UPDATE chapters SET sort_order = ?, updated_at = ? WHERE id = ? AND project_id = ?")
        .bind(current.sort_order, nowIso(), neighbor.id, current.project_id)
    ]);
    return json({ ok: true, moved: true });
  }

  const chapterSnapshotsMatch = path.match(/^\/api\/chapters\/([a-f0-9-]+)\/snapshots$/i);
  if (chapterSnapshotsMatch && method === "GET") {
    const chapterId = chapterSnapshotsMatch[1];
    const rows = await env.DB.prepare(
      "SELECT s.id, s.resource_id, s.content_json, s.created_at FROM snapshots s JOIN projects p ON p.id = s.project_id JOIN chapters c ON c.id = s.resource_id AND c.project_id = p.id WHERE s.resource_type = 'chapter' AND s.resource_id = ? AND p.owner_id = ? ORDER BY s.created_at DESC LIMIT 100"
    ).bind(chapterId, ownerId).all();
    return json({ snapshots: rows.results || [] });
  }

  const chapterRestoreMatch = path.match(/^\/api\/chapters\/([a-f0-9-]+)\/restore$/i);
  if (chapterRestoreMatch && method === "POST") {
    const chapterId = chapterRestoreMatch[1];
    const input = await readJson(request);
    const snapshotId = requiredString(input.snapshotId, 80, "snapshotId");
    const current = await env.DB.prepare(
      "SELECT c.id, c.project_id, c.title, c.body, c.sort_order, c.revision FROM chapters c JOIN projects p ON p.id = c.project_id WHERE c.id = ? AND p.owner_id = ?"
    ).bind(chapterId, ownerId).first();
    if (!current) throw new Error("NOT_FOUND");
    const snapshot = await env.DB.prepare(
      "SELECT s.content_json FROM snapshots s JOIN projects p ON p.id = s.project_id WHERE s.id = ? AND s.resource_id = ? AND s.resource_type = 'chapter' AND p.owner_id = ?"
    ).bind(snapshotId, chapterId, ownerId).first();
    if (!snapshot) throw new Error("NOT_FOUND");
    let restored;
    try { restored = JSON.parse(snapshot.content_json); } catch { throw new Error("INVALID_SNAPSHOT"); }
    const title = optionalString(restored.title, 240, "title");
    const body = optionalString(restored.body, 500000, "body");
    const sortOrder = Number.isInteger(restored.sort_order) ? Math.max(0, Math.min(restored.sort_order, 1000000)) : current.sort_order;
    const results = await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO snapshots (id, project_id, resource_type, resource_id, content_json) SELECT ?, project_id, 'chapter', id, json_object('title', title, 'body', body, 'sort_order', sort_order, 'revision', revision) FROM chapters WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM projects WHERE projects.id = chapters.project_id AND projects.owner_id = ?)"
      ).bind(crypto.randomUUID(), chapterId, current.revision, ownerId),
      env.DB.prepare(
        "UPDATE chapters SET title = ?, body = ?, sort_order = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM projects WHERE projects.id = chapters.project_id AND projects.owner_id = ?) RETURNING id, project_id, title, body, sort_order, revision, updated_at"
      ).bind(title, body, sortOrder, nowIso(), chapterId, current.revision, ownerId)
    ]);
    const updated = results[1]?.results?.[0];
    if (!updated || !results[0]?.meta?.changes) throw new Error("CONFLICT");
    return json({ chapter: updated, restoredFrom: snapshotId });
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
      const input = await readJson(request, 2 * 1024 * 1024);
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) throw new Error("INVALID_EXPECTEDREVISION");
      const current = await env.DB.prepare(
        "SELECT c.id, c.project_id, c.title, c.body, c.sort_order, c.revision FROM chapters c JOIN projects p ON p.id = c.project_id WHERE c.id = ? AND p.owner_id = ?"
      ).bind(chapterId, ownerId).first();
      if (!current) throw new Error("NOT_FOUND");
      if (current.revision !== input.expectedRevision) throw new Error("CONFLICT");
      const title = input.title === undefined ? current.title : optionalString(input.title, 240, "title");
      const body = input.body === undefined ? current.body : optionalString(input.body, 500000, "body");
      const sortOrder = input.sortOrder === undefined ? current.sort_order :
        (Number.isInteger(input.sortOrder) && input.sortOrder >= 0 && input.sortOrder <= 1000000 ? input.sortOrder : (() => { throw new Error("INVALID_SORTORDER"); })());
      const results = await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO snapshots (id, project_id, resource_type, resource_id, content_json) SELECT ?, project_id, 'chapter', id, json_object('title', title, 'body', body, 'sort_order', sort_order, 'revision', revision) FROM chapters WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM projects WHERE projects.id = chapters.project_id AND projects.owner_id = ?)"
        ).bind(crypto.randomUUID(), chapterId, input.expectedRevision, ownerId),
        env.DB.prepare(
          "UPDATE chapters SET title = ?, body = ?, sort_order = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND EXISTS (SELECT 1 FROM projects WHERE projects.id = chapters.project_id AND projects.owner_id = ?) RETURNING id, project_id, title, body, sort_order, revision, updated_at"
        ).bind(title, body, sortOrder, nowIso(), chapterId, input.expectedRevision, ownerId)
      ]);
      const updated = results[1]?.results?.[0];
      if (!updated || !results[0]?.meta?.changes) throw new Error("CONFLICT");
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


export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/auth/login" && request.method === "GET") return await oauthLogin(request, env);
      if (url.pathname === "/auth/callback" && request.method === "GET") return await oauthCallback(request, env);
      if (url.pathname.startsWith("/api/")) return await api(request, env, url);
      if (!env.ASSETS) return new Response("Static asset binding is not configured.", { status: 503 });
      const assetResponse = await env.ASSETS.fetch(request);
      const headers = new Headers(assetResponse.headers);
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("X-Frame-Options", "DENY");
      headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers
      });
    } catch (error) {
      return errorResponse(error);
    }
  }
};
