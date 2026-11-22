# STORYFORGE Cloudflare Worker — Auth and API Contract

## Owner-only sign-in

The Worker implements GitHub OAuth for one allowlisted GitHub account. It does not provide public registration or member invitations.

Required Worker bindings:
- `DB`: Cloudflare D1 binding.
- `ASSETS`: static asset binding.

Required runtime configuration:
- `GITHUB_CLIENT_ID`: OAuth App client ID.
- `GITHUB_CLIENT_SECRET`: OAuth App client secret; store as a Worker secret.
- `GITHUB_OWNER_ID`: numeric GitHub user ID allowed into this private beta; store as a Worker secret.
- `BACKUP_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`: optional Telegram backup configuration; store sensitive values as Worker secrets.

Configure the GitHub OAuth App callback URL to exactly match the deployed origin plus `/auth/callback`. The login handler also sends the current origin's callback URI to GitHub.

The callback verifies a one-time, expiring, hashed OAuth state bound to a Secure browser cookie. It checks the GitHub numeric user ID against `GITHUB_OWNER_ID` before creating or updating the owner row. The GitHub access token is discarded after identity verification and is not stored or exposed to browser JavaScript.

Sessions are random opaque tokens; only SHA-256 hashes are stored in D1. The session cookie is Secure, HttpOnly, SameSite=Lax and expires after seven days. A separate host-only, Secure, HttpOnly, SameSite=Strict CSRF cookie is sent automatically by the browser. The CSRF token is returned by the session endpoint and must match both the request header and the hash stored in D1 for state-changing API calls. Logout revokes the session.

## API endpoints

All endpoints are same-origin. Mutating endpoints require the `X-CSRF-Token` header and matching CSRF cookie.

| Method | Path | Purpose |
|---|---|---|
| GET | `/auth/login` | Start GitHub OAuth |
| GET | `/auth/callback` | Complete OAuth |
| GET | `/api/session` | Check session and obtain CSRF token |
| POST | `/api/logout` | Revoke current session |
| GET / POST | `/api/projects` | List or create projects |
| GET / PATCH / DELETE | `/api/projects/:id` | Read, update, or delete an owned project |
| GET / POST | `/api/projects/:id/chapters` | List compact chapter metadata or create a chapter |
| GET / PATCH / DELETE | `/api/chapters/:id` | Read, revision-check update, or delete a chapter |
| POST | `/api/chapters/:id/move` | Move a chapter up or down within its project |
| GET | `/api/chapters/:id/snapshots` | List chapter snapshots |
| POST | `/api/chapters/:id/restore` | Restore a snapshot while recording the current state |
| GET / POST | `/api/projects/:id/characters` | List or create characters |
| GET / POST | `/api/projects/:id/relationships` | List or create character relationships |
| GET / POST | `/api/projects/:id/plot-threads` | List or create plot threads |
| GET / POST | `/api/projects/:id/world-lore` | List or create world lore |
| GET / POST | `/api/projects/:id/timeline` | List or create timeline events |
| GET / POST | `/api/projects/:id/notes` | List or create notes |

The module collections also accept PATCH and DELETE at `/api/projects/:id/:collection/:itemId`. Every collection is project-scoped. Character relationships have composite foreign keys that prevent linking characters across projects.

Chapter updates require `expectedRevision`. A stale revision returns HTTP 409 instead of silently overwriting newer text. The snapshot insert and revision-checked update run in one D1 batch so a successful text update has its previous version recorded atomically. Restore also snapshots the current chapter before replacing it. Chapter ordering is changed by the owner-scoped move endpoint. Permanently deleting a chapter removes its chapter snapshots in the same D1 batch; deleting a project cascades to all its data. Create endpoints accept optional UUIDv4 `clientId` values and use insert-if-absent semantics to make local-data import retries idempotent. Chapter writes also accept a validated `wordCount` supplied by the browser's Thai-aware word counter; the Worker persists it without spending its CPU budget on full manuscript segmentation.

Telegram backup remains a separate secret-protected endpoint. It is optional and does not replace an independent encrypted database backup.

## Frontend integration status

The browser app now calls these APIs for project listing/creation/update, chapter creation and autosave, snapshot history/restore, project memory, and Character/Relationship/Plot/World/Timeline/Notes CRUD. Cloud saves use optimistic chapter revisions. Local chapter drafts are retained per Chapter ID and can be recovered after a conflict. Local-to-cloud import is an explicit user action and uses stable client-generated IDs so a retry does not create duplicate projects, chapters, or notes.

The browser still keeps a local recovery copy and Global Memory on the device. Cloud operations are not live until the owner configures and deploys the Worker, D1, OAuth App, and secrets. No local data is deleted by the import flow.

## Deployment checklist

1. Create a GitHub OAuth App and set its callback URL.
2. Create the D1 database and apply all migrations locally, then remotely.
3. Configure the D1 and static asset bindings.
4. Set OAuth and optional Telegram Worker secrets without committing them.
5. Deploy only to a preview/private test hostname after owner approval.
6. Verify login denial for a non-owner account, session expiry, logout, CSRF rejection, project isolation, revision conflicts, snapshot restore, and Telegram backup.
7. Confirm the UI reports Cloud saves only after the Worker/D1 connection is configured, while retaining the per-chapter device recovery copies.

No Cloudflare resource, OAuth app, secret, billing setting, or deployment is created by this repository change.

The chapters collection returns metadata including the persisted `word_count`; the browser supplies Thai-aware counts and the Worker validates/persists them. The full body is fetched only for the selected chapter, keeping project-wide dashboard progress efficient without spending Worker CPU on segmentation of every manuscript.
