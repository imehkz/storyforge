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

The selected target for a $0/month prototype/private beta is Cloudflare Workers Static Assets + Workers Free + D1 Free. This is a reviewed architecture choice, not a provisioned account or deployed service.

Current documented limits reviewed 22 November 2026:
- Workers Free: 100,000 Worker requests/day and 10 ms CPU per invocation.
- Static asset requests are free and unlimited; API routes that invoke the Worker count against Worker limits.
- D1 Free: 10 databases/account, 500 MB per database, 5 GB aggregate account storage, 5 million rows read/day, 100,000 rows written/day, and 7 days of Time Travel recovery.
- D1 daily read/write limits are enforced; queries fail until reset if exceeded.

The initial scaffold is in `cloudflare/` and the full record is in `docs/CLOUDFLARE_FREE_ARCHITECTURE.md`.

Important:
- D1 Time Travel is not an independent backup. Encrypted off-site exports are still required before irreplaceable manuscripts are stored.
- No Cloudflare account, D1 database, secret, custom domain, billing, or deployment has been created by this work.
- No paid service, paid plan, paid add-on, or billing activation is authorized.
- Use the provider's `.workers.dev` hostname for the first deployment if available; a custom domain may cost extra.
- Keep the UI clearly labeled as local-device prototype until OAuth, server-side authorization, D1 APIs, and end-to-end tests pass.
- Never silently fall back to local disk on a production host for durable user content.
- Copilot SDK is not part of the Workers runtime; do not share the owner's credentials or quota and do not silently introduce paid hosting.

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

1. Verify the Cloudflare Worker scaffold and D1 migration locally using the supported Wrangler toolchain.
2. Create a Cloudflare account and D1 database only through the owner's own account actions; do not activate paid billing.
3. Configure GitHub OAuth App callback and secrets in Cloudflare's secret store; never paste secrets into chat or commit them.
4. Implement OAuth state, token exchange, owner numeric-ID allowlist, encrypted token storage, session lifecycle, and CSRF protection.
5. Implement project/chapter APIs with server-enforced owner checks and cross-project isolation tests.
6. Migrate the browser UI from localStorage to API-backed projects and chapters only after the security gates pass.
7. Add snapshots, restore, conflict handling, encrypted off-site backup, and TXT export.
8. Integrate Copilot only when a compatible Node.js runtime is explicitly approved and each user uses their own GitHub identity.

## Sources reviewed

- GitHub Copilot SDK OAuth guide: https://docs.github.com/en/copilot/how-tos/copilot-sdk/setup/github-oauth
- GitHub Copilot SDK authentication guide: https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate
- Render free services and data-retention limitations: https://render.com/docs/free
- Render persistent disks: https://render.com/docs/disks
- Render pricing: https://render.com/pricing
