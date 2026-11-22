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


## Additional implementation progress — 22 November 2026

- Added migration 0002 for project-scoped characters, character relationships, plot threads, world lore, timeline events, story notes, and asset metadata.
- Character relationships use composite foreign keys that require both characters to belong to the same project. This is a database integrity guard, not a substitute for authenticated owner checks.
- Added a dependency-free SQLite schema test at tests/check_d1_schema.py. It checks required tables, rejects orphan child rows, rejects cross-project character relationships, and checks project-delete cascades.
- Added docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md with owner-operated setup steps and explicit no-billing/no-secret-commit gates.

Run the local schema check with: python3 tests/check_d1_schema.py

This test validates SQLite-compatible migration behavior only. It does not prove Cloudflare deployment compatibility, OAuth security, API authorization, or live D1 behavior.


## Repository safety and automated checks

- Added a root .gitignore for Wrangler account config, local vars, environment files, local databases, and backup artifacts.
- Added .github/workflows/d1-schema.yml to run the Python schema test on pushes and pull requests. GitHub-hosted CI has not yet reported a result for this commit.
- The workflow validates SQLite-compatible schema constraints only. It does not test Cloudflare runtime behavior or authentication.



## Worker implementation status — 22 November 2026

The Worker now includes owner-allowlisted GitHub OAuth, hashed one-time OAuth state, hashed seven-day sessions, CSRF double-submit validation, logout revocation, project/chapter endpoints, chapter revision conflicts and snapshot restore, and project-scoped CRUD routes for characters, relationships, plot threads, world lore, timeline events, and notes. Telegram backup is supported through optional Worker secrets. Static assets receive security headers and a restrictive Content Security Policy.

Important: this is code-level implementation only. No Cloudflare account, D1 database, OAuth app, secrets, or deployment has been configured. The browser editor still writes to localStorage and clearly states that it is not synced. Authentication UI is connected to the new session endpoint, but project/manuscript data has not yet been migrated to the APIs. Copilot remains disabled.

Source-level Python checks and JavaScript syntax checks are configured in GitHub Actions. A passing CI run and deployed integration test have not yet been verified.

- Added migration `0003_chapter_word_count.sql` so project-wide word totals can be computed from compact chapter metadata without fetching every manuscript body.
