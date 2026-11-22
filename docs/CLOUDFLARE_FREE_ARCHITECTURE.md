# STORYFORGE — Cloudflare Free Architecture

Date: 22 November 2026  
Branch: `feature/storyforge-studio-80`  
Status: **Implementation scaffold only. No Cloudflare account, database, secret, or deployment has been provisioned.**

## Goal

Prepare a $0/month deployment path using Cloudflare Workers Static Assets + Workers Free + D1 Free, subject to published free-tier limits. This is a best-effort free-tier target, not a promise of unlimited capacity or permanent free service.

## Proposed topology

- Static UI: Cloudflare Workers Static Assets serving the existing `public/` directory.
- API runtime: Cloudflare Worker at `cloudflare/worker.js`.
- Relational storage: Cloudflare D1, with schema migration under `cloudflare/migrations/`.
- Authentication: GitHub OAuth, owner allowlist, hashed server-side sessions, CSRF protection. Not implemented yet.
- Copilot: excluded from the Worker runtime. The official `@github/copilot-sdk` requires a compatible Node.js runtime/process model and must not be assumed to run inside Workers.

## Verified free-tier constraints

According to Cloudflare's current official documentation reviewed on 22 November 2026:

- Workers Free: 100,000 Worker requests/day; 10 ms CPU time per invocation; 128 MB memory.
- Static asset requests are free and unlimited; API paths that invoke the Worker are subject to Worker limits.
- D1 Free: up to 10 databases/account, 500 MB/database, 5 GB aggregate account storage, 5 million rows read/day, 100,000 rows written/day, and 7 days of Time Travel recovery.
- D1 Free row read/write limits are enforced. Queries fail until the daily reset after a limit is exceeded; stored data is not deleted by that limit event.

Official references:
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/

## Important durability and cost caveats

- D1 Time Travel is a short recovery window, not an independent backup. Implement encrypted off-site exports before storing irreplaceable manuscripts.
- Free-tier limits can stop API/database operations temporarily when exceeded.
- Do not configure a paid Workers plan, paid add-ons, R2 paid usage, custom paid domains, or any billing upgrade without explicit owner approval.
- A custom domain may have a separate registration cost. The initial deployment can use the Cloudflare-provided `.workers.dev` hostname if the account allows it.
- No resources are created by committing these files. Account setup, D1 database creation, OAuth App setup, secrets, and deployment require the owner's explicit actions.

## Implementation state

### Added in this branch

- `cloudflare/worker.js`: static asset forwarding and a non-sensitive health endpoint. All other API routes fail closed with HTTP 503.
- `cloudflare/wrangler.toml.example`: configuration template with a deliberate placeholder D1 ID.
- `cloudflare/migrations/0001_initial_schema.sql`: initial owner, OAuth state, session, credential, project, chapter, project-memory, and snapshot schema.
- This architecture record.

### Not implemented or verified

- GitHub OAuth callback and token exchange.
- Owner GitHub numeric-ID allowlist.
- Session creation, rotation, revocation, CSRF validation, and encryption of OAuth credentials.
- Any project/chapter API or migration execution against a live D1 database.
- Frontend migration from localStorage to authenticated server APIs.
- Cross-project isolation tests, browser tests, and end-to-end tests.
- Production deployment or a live URL.
- Copilot runtime integration.

## Security gates before enabling data APIs

1. Owner allowlist must be a server-side secret/config value and must fail closed when absent.
2. OAuth state must be random, hashed, expiring, and single-use.
3. Sessions must be random, stored as hashes, delivered via Secure/HttpOnly/SameSite cookies, and revocable.
4. CSRF validation must protect every state-changing request.
5. Every project query must derive owner identity from the verified session and enforce project ownership in SQL.
6. OAuth tokens must be encrypted at rest with a secret not stored in D1 or the repository.
7. Add tests for missing auth/config, session expiry/revocation, cross-user access, cross-project child IDs, and restore/export boundaries.
8. Do not switch the UI to server-save indicators until these gates and runtime tests pass.

## Copilot decision

Cloudflare Workers is the free hosting target for the web UI and D1-backed application API. It is not the Copilot SDK host. Keep Copilot disabled until a separate compatible Node.js runtime can be operated without sharing the owner's Copilot credentials or quota. Do not silently add a paid Node host.
