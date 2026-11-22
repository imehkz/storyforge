# STORYFORGE — Implementation Plan

Status: Private beta preparation  
Working branch: `feature/storyforge-studio-80`  
Production deployment: **not authorized**

## Product constraints

- Reproduce the approved Figma design; do not redesign from scratch.
- Thai is the primary UI language. Preserve the Dark Fantasy Literature / Ancient Royal Library visual direction.
- Brand colors: Midnight Navy `#101827`, Antique Gold `#C5A15B`, Old Parchment `#E8D8B8`, Dark Mahogany `#382D29`.
- Never expose secrets in browser code, local storage, repository files, or chat.
- Do not use OpenAI API keys or silently fall back to a paid provider.
- Copilot must run with the authenticated user's own GitHub identity and subscription.
- No paid service, billing activation, production deployment, or merge to `main` without explicit approval.

## Verified current state

- The original Node HTTP server remains available, while the Cloudflare Worker now contains owner-only GitHub OAuth, hashed sessions, CSRF validation, logout revocation, project/chapter APIs, snapshots, and project-scoped module CRUD.
- The browser editor now contains the Cloudflare API integration for server-backed projects, chapters, autosave, chapter snapshots/restore, and project-scoped Character, Plot, World, Timeline, and Notes CRUD.
- Sign-in and cloud data operations require the Worker, D1 binding, OAuth App, and secrets to be configured and deployed; none is provisioned yet.
- Local drafts and backups remain on the device. Import is explicit, stable-ID/idempotent, and does not delete the source local data.
- AI is intentionally disabled; GitHub identity OAuth is not Copilot SDK authorization.
- No Cloudflare account, D1 database, OAuth App, secrets, or deployment has been provisioned.

## MVP acceptance criteria

1. **Identity and access**
   - GitHub OAuth sign-in.
   - Owner allowlist enforced on the server, not by a UI label.
   - Secure, HttpOnly, SameSite session cookie; CSRF/state validation; session expiry and logout.
   - Fail closed when OAuth or owner allowlist configuration is absent.
2. **Project foundation**
   - Stable Project ID for every novel.
   - Server-side owner/permission checks on every project-scoped request.
   - All chapters, characters, notes, plot, lore, timeline, and assets belong to a Project ID.
   - Tests prove two projects with overlapping character names cannot read or mutate each other's data.
3. **Writing**
   - Create, rename, archive, restore, and delete projects with confirmation.
   - Create, edit, reorder, and delete chapters.
   - Autosave with visible saved/saving/error states.
   - Chapter history, snapshot, restore, and conflict handling.
   - TXT export as the first verified export format.
4. **Design and accessibility**
   - Implement the Figma dashboard and library structure faithfully.
   - Consolidate design tokens and navigation.
   - Test desktop and tablet layouts; keyboard focus, disabled/loading/error states, contrast, and readable type.
5. **AI (after identity and project isolation)**
   - Use the official `@github/copilot-sdk` package.
   - One SDK client/session per authenticated user; explicitly disable logged-in-user credential fallback.
   - Use only that user's OAuth token and Copilot entitlement. No shared owner token.
   - Scope every prompt to the active project and its approved canon.
6. **Publishing**
   - DOCX, PDF, and EPUB only after structure, Thai typography, images, front matter, TOC, and pagination have test fixtures.

## Data model baseline

- `users`: GitHub identity, role, created/updated timestamps.
- `sessions`: hashed session identifier, user ID, expiry, revocation.
- `oauth_credentials`: encrypted token material and expiry, never returned to the browser.
- `projects`: stable ID, owner ID, title, genre, status, timestamps.
- `chapters`: stable ID, project ID, title, body, ordering, timestamps.
- `project_memories`: stable ID, project ID, memory type, content, version.
- `snapshots`: stable ID, project ID, resource type/ID, immutable content, created time.
- Future modules (characters, relationships, plot, world, timeline, notes, illustrations, covers) must all include project ID and server-enforced ownership.

## Delivery sequence

- P0 — Requirements, owner-only authentication design, data model, project-isolation contract, save/version/recovery contract.
- P1 — Database and storage decision with verified free-tier limits and no billing activation; authentication and permissions; project CRUD; chapter editor and autosave.
- P2 — Figma-matched Dashboard and Library; Character Studio, Relationship Map, Plot, World, Timeline, Notes.
- P3 — Project-scoped Copilot assistant and approval workflow.
- P4 — Illustration/Cover Studio and DOCX/PDF/EPUB export.
- P5 — Accessibility, responsive, security, backup/restore, performance, and end-to-end QA.

## First end-to-end acceptance test

Create a novel → add a chapter → write text → save → sign out/in → restore a previous version → export text. Repeat with a second project containing duplicate character names and verify strict isolation.

## Current known blockers

- Cloudflare runtime configuration, D1 binding/database, GitHub OAuth App, owner allowlist secret, and Worker secrets are not provisioned.
- Cloudflare resources and credentials are not provisioned, so the new API-backed editor cannot be exercised against a live service yet.
- No verified end-to-end Worker/D1 run has been completed. CI has been configured, but no successful GitHub Actions result is confirmed yet.
- Independent encrypted D1 backup and full restore verification remain outstanding.
- Copilot SDK requires a separately approved compatible runtime and each user's own Copilot entitlement; it remains disabled.

## Progress update — 22 November 2026

### Completed in feature/storyforge-studio-80

- Replaced the basic writer landing page with a Thai-first dashboard structure based on the supplied Figma Dashboard frame (royal-library sidebar, selected-novel area, featured project panel, summary cards, recent-work panel, AI assistant panel).
- Applied the STORYFORGE palette: Midnight Navy `#101827`, Antique Gold `#C5A15B`, Old Parchment `#E8D8B8`, and Dark Mahogany details.
- Added responsive layout behavior for narrow/tablet widths and visible focus styling for inputs and navigation.
- Added navigation destinations for Dashboard, Novel Library, Character Studio, Plot Room, World Building, Timeline, Story Notes, Manuscript Studio, AI Assistant, and Backup.
- Connected Dashboard display to the current browser-local project title, chapter title, and manuscript character count.
- Added local project IDs for newly saved project metadata. This is not server-side project isolation and does not yet create independent manuscript storage per project.
- Moved the Backup Center into its own panel and clarified that automatic Telegram backup only runs while this page remains open.
- Kept Copilot disabled until per-user GitHub OAuth, SDK setup, and server-side permission boundaries are implemented.

### Baseline limitations before Cloudflare integration (historical record)

- The browser keeps a local recovery copy, while authenticated operations use project-scoped Worker APIs and D1 when configured.
- Project switching, chapter creation, chapter autosave, snapshot history/restore, and conflict handling are implemented in the frontend source but are not live until the Worker and D1 are configured.
- Character, Plot, World, Timeline, Relationships, and Notes now have project-scoped CRUD interfaces; visual relationship mapping and richer structured character profiles remain future enhancements.
- Export currently supports plain text only; DOCX, print-ready PDF, and EPUB are not implemented.
- Backup/restore remains browser-local JSON; Telegram backup requires the configured secret and is not a substitute for authenticated project storage.
- No browser runtime, tablet, accessibility, security, or end-to-end test has been run for this UI update. GitHub file retrieval confirms commits only; it does not prove the app runs.

### Next safe implementation steps

See [SECURITY_AND_STORAGE_DECISIONS.md](./SECURITY_AND_STORAGE_DECISIONS.md) for the reviewed OAuth, Copilot isolation, and hosting/storage constraints. In particular, Render Free Postgres is not suitable for durable manuscripts because it expires after 30 days; no paid storage or hosting has been approved.

1. Run a local Node 22 syntax/runtime smoke test and verify all dashboard navigation and form controls.
2. Add a local data migration and project-scoped storage contract before exposing project switching; do not pretend a project ID alone provides isolation.
3. Design and implement fail-closed GitHub OAuth/session ownership before adding server-side project APIs.
4. Choose a database and hosting persistence option only after checking current free-tier limits and obtaining approval for any paid service.
5. Continue matching the remaining Figma screens only after the dashboard runtime check.


## Cloudflare implementation progress — 22 November 2026

### Added on `feature/storyforge-studio-80`

- Added the Cloudflare Worker entry point and Wrangler configuration template.
- The Worker now implements owner-only GitHub OAuth, hashed one-time state, hashed seven-day sessions, CSRF double-submit protection, logout revocation, project/chapter APIs, optimistic chapter revisions, snapshot list/restore, and project-scoped CRUD for characters, relationships, plot threads, world lore, timeline events, and notes.
- Added optional secret-protected Telegram backup support and security headers/CSP for static assets.
- Added D1 migrations for identity, projects, chapters, snapshots, and project studio modules.
- Added Python schema/security-contract tests and GitHub Actions checks for Python tests and JavaScript syntax.

### Still not complete at the end of the initial Worker scaffold (historical snapshot)

- At that point the browser UI still read and wrote localStorage and had not been connected to D1.
- Worker-side OAuth, sessions, owner allowlist, project/chapter/module APIs, chapter snapshots, and server-side project ownership checks are implemented in source but have not been verified against a live or local Cloudflare Worker/D1 runtime.
- The Cloudflare scaffold has not been deployed and no Cloudflare resource has been created.
- Copilot SDK is not hosted on Workers; keep AI disabled until a separately approved compatible runtime is available.
- No runtime, migration, security, or browser test has been executed. Do not treat scaffold commits as a working hosted app.


## Cloudflare follow-up — 22 November 2026

### Added in the current work session

- Expanded D1 schema with characters, relationships, plot threads, world lore, timeline events, notes, and asset metadata.
- Added composite project-scoped foreign keys for character relationships.
- Added a standard-library Python test harness for migration integrity and project-boundary constraints.
- Added an owner-operated Cloudflare setup checklist. It explicitly prohibits committing account-specific Wrangler configuration or secrets and does not authorize billing.

### Remaining sequence

1. Run the schema test in a local environment with Python 3: `python3 tests/check_d1_schema.py`.
2. Verify Wrangler config and migration behavior with a local D1 database before any remote database is created.
3. Complete CI and local Worker/D1 integration tests, including owner denial, CSRF, cross-project isolation, chapter conflicts, and restore.
4. Complete browser-level tests of the frontend API integration and reversible localStorage-to-D1 import flow.
5. Improve retry/reconnect behavior and cross-device recovery after live Worker/D1 validation.
6. Implement independent encrypted D1 backups and test restore.
7. Reassess Copilot separately; Workers is not assumed to support the Node.js SDK runtime.

No deployment, remote D1 creation, OAuth app, secret, paid plan, or production release has been performed.


## Implementation progress — 22 November 2026

- Implemented the Worker-side owner-only GitHub OAuth flow and session lifecycle.
- Added CSRF protection for all mutating endpoints.
- Added project and chapter CRUD, optimistic chapter revisions, snapshots, snapshot listing and restore.
- Added project-scoped CRUD endpoints for character studio, relationships, plot threads, world lore, timeline, and notes.
- Added optional secret-protected Telegram backup endpoint for the Cloudflare Worker.
- Added browser sign-in/status/logout controls, API-backed project/chapter workflows, cloud autosave, chapter history/restore, project memory, and project-scoped module CRUD. Local recovery copies remain enabled.
- Added security headers and a restrictive CSP to static assets.
- Expanded CI to run Node syntax checks and Python schema/security-contract checks.

### Remaining before real private-beta use

1. Owner creates GitHub OAuth App and configures exact callback URL.
2. Owner creates Cloudflare D1 and configures Worker bindings/secrets.
3. Apply migrations locally, then remote after owner review.
4. Run CI and fix any failures; then exercise the Worker against local D1.
5. Run end-to-end tests for owner denial, CSRF, isolation, autosave, restore, local import retry, and backup against a configured Worker/D1 environment.
7. Obtain explicit approval before any preview or production deployment.

No hosting resources or secrets have been provisioned, and no production deployment has occurred.


## Frontend integration progress — 22 November 2026

### Added after the initial Worker API work

- Connected the browser editor to authenticated project APIs for listing, creating, renaming, archiving, deleting, and switching novels.
- Connected chapter creation, editing, debounced autosave, ordering (move up/down), deletion, snapshot history, restore, and optimistic revision conflict detection.
- Added per-Chapter-ID local recovery drafts. A user can explicitly recover a device draft after a conflict; the latest Cloud copy is not silently overwritten.
- Added an explicit local-to-Cloud import panel. It keeps the original device data, imports the active local manuscript and project memory, and uses stable UUIDv4 client IDs plus insert-if-absent APIs so retries do not duplicate the imported records.
- Connected project-scoped CRUD interfaces for characters, character relationships, plot threads, world lore, timeline events, and story notes.
- Connected the Dashboard character/plot/world counts to the current project's records.
- Fixed a duplicate HTML ID between the Manuscript panel and its textarea while preserving the historical `sf_manuscript` backup key.
- Added a source-level HTML ID uniqueness check and expanded Worker contract tests.

### Verification status

- A source inspection confirms that the static HTML now has unique IDs and the editor references the renamed manuscript textarea consistently.
- GitHub Actions is configured to check Worker/app JavaScript syntax, both Python test suites, and the D1 schema on branch pushes.
- The checks have not yet been confirmed as passing in GitHub Actions. No local browser test or Worker/D1 integration test has been run.
- Figma MCP calls are currently blocked by the Starter plan call limit, and the connected Figma seat is View-only. No Figma source file was modified.

### Remaining before private beta

1. Owner provisions D1 and GitHub OAuth configuration, then applies migrations.
2. Verify CI and run the Worker locally with D1; test owner denial, CSRF/origin rejection, cross-project isolation, import retry, autosave, conflict, move/delete, restore, and backups.
3. Run browser tests on desktop/tablet and review accessibility/contrast against the approved Figma frames.
4. Implement and verify DOCX, PDF, and EPUB export. Current manuscript export remains TXT.
5. Design and approve a compatible per-user Copilot runtime; AI remains disabled.
6. Only after the above, request explicit approval for a private preview deployment. No production deployment or merge to `main` is authorized.
