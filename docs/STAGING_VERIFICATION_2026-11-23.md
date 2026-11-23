# STORYFORGE Staging Verification — 23 November 2026

## Scope and safety

This record documents an isolated staging foundation created for the feature/storyforge-studio-80 branch. No production Worker deployment, production D1 migration, production data change, production backup, or main-branch merge was performed.

## Resources

- Staging D1 database: storyforge-staging
- Staging Worker: storyforge-staging
- Worker binding: DB → storyforge-staging
- Worker deployment: one version at 100% traffic for the staging Worker only
- Worker entry point: cloudflare/worker.js from branch feature/storyforge-studio-80
- Worker compatibility date: 2026-11-22
- The three frontend files (index.html, app.js, style.css) are embedded in the staging Worker and served by a small static fallback. No separate Workers Assets binding is used. GitHub OAuth credentials, owner allowlist, and production secrets were not copied.

## D1 migration results

All branch migrations were applied in order to the new empty staging D1 database:

1. 0001_initial_schema.sql
2. 0002_novel_studio_modules.sql
3. 0003_chapter_word_count.sql
4. 0004_canonical_character_references.sql
5. 0005_story_note_character_references.sql
6. 0006_chapter_character_references.sql
7. 0007_plot_thread_chapter_references.sql
8. 0008_scene_tracker.sql
9. 0009_canon_chapter_references.sql
10. 0010_chapter_planning_metadata.sql
11. 0011_project_publication_metadata.sql
12. 0012_cover_brief_persistence.sql

The staging d1_migrations ledger contains all 12 migration filenames. Schema inspection confirmed the expected project publication metadata, cover brief, chapter planning metadata, character/chapter reference JSON fields, Scene Tracker fields, and the expected module tables.

## Data isolation smoke test

Temporary QA records were created in staging only: one QA owner, two separate novel projects, a character with the same display name in each project, one chapter in each project, and a plot thread and Scene Tracker note linked to Project A's own character and chapter.

A direct attempt to create a relationship in Project A using Project B's character was rejected by D1 with a foreign-key constraint error. PRAGMA foreign_key_check returned no violations. All QA records were then deleted by deleting the QA owner; a follow-up count confirmed zero remaining QA projects.

## Verified outcomes

- [x] Isolated staging D1 created; production D1 untouched.
- [x] Migrations 0001–0012 applied in order to staging.
- [x] Migration ledger verified.
- [x] Expected tables and key columns inspected.
- [x] Foreign-key integrity check returned no violations.
- [x] Cross-project relationship insert rejected at the database layer.
- [x] Temporary QA records cleaned up.
- [x] Staging Worker uploaded and its D1 binding verified.
- [x] Staging Worker deployment reports 100% traffic to its own version.

## Still not verified

- [ ] Configure a separate staging GitHub OAuth application/callback and owner allowlist. Do not change the production OAuth app callback.
- [ ] Configure staging-only secrets without copying or exposing production secrets.
- [x] Serve the branch frontend files (index.html, app.js, style.css) from the staging Worker. The files are embedded for this isolated QA deployment; production Worker code and assets are untouched.
- [ ] Execute live HTTP/API tests against the staging Worker, including owner auth, CSRF, project isolation, chapter autosave, snapshots, restore, and module CRUD.
- [ ] Browser end-to-end tests and Android tablet portrait/landscape QA.
- [ ] Full application backup and restore drill, including device-local character/illustration assets.
- [ ] Independent encrypted off-site D1 backup and restore drill.
- [ ] Real DOCX/EPUB/PDF rendering inspection.

## Important limitation

The staging Worker is deployed with the branch Worker API source, the staging D1 binding, and embedded copies of the branch frontend files. It is not yet a complete authenticated staging environment because it has no separate OAuth configuration or owner allowlist. Cloudflare API inspection confirmed the Worker version and binding; direct HTTP requests from the available Cloudflare execution environment and web reader were blocked by their network policies, so no live API/browser success is claimed here.

## Production safety

The existing production D1 database and active production Worker were not modified. Do not apply migrations 0004–0012 to production or deploy this branch to the production Worker without explicit owner approval and a reviewed rollout/rollback plan.