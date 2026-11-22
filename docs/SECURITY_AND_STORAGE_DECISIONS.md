# STORYFORGE — Security & Storage Decision Record

Date: 22 November 2026
Branch: `feature/storyforge-studio-80`
Status: Decision recorded; implementation intentionally blocked pending owner configuration and storage approval.

## 1. Current application boundary

The current application is a static-file Node HTTP server with a Telegram backup endpoint. Project metadata, manuscript fields, and notes are stored in browser `localStorage`. There is no login, server-side session, database, owner authorization, or server-enforced Project ID boundary.

A Project ID stored in the browser is not an authorization boundary. No project-scoped API may be exposed until the server derives the user identity from a verified session and checks ownership on every request.

## 2. Owner-only identity contract

The first private beta must use GitHub OAuth and a server-side owner allowlist.

Required behavior:
- OAuth state must be cryptographically random, single-use, and validated on callback.
- Session identifiers must be random, stored server-side as hashes, and delivered only in Secure, HttpOnly, SameSite cookies over HTTPS.
- The server must resolve the authenticated GitHub numeric user ID and compare it with an explicit owner allowlist.
- Missing OAuth configuration, missing owner allowlist, invalid state, failed token exchange, or unavailable session storage must fail closed.
- Logout revokes the server-side session.
- No client-side username, URL parameter, localStorage value, or UI label can grant access.
- Never commit OAuth client secrets, session secrets, tokens, or database credentials.

Before enabling the OAuth flow, the owner must create a GitHub OAuth App and configure its callback URL and client secret in the hosting provider's secret store. Do not ask the owner to paste secrets into chat or commit them to the public repository.

## 3. Copilot isolation contract

Use the official Node package `@github/copilot-sdk`, only after the OAuth identity/session layer is complete.

For every authenticated user:
- Pass that user's own GitHub OAuth token explicitly to their Copilot SDK client/session.
- Set `useLoggedInUser: false` to prevent fallback to a shared CLI login or environment credential.
- Do not share the owner's Copilot client, token, session, or quota with another user.
- Treat Copilot subscription entitlement, quota, token refresh, and re-authentication as user-specific.
- Keep token material server-side and encrypted at rest if persisted.
- AI requests must be scoped to a Project ID that the authenticated user owns.

The SDK does not manage the OAuth lifecycle; token storage, refresh, expiry, and re-authentication are application responsibilities.

## 4. Storage and hosting decision

Do not use the Render free filesystem for user content. Render documents that its filesystem is ephemeral and loses changes on restart, redeploy, or spin-down.

Do not use Render Free Postgres as the production manuscript store: the free database expires after 30 days, has a 1 GB limit, and has no backups. Render Free web services also spin down after 15 minutes of inactivity.

A persistent Render disk requires a paid web service. Render's currently published pricing lists the smallest paid web compute tier at $7/month and SSD storage at $0.25/GB/month. This is a potential cost and is NOT approved.

Decision:
- No paid service, paid database, persistent disk, billing activation, or production deployment is authorized by this record.
- Keep the app clearly labeled as local-device prototype until a durable storage provider and its full cost/retention/backup terms are reviewed and explicitly approved.
- Evaluate alternative free tiers only with current official pricing, data retention, backup, sleeping, and export limits documented before selection.
- Never silently fall back to local disk on a production host for durable user content.

## 5. Project data isolation contract

Every project-owned resource must carry a stable Project ID and be queried through an authenticated owner-scoped repository/service. The server must reject:
- Missing or malformed Project IDs.
- Requests for projects not owned by the session user.
- Child resource IDs that do not belong to the requested Project ID.
- Cross-project references, including chapters, characters, notes, plot, lore, timeline, and assets.

Required automated tests:
1. User A cannot read, update, delete, export, or snapshot User B's project.
2. Project A cannot read or mutate Project B's child resources, even when names or child IDs are supplied in a mismatched route.
3. Two projects with duplicate character names remain isolated.
4. Missing auth, missing owner allowlist, expired/revoked session, and invalid CSRF state are denied.
5. Backup/restore validates ownership and never imports data into another user's project implicitly.

## 6. Immediate next steps

1. Build and test the local Node 22 smoke-test harness and baseline UI behavior.
2. Define the repository interfaces and schema migrations for users, sessions, OAuth credentials, projects, chapters, project memories, and snapshots.
3. Compare durable storage options and total costs; obtain approval before provisioning.
4. Implement GitHub OAuth and owner allowlist only after the owner has supplied OAuth App configuration through hosting secrets.
5. Implement project and chapter APIs with server-enforced ownership before enabling cross-device sync.
6. Add version snapshots, restore, conflict handling, and TXT export.
7. Integrate Copilot after identity and project isolation tests pass.

## Sources reviewed

- GitHub Copilot SDK OAuth guide: https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth
- GitHub Copilot SDK authentication guide: https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate
- Render free services and data-retention limitations: https://render.com/docs/free
- Render persistent disks: https://render.com/docs/disks
- Render pricing: https://render.com/pricing
