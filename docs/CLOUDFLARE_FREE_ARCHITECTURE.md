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

### Implemented in source on this branch

- `cloudflare/worker.js`: owner-allowlisted GitHub OAuth, one-use hashed OAuth state, hashed sessions, host-only Secure/HttpOnly cookies, same-origin + CSRF validation, logout revocation, owner-scoped project/chapter/module APIs, chapter revision conflicts, atomic snapshots/restore, chapter ordering, and chapter deletion with snapshot cleanup.
- Project-scoped CRUD for characters, relationships, plot threads, world lore, timeline events, and notes.
- Optional secret-protected Telegram backup endpoint.
- Static asset security headers and Content Security Policy.
- `cloudflare/wrangler.toml.example`: configuration template with a deliberate placeholder D1 ID and Worker-first routing for API/auth paths.
- D1 migrations `0001` through `0003`: identity/session, project and chapter data, studio modules, and persisted chapter word counts.
- Browser sign-in/session UI, API-backed project/chapter workflows, autosave, local draft recovery, explicit idempotent local import, studio module CRUD, chapter history/restore, and TXT/DOCX/EPUB/print-to-PDF export source.
- Python schema/security-contract tests and Node export-package smoke tests are configured in GitHub Actions.

### Not provisioned or verified

- No Cloudflare account, D1 database, GitHub OAuth App, secrets, or deployment has been created.
- Migrations have not been applied to a Cloudflare D1 instance.
- GitHub Actions passing status has not been confirmed.
- No live Worker/D1, browser, or cross-device end-to-end test has been run.
- Independent encrypted D1 backup and full restore test remain outstanding.
- Copilot runtime integration remains disabled; GitHub identity OAuth is not Copilot SDK authorization.
- No production deployment or live URL exists.

## Verification gates before private beta

1. Configure the owner allowlist as a server-side value and confirm missing config fails closed.
2. Verify OAuth state replay/expiry, session expiry/revocation, and host-only cookies.
3. Verify same-origin and CSRF rejection for every mutating endpoint.
4. Test project ownership and cross-project isolation for every collection.
5. Test import retries, chapter autosave, stale revision conflicts, ordering, deletion, and restore.
6. Validate DOCX/EPUB in common readers and print-to-PDF on desktop and Android.
7. Configure independent encrypted backups and test restore.
8. Only deploy after tests pass and the owner explicitly approves.

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

The Worker now includes owner-allowlisted GitHub OAuth, hashed one-time OAuth state, hashed sessions, host-only Secure/HttpOnly cookies, same-origin and CSRF checks, logout revocation, project/chapter APIs, optimistic revisions, atomic snapshots/restore, chapter ordering, and project-scoped CRUD for characters, relationships, plot threads, world lore, timeline, and notes. Telegram backup is supported through optional Worker secrets. Static assets receive security headers and a restrictive Content Security Policy.

The browser editor source now calls these APIs for projects, chapters, autosave, history/restore, and studio modules. It retains per-chapter local recovery drafts and an explicit idempotent import flow; local source data is not deleted. DOCX and EPUB packages are generated offline, and PDF uses the browser print-to-PDF dialog. Copilot remains disabled.

Important: this is code-level implementation only. No Cloudflare account, D1 database, OAuth app, secrets, or deployment has been configured. Migrations have not been applied to Cloudflare D1. In-session JavaScript parsing, static contract checks, SQLite migration/SQL smoke tests, and DOCX/EPUB archive checks have been performed; GitHub Actions passing status and deployed integration tests have not been verified.

- Added migration `0003_chapter_word_count.sql`; the browser calculates Thai-aware word counts and the Worker validates/persists them so project-wide totals can be computed from compact chapter metadata without fetching every manuscript body.
