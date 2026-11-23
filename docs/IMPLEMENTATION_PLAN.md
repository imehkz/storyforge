# STORYFORGE — Implementation Plan

Status: Private beta preparation  
Working branch: `feature/storyforge-studio-80`  
Production deployment: **not authorized**

## Product constraints

- Reproduce the approved Figma design; do not redesign from scratch.
- Thai is the primary UI language. Preserve the Dark Fantasy Literature / Ancient Royal Library visual direction.
- Brand colors: Midnight Navy `#101827`, Antique Gold `#C5A15B`, Old Parchment `#E8D8B8`, Dark Mahogany `#382D29`.
- Never expose secrets in browser code, local storage, repository files, or chat.
- Never expose OpenAI API keys in browser code, local storage, repository files, or chat.
- OpenAI (ChatGPT) is the selected intended provider for the single-owner workflow; GitHub Copilot is excluded. Keep API calls disabled until API billing, privacy/retention terms, and server-side secret configuration are explicitly approved.
- No paid service, billing activation, production deployment, or merge to `main` without explicit approval.

## Verified current state — 23 November 2026

This section supersedes earlier historical status statements below where they conflict.

- The Cloudflare Worker is deployed at `https://storyforge.jastsadakorn-n.workers.dev/` (active version `22501245-0305-46a4-9c80-e32a947f7cea`, 100% traffic; deployment `7daedc5c-4433-4cac-bcf0-58552b9c66de`, created 22 November 2026) with the `storyforge` D1 binding. The account, D1 database, GitHub OAuth configuration, owner allowlist, and Worker secrets have been provisioned.
- The Worker source implements owner-only GitHub OAuth, hashed sessions, CSRF/origin validation, logout revocation, project/chapter APIs, snapshots, and project-scoped module CRUD.
- The browser frontend is connected to authenticated Cloud APIs for projects, chapters, autosave/revisions, snapshots, local recovery/import, and project-scoped studio modules.
- Backup format v4 includes device-local data plus Cloud projects, chapters, all six studio module collections, the character reference vault, and the project-scoped illustration library. Snapshot history is excluded and explicitly disclosed. Restore preflights Cloud data and image-library records, preserves stable IDs, and merges rather than deleting existing Cloud data. Snapshot history is excluded and explicitly disclosed. Restore preflights Cloud data, preserves stable IDs, and merges rather than deleting existing Cloud data.
- Latest implementation branch: `feature/storyforge-studio-80`, code commit `a3672c5399c4ef4d42e404d3c1c9069563d22c20`. The Draft PR remains open and targets `feature/character-studio`, not `main`. Draft PR #1 targets `feature/character-studio`, not `main`.
- GitHub Actions passed on the previous export milestone. The latest illustration-library changes are being checked by the current workflow. CI checks cover JavaScript syntax/export smoke tests, D1 schema validation, and Worker security-contract checks. These are static/source and SQLite checks, not live Worker/D1 or browser end-to-end tests.
- The deployed Worker is an earlier build; the latest branch changes have not been deployed. No merge to `main` or new deployment is authorized.
- OpenAI (ChatGPT) is selected as the intended AI provider. The assistant UI now identifies this choice and supports copying the active novel context for manual use in ChatGPT. Direct API integration remains disabled: ChatGPT Plus does not include API usage, and no API billing or key configuration has been approved. GitHub identity OAuth is only for sign-in.

## Latest AI provider update — 23 November 2026

- Set OpenAI (ChatGPT) as the intended StoryForge AI provider and removed Copilot as a possible integration path.
- Updated the assistant UI to explain that the API is not connected, and that the user can copy the active novel context into ChatGPT manually.
- Kept the AI run action disabled. No API key, external request, billing, or paid service was configured or activated.
- Next gated step: after explicit owner approval of API spending and privacy/retention terms, configure an OpenAI API key as a Cloudflare Worker secret and implement authenticated, project-scoped requests with prompt preview and explicit confirmation.

## Latest implementation update — 23 November 2026

- Added whole-novel TXT export that fetches every chapter from the selected Cloud project, checks each chapter's Project ID, sorts by chapter order, and stops if saving the active chapter fails.
- Added whole-novel DOCX export with chapter headings and embedded images retained through the existing rich-text converter.
- Added whole-novel EPUB export with one XHTML file per chapter, a navigation document/table of contents, and embedded chapter images.
- Added whole-novel print-to-PDF with a table of contents and chapter page breaks; browser print is still used and the user chooses Save as PDF.
- Added export safety checks and structural tests for project isolation and document size limits.
- The latest GitHub Actions run passed. This does not replace browser/device or live Worker/D1 testing.

## Latest implementation update — 23 November 2026 (continued)

- Added a device-local Illustration Library backed by IndexedDB, separated by Project ID. It supports saving a compressed illustration, browsing the current novel's images, selecting an image to insert into the manuscript, and deleting a library entry without deleting any image already embedded in a chapter.
- Upgraded the local IndexedDB schema from version 1 to version 2 without deleting the existing character-reference store or its records.
- Upgraded Backup/Restore to format v4. It includes the project-scoped illustration library, validates image data and Project IDs before restore, and restores entries additively. Backup still has an overall 40 MB limit; the illustration library has a 12 MB aggregate limit and 100-image per-project limit.
- The illustration library is stored on the current device only; it is not cloud-synced. Images embedded in manuscript chapters continue to travel with the chapter data. Cross-device library sync and a cloud asset store remain future work.
- Added source-contract tests for project isolation, IndexedDB migration, library controls, and Backup/Restore v4. GitHub Actions passed on commit `282bca29a96051a5ebc81d06f731838264454a33`; follow-up hardening also disables saving after failed compression, rechecks the active Project ID before save/delete, and safely omits local library backup on browsers without IndexedDB. CI passed on the code commit.
- No production deployment, merge, paid service activation, or AI provider connection was performed.

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
   - Do not use GitHub Copilot. Select an owner-approved provider only after reviewing privacy, cost, and runtime compatibility.
   - Keep credentials server-side; never use a shared credential or silent provider fallback.
   - Scope every prompt to the active project and its approved canon; require prompt preview and explicit confirmation.
6. **Publishing**
   - DOCX, PDF, and EPUB only after structure, Thai typography, images, front matter, TOC, and pagination have test fixtures.

## Data model baseline

- `users`: GitHub identity, role, created/updated timestamps.
- `sessions`: hashed session identifier, user ID, expiry, revocation.
- `oauth_credentials`: reserved for future encrypted token material and expiry; the current identity-only OAuth flow discards the access token, so this table is unused.
- `projects`: stable ID, owner ID, title, genre, status, timestamps.
- `chapters`: stable ID, project ID, title, body, ordering, timestamps.
- `project_memories`: stable ID, project ID, memory type, content, version.
- `snapshots`: stable ID, project ID, resource type/ID, immutable content, created time.
- Future modules (characters, relationships, plot, world, timeline, notes, illustrations, covers) must all include project ID and server-enforced ownership.

## Delivery sequence

- P0 — Requirements, owner-only authentication design, data model, project-isolation contract, save/version/recovery contract.
- P1 — Database and storage decision with verified free-tier limits and no billing activation; authentication and permissions; project CRUD; chapter editor and autosave.
- P2 — Figma-matched Dashboard and Library; Character Studio, Relationship Map, Plot, World, Timeline, Notes.
- P3 — Project-scoped AI assistant with provider approval and prompt-confirmation workflow.
- P4 — Illustration/Cover Studio and DOCX/PDF/EPUB export.
- P5 — Accessibility, responsive, security, backup/restore, performance, and end-to-end QA.

## First end-to-end acceptance test

Create a novel → add a chapter → write text → save → sign out/in → restore a previous version → export text. Repeat with a second project containing duplicate character names and verify strict isolation.

## Current known blockers — updated 23 November 2026

- Cloudflare Worker, D1, and GitHub OAuth are provisioned; latest branch code has not been deployed to the active Worker.
- Live Worker/D1 integration and browser/device end-to-end tests remain outstanding, including Android tablet validation.
- Independent encrypted off-site D1 backup and a full restore drill remain outstanding.
- Character Reference Vault is device-local IndexedDB; Cloud image storage and cross-device synchronization are not implemented.
- AI text/image generation remains disabled. OpenAI (ChatGPT) is the intended provider; direct API use still requires explicit cost/privacy approval and server-side secret configuration. GitHub Copilot is explicitly excluded.
- Whole-novel TXT, DOCX, EPUB, and print-to-PDF export controls have now been added on the test branch. They still require real-browser verification with multi-chapter Thai text and embedded images.
- Book-cover artwork generation, version history, approved cover assets, and full illustration library remain incomplete.

## Progress update — 22 November 2026

### Completed in feature/storyforge-studio-80

- Replaced the basic writer landing page with a Thai-first dashboard structure based on the supplied Figma Dashboard frame (royal-library sidebar, selected-novel area, featured project panel, summary cards, recent-work panel, AI assistant panel).
- Applied the STORYFORGE palette: Midnight Navy `#101827`, Antique Gold `#C5A15B`, Old Parchment `#E8D8B8`, and Dark Mahogany details.
- Added responsive layout behavior for narrow/tablet widths and visible focus styling for inputs and navigation.
- Added navigation destinations for Dashboard, Novel Library, Character Studio, Plot Room, World Building, Timeline, Story Notes, Manuscript Studio, AI Assistant, and Backup.
- Connected Dashboard display to the current browser-local project title, chapter title, and manuscript character count.
- Added local project IDs for newly saved project metadata. This is not server-side project isolation and does not yet create independent manuscript storage per project.
- Moved the Backup Center into its own panel and clarified that automatic Telegram backup only runs while this page remains open.
- Kept AI disabled; GitHub OAuth is sign-in only and is not an AI-provider authorization mechanism.

### Baseline limitations before Cloudflare integration (historical record)

- The browser keeps a local recovery copy, while authenticated operations use project-scoped Worker APIs and D1 when configured.
- Project switching, chapter creation, chapter autosave, snapshot history/restore, and conflict handling are implemented in the frontend source but are not live until the Worker and D1 are configured.
- Character, Plot, World, Timeline, Relationships, and Notes now have project-scoped CRUD interfaces; visual relationship mapping and richer structured character profiles remain future enhancements.
- Export currently supports plain text only; DOCX, print-ready PDF, and EPUB are not implemented.
- Backup/restore remains browser-local JSON; Telegram backup requires the configured secret and is not a substitute for authenticated project storage.
- No browser runtime, tablet, accessibility, security, or end-to-end test has been run for this UI update. GitHub file retrieval confirms commits only; it does not prove the app runs.

### Next safe implementation steps

See [SECURITY_AND_STORAGE_DECISIONS.md](./SECURITY_AND_STORAGE_DECISIONS.md) for the reviewed OAuth, AI-provider isolation, and hosting/storage constraints. In particular, Render Free Postgres is not suitable for durable manuscripts because it expires after 30 days; no paid storage or hosting has been approved.

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
- AI provider integration remains disabled until a provider, runtime, privacy model, and costs are explicitly approved. GitHub Copilot is excluded.
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
7. Select and validate a non-Copilot AI provider only after explicit approval; do not assume Workers compatibility.

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
4. CI has passed for the current draft PR head; next exercise the Worker against local D1 and keep this gate open until the live integration checks pass.
5. Run end-to-end tests for owner denial, CSRF, isolation, autosave, restore, local import retry, and backup against a configured Worker/D1 environment.
6. Obtain explicit approval before any preview or production deployment.

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
- Added offline DOCX and EPUB export generators using stored ZIP packages, plus an A4 browser print-to-PDF flow. Added Node-based ZIP structure/CRC smoke tests to CI.

### Verification status

- In-session JavaScript syntax parsing passed for both `public/app.js` and the Worker module source (with the ESM export normalized for the parser).
- In-session static contract checks passed for owner allowlisting, CSRF/origin checks, atomic snapshot batches, stable import IDs, module CRUD wiring, local recovery, unique HTML IDs, and DOM ID references.
- SQLite smoke tests passed for both D1 migrations, expected table creation, cross-project relationship rejection, cascade deletion, chapter snapshot/update SQL, stale revision rejection, ordering, and snapshot cleanup. These are local SQLite checks, not a live D1 runtime test.
- GitHub Actions is configured to check Worker/app JavaScript syntax, DOCX/EPUB ZIP integrity, both Python test suites, and the D1 schema on branch pushes. No passing Actions run is confirmed yet.
- No browser test or live Cloudflare Worker/D1 integration test has been run.
- Figma MCP calls are currently blocked by the Starter plan call limit, and the connected Figma seat is View-only. No Figma source file was modified.

### Remaining before private beta

1. Owner provisions D1 and GitHub OAuth configuration, then applies migrations.
2. Verify CI and run the Worker locally with D1; test owner denial, CSRF/origin rejection, cross-project isolation, import retry, autosave, conflict, move/delete, restore, and backups.
3. Run browser tests on desktop/tablet and review accessibility/contrast against the approved Figma frames.
4. Validate the new DOCX and EPUB ZIP packages in Microsoft Word/LibreOffice and an EPUB reader; validate the A4 browser print-to-PDF flow on desktop and Android. TXT, DOCX, EPUB, and print-to-PDF source implementations are now present.
5. Select an approved AI provider and define a secure, project-scoped integration; AI remains disabled until then.
6. Only after the above, request explicit approval for a private preview deployment. No production deployment or merge to `main` is authorized.

- Added migration `0003_chapter_word_count.sql`; the browser computes Thai-aware word counts and the Worker validates/persists them. Chapter lists return compact metadata and the Dashboard aggregates project-wide word counts without downloading every chapter body.
- Added a Figma-aligned manuscript workspace with a chapter sidebar, chapter switching, ordering and deletion, search/replace, version history, and per-chapter writing goals.


### Figma-informed workspace refinements

- Reworked Manuscript Studio into a chapter-sidebar/editor workspace, with chapter navigation, reorder/delete controls, revision history, local-draft recovery, search-and-replace, per-chapter word goals, and export actions.
- Added Thai-aware word counting in the browser, persisted per-chapter counts, and novel-wide Dashboard progress. Chapter lists now fetch metadata only; the full manuscript body is loaded only for the selected chapter.
- Expanded Character Studio with structured identity, appearance, personality, motivation, backstory, strengths, weaknesses, and secret fields; added in-form editing and a project-scoped SVG relationship map.
- The World Building UI is still a structured lore catalogue rather than the Figma illustrated atlas/map. Plot status board and event timeline views are implemented, but a full visual plot-flow editor and advanced timeline controls remain incomplete. Rich character portrait generation also remains incomplete.


### Backup validation hardening — 23 November 2026

- Backup collection now fails closed when an API result reaches its fixed page cap (200 projects, 500 chapters, or 100 records per project module) rather than silently claiming a complete archive.
- Cloud restore now preflights the entire archive before confirmation or writes: unique UUIDs, required collection presence, required fields, size/type limits, chapter word-count consistency, valid relationship IDs, and same-project character references.
- Added source-level regression tests for valid archives, duplicate project IDs, malformed chapter bodies, missing module collections, inconsistent word counts, and dangling character relationships.
- JavaScript syntax and test-harness syntax parse checks passed after the latest commits. The most recent GitHub Actions run verified commit 0455594; no Actions result is yet confirmed for the newer test commit 5cdad4c.
- Live D1 restore remains untested. Restore still merges through multiple API calls rather than one database transaction; a network/API failure midway can leave a partial merge. Snapshot history remains excluded.

### Backup integrity follow-up — 23 November 2026

- Fixed a critical gap where the Backup Center exported only browser-local `sf_*` keys while the active novel data lived in D1.
- Backup format v2 now collects all authenticated Cloud projects, chapter bodies, and project-scoped Characters, Relationships, Plot, World, Timeline, and Notes records, alongside local device recovery data.
- Restore v2 merges Cloud records using their stable IDs through the existing idempotent create APIs; it does not delete existing Cloud projects. Local device `sf_*` data is restored separately.
- Telegram backup now sends the same Cloud-aware v2 archive.
- Snapshot history is explicitly excluded and disclosed in the backup metadata and restore confirmation. A complete snapshot-history export/import and independent scheduled server-side backup remain outstanding.
- Added CI source-contract assertions for Cloud backup coverage and restore wiring. A local mocked API smoke test and JavaScript parse check passed; GitHub Actions and browser/Cloudflare runtime verification are still pending.


### Editor recovery resilience — 23 November 2026

- Hardened local chapter-draft persistence against browser storage quota and privacy-mode errors. A failed local recovery write now reports the limitation without throwing through the editor's save handler.
- Hardened the general local recovery-key writes so one storage failure does not prevent the Cloud autosave from being scheduled.
- Added source-contract regression coverage for the storage-failure path. This does not replace a real-device offline/reload test; browser storage behavior still needs Android tablet QA.

- Added an executable Node-based recovery test with simulated browser storage quota failures; CI verifies the local recovery error is contained and Cloud autosave is still scheduled.


### Restore failure compensation — 23 November 2026

- Cloud restore now records which projects, chapters, and module records were newly created by the current restore attempt. If a later write fails, it attempts to delete only those newly created records and restore any pre-existing project status changed by the attempt.
- Existing projects and records are not deleted during compensation. Newly created projects are removed as a unit; their child records are left to the project's database cascade behavior.
- Added executable Node tests for failure during module restore against both a newly created project and an existing project. CI passed on commit 91c387c.
- This is best-effort compensating rollback, not a single D1 transaction. If the network fails during rollback, the UI reports that manual Cloud review is needed. Live Cloud restore/rollback still requires a controlled test with disposable data.


### Canonical character relationship integrity — 23 November 2026

- The Worker now validates both endpoints of a relationship against the active project before create and update. This gives a clear validation failure instead of relying only on the composite D1 foreign key to reject cross-project character references.
- Added a Worker contract regression test covering both create and edit paths. The D1 composite foreign keys remain the final database-level isolation guard.
- This hardens Character Studio / Relationship Map data integrity; it does not yet implement automatic cross-references from plot threads, lore, and timeline entries to characters.


### Canonical character references — 23 November 2026

- Added project-scoped character reference arrays to plot threads, world-lore entries, and timeline events.
- The Worker validates every referenced character against the current project on create and update; empty references remain valid and legacy rows default to an empty array.
- The Plot, World, and Timeline forms allow selecting multiple characters from the active novel, and list views display the linked character names.
- Editing these records preserves the current links unless the user changes the selected character list.
- Deleting a character removes its ID from plot, world, and timeline references in the same D1 batch as the character deletion, preventing stale links in future backups.
- This establishes explicit character-to-canon references; automatic semantic linking from manuscript prose and cross-reference navigation remain future work.


### Story-note character references — 23 November 2026

- Story notes can reference up to 50 characters from the same project.
- Character-reference validation applies on note creation and update; deleting a character cleans references in notes together with plot, world, and timeline records.
- Note links are visible in the notes list and included in manually copied ChatGPT story context.
- Backup/restore validation and payload mapping include note character references.


### Character-consistent illustration prompts — 23 November 2026

- The illustration prompt builder now lets the writer select scene characters from the active project.
- Selected character appearance details (face, skin, eyes, hair, build, clothing, accessories, and other stored attributes) are added to the editable prompt.
- Character selection is saved per project on the current device. The prompt asks the image tool to preserve each character's traits and avoid mixing designs.
- This remains prompt preparation only; no image-generation provider or paid API is connected.


### Distraction-free writing workspace — 23 November 2026

- Added a one-tap focus mode to Manuscript Studio. It hides the global sidebar, top navigation, chapter list, and secondary writing tools while keeping the formatting toolbar, editor, word count, and save feedback available.
- The focus-mode toggle remains inside the editor toolbar; Escape exits focus mode. The editor's existing local recovery and Cloud autosave flows remain unchanged.
- Added a source-contract regression test for the focus toggle, keyboard exit, and retained editor controls.
- This is a writing-comfort improvement, not a substitute for Android tablet browser QA or a real save/reload/restore test.


### Chapter-level Canon references — 23 November 2026

- Added a per-chapter character selector in Manuscript Studio so each chapter can record which characters appear or play a role in it.
- Chapter references are stored in D1 with the chapter, validated against characters in the same project, included in revision snapshots, and restored with the chapter.
- Deleting a character cleans its references from chapters as well as Plot, World, Timeline, and Story Notes.
- Cloud Backup validation and restore preserve chapter character links and reject missing or cross-project character IDs.
- The feature is implemented on the test branch only. Migration 0006_chapter_character_references.sql must be applied before this Worker build can run against D1; no live deployment or migration has been performed.


### Rule-based continuity checker — 23 November 2026

- Added a non-destructive Continuity Checker panel to Manuscript Studio on the test branch.
- It checks up to 40 saved chapters (and up to 1,000,000 characters of chapter text per run) for duplicate or missing titles, empty chapter text, possible mismatches between chapter Canon links and character names/nicknames in prose, and ISO-style or numeric-date Timeline order that appears inconsistent with the configured event order.
- It also flags active plot threads whose linked characters have not yet been assigned to any chapter Canon. These are review suggestions, not confirmed continuity errors.
- Findings can open the relevant chapter. The checker saves the active chapter before scanning and does not modify manuscript or Canon records.
- This is deterministic rule-based checking only; it does not yet understand aliases beyond the character nickname field, pronouns, implicit references, narrative causality, or semantic contradictions. Timeline comparison only runs when dates use a supported numeric format.
- Cloud requests are made using the existing owner-authenticated, project-scoped chapter endpoint. No new endpoint, AI API, billing, or external data transfer was added.


## Latest implementation update — Character alias and cross-link review

- Added a project-scoped character alias field to Character Studio. Aliases are stored inside the existing character profile JSON, so no database migration or new API route is required.
- Continuity review now recognizes the canonical name, nickname, and alternate names when checking whether a character appears in a chapter, and when suggesting a missing chapter Canon link.
- Added a soft warning when a Timeline event references characters that are not linked to any scanned chapter Canon. Future events may legitimately be unlinked; the result is explicitly a review hint, not an error.
- Extended the continuity test fixture to cover aliases and Timeline-to-chapter cross-links.
- These checks remain heuristic and project-scoped; they do not rewrite prose or infer semantic contradictions.


## Latest implementation update — Plot-to-manuscript tracking

- Added `plot_threads.chapter_ids_json` through migration `0007_plot_thread_chapter_references.sql`; existing plot rows default to an empty array without data loss.
- Plot Room now lets the author associate one plot thread with multiple chapters, displays linked chapter coverage as a count (not a claim of completion), and offers direct navigation from each plot card to its linked chapter.
- Plot edit flow can revise chapter associations as well as characters and summary.
- Worker validates every linked chapter against the same project on create/update; deleting a chapter removes only that chapter ID from plot links in the same D1 batch.
- Continuity review flags dangling chapter references, plot threads without chapter links, and soft Canon mismatches between a plot's characters and linked chapters.
- No external AI, billing, or deployment was enabled.
