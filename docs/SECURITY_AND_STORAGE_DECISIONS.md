# STORYFORGE — Security & Storage Decision Record

Date: 22 November 2026
Branch: `feature/storyforge-studio-80`
Status: Decision recorded; implementation intentionally blocked pending owner configuration and storage approval.

## 1. Current application boundary

At the initial architecture audit, the application was a static-file Node HTTP server and browser localStorage prototype. The Cloudflare Worker now provides owner-only GitHub OAuth, server-side sessions, project/chapter APIs, chapter snapshots, and project-scoped studio APIs. The browser app source is connected to these APIs and retains local recovery drafts. No live D1 database, OAuth app, secrets, or deployed auth environment has been configured.

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

## 3. AI provider isolation contract

- The owner has explicitly chosen not to use GitHub Copilot for STORYFORGE.
- No AI text or image provider is currently approved or connected. AI actions must remain disabled until a provider and its cost/authorization model are explicitly approved.
- Do not use a shared owner credential, silently fall back to an environment login, or expose any provider secret to browser code, localStorage, repository files, or chat.
- Every future AI request must be server-side, authenticated, scoped to the active Project ID, and limited to that project's approved canon and manuscript context.
- Prompt preview, user editing, and explicit confirmation must happen before any external AI request.
- Provider quotas, retention, privacy, content policy, rate limits, and costs must be documented before enabling the integration.
- If a provider cannot meet project isolation and secret-handling requirements, do not integrate it.

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
- Keep the UI's local-recovery and Cloud-sync states distinct. Do not claim live Cloud persistence until the owner provisions D1/OAuth and the deployed integration tests pass.
- Never silently fall back to local disk on a production host for durable user content.
- No AI provider has been approved; do not introduce Copilot or paid hosting.

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

1. Owner creates the GitHub OAuth App and configures the exact callback URL.
2. Owner creates the Cloudflare D1 database, configures bindings/secrets, and applies migrations 0001–0003.
3. Confirm GitHub Actions checks pass; run the Worker against local D1 and complete owner-denial, CSRF/origin, isolation, import retry, autosave, conflict, ordering, deletion, and restore tests.
4. Configure independent encrypted off-site backups and test a full restore.
5. Validate DOCX/EPUB in common readers and print-to-PDF on desktop and Android.
6. Review tablet layout, accessibility, and contrast against the approved Figma source.
7. Integrate an owner-approved AI provider only after documenting runtime compatibility, project isolation, privacy, quotas, and cost.

## Sources reviewed

- Render free services and data-retention limitations: https://render.com/docs/free
- Render persistent disks: https://render.com/docs/disks
- Render pricing: https://render.com/pricing


## Current code decisions — 22 November 2026

- GitHub OAuth is used only to verify the one allowlisted owner account. The OAuth access token is discarded after identity verification.
- The Worker stores hashed session identifiers and hashed CSRF tokens; the session cookie is host-only, Secure, HttpOnly, and SameSite=Lax. CSRF uses a separate host-only, Secure, HttpOnly, SameSite=Strict cookie plus a same-origin request header.
- All project and chapter queries are scoped to the authenticated owner. Project modules are scoped by project ID; relationship foreign keys prevent cross-project character links.
- Chapter updates use optimistic revision checks and return conflict responses rather than silently overwriting a newer revision. Prior chapter content is stored as snapshots and can be restored.
- The editor now saves selected projects and chapters through the authenticated Worker APIs, while retaining per-chapter local recovery drafts and an explicit idempotent import path. Local data is not deleted by import. Live Cloud sync remains unavailable until the owner provisions and configures Cloudflare D1 and GitHub OAuth.
- Optional Telegram backup requires Worker secrets and remains separate from independent encrypted D1 backups.
- AI integration remains disabled until the owner approves a provider; the user has explicitly ruled out GitHub Copilot.
