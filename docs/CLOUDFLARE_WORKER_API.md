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

Sessions are random opaque tokens; only SHA-256 hashes are stored in D1. The session cookie is Secure, HttpOnly, SameSite=Lax and expires after seven days. A separate SameSite=Strict CSRF cookie is readable by the browser and must match both the request header and the hash stored in D1 for state-changing API calls. Logout revokes the session.

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
| GET / POST | `/api/projects/:id/chapters` | List or create chapters |
| GET / PATCH / DELETE | `/api/chapters/:id` | Read, revision-check update, or delete a chapter |
| GET | `/api/chapters/:id/snapshots` | List chapter snapshots |
| POST | `/api/chapters/:id/restore` | Restore a snapshot while recording the current state |
| GET / POST | `/api/projects/:id/characters` | List or create characters |
| GET / POST | `/api/projects/:id/relationships` | List or create character relationships |
| GET / POST | `/api/projects/:id/plot-threads` | List or create plot threads |
| GET / POST | `/api/projects/:id/world-lore` | List or create world lore |
| GET / POST | `/api/projects/:id/timeline` | List or create timeline events |
| GET / POST | `/api/projects/:id/notes` | List or create notes |

The module collections also accept PATCH and DELETE at `/api/projects/:id/:collection/:itemId`. Every collection is project-scoped. Character relationships have composite foreign keys that prevent linking characters across projects.

Chapter updates require `expectedRevision`. A stale revision returns HTTP 409 instead of silently overwriting newer text. Before a successful update, the previous chapter content is stored in the snapshots table. Restore also creates a snapshot of the current chapter before replacing it.

Telegram backup remains a separate secret-protected endpoint. It is optional and does not replace an independent encrypted database backup.

## Important frontend limitation

The current manuscript editor still uses browser localStorage and explicitly labels saves as device-local. The GitHub sign-in controls only show account status; the editor has not yet been migrated to these APIs. Do not describe the current UI as cloud-synced, and do not remove local data or migrate it automatically until an explicit import/migration workflow with conflict and rollback handling is implemented.

## Deployment checklist

1. Create a GitHub OAuth App and set its callback URL.
2. Create the D1 database and apply all migrations locally, then remotely.
3. Configure the D1 and static asset bindings.
4. Set OAuth and optional Telegram Worker secrets without committing them.
5. Deploy only to a preview/private test hostname after owner approval.
6. Verify login denial for a non-owner account, session expiry, logout, CSRF rejection, project isolation, revision conflicts, snapshot restore, and Telegram backup.
7. Confirm the frontend continues to label manuscript saves as local until API integration is complete.

No Cloudflare resource, OAuth app, secret, billing setting, or deployment is created by this repository change.
