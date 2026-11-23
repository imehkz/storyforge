# STORYFORGE Private Beta QA Gate

**Current decision: NOT READY for production release.**

Scope: validate the private beta only after an isolated staging Worker and D1 database are available. Do not apply pending migrations to the production D1 database as part of this checklist.

## 1. Required staging preparation

- [x] Create a separate staging Cloudflare Worker and D1 database with no production data. The API-only staging Worker and D1 are documented in docs/STAGING_VERIFICATION_2026-11-23.md.
- [ ] Configure a separate staging GitHub OAuth application/callback and owner allowlist without exposing secrets in source control. Do not change the production OAuth app callback.
- [ ] Take a verified staging D1 backup before applying migrations.
- [x] Apply migrations 0001–0012 to the new staging D1 database in order and verify key tables/columns plus foreign-key integrity. Do not reuse the production D1 database for staging; see docs/STAGING_VERIFICATION_2026-11-23.md.
- [x] Serve the frontend index.html, app.js, and style.css from the staging Worker using an isolated static fallback.
- [ ] Confirm staging can be destroyed/recreated without affecting production.
- [ ] Confirm no OpenAI API key or image provider is configured unless billing and privacy have been explicitly approved.

## 2. Manuscript end-to-end acceptance

- [ ] Sign in as the authorized owner; verify unauthenticated and non-owner sessions are rejected.
- [ ] Create a novel, set title/genre/synopsis/publication metadata, and save.
- [ ] Create two chapters, add synopsis and writing status, and reorder them.
- [ ] Type Thai text using Android IME; verify composition is not saved mid-character and final text autosaves.
- [ ] Refresh the browser and verify chapter body, synopsis, status, and Canon links persist.
- [ ] Enter distraction-free mode, use Ctrl/Cmd+S, and exit with Escape.
- [ ] Create a revision, edit the chapter, restore the prior revision, and verify body plus synopsis/status are restored.
- [ ] Simulate offline/local-storage failure where possible; verify the UI reports the error and does not claim Cloud save succeeded.
- [ ] Export TXT, DOCX, EPUB, and print-to-PDF; inspect Thai glyphs, page breaks, table of contents, metadata, and embedded images in actual reader applications.

## 3. Story structure and isolation

- [ ] Create two novels with characters that have identical names; verify all characters, scenes, plot threads, world lore, timeline events, and chapter references remain project-scoped.
- [ ] Create scenes and link multiple chapters/characters; open chapters from the Scene Tracker.
- [ ] Link timeline events and world-lore records to chapters; verify links display correctly.
- [ ] Verify plot board derives related scenes from shared chapter links.
- [ ] Delete a chapter and verify its ID is removed from plot, scene, world-lore, and timeline references without changing unrelated records.
- [ ] Run Continuity Checker and inspect expected findings and false-positive behavior.
- [ ] Attempt forged cross-project chapter and character references through the API; all must be rejected.

## 4. Backup and restore

- [ ] Create a full Backup containing projects, chapters, all module collections, character reference vault, illustration library, publication metadata, and cover briefs.
- [ ] Validate the backup before restore; malformed JSON, dangling references, duplicate IDs, oversized payloads, and cross-project links must be rejected.
- [ ] Restore into a clean staging account and verify all references reconnect after chapter creation.
- [ ] Restore into a non-empty account and verify merge behavior does not delete or overwrite existing records.
- [ ] Force a restore failure and verify rollback deletes only records created by that failed restore.
- [ ] Verify illustration assets remain scoped to their project and categories/captions survive Backup/Restore.
- [ ] Perform an independent encrypted off-site D1 backup and a documented restore drill.

## 5. Security, accessibility, and device QA

- [ ] Verify owner-only authorization, hashed sessions, expiry/logout, CSRF, origin checks, and fail-closed behavior.
- [ ] Verify every API module checks project ownership and reference ownership server-side.
- [ ] Verify no secret, OAuth token, API key, or private novel content appears in logs or client bundles.
- [ ] Test Android tablet portrait/landscape and narrow mobile widths; no clipped controls or horizontal page overflow.
- [ ] Test keyboard navigation, focus visibility, labels, screen-reader announcements, and text contrast.
- [ ] Test Chrome/Android and at least one desktop browser; inspect DOCX with Word/LibreOffice and EPUB with two independent readers.

## 6. Release blockers

The following remain release blockers until evidenced as passed:

1. The isolated staging D1 and Worker now exist; migrations 0001–0012, schema checks, and database-level project-isolation smoke checks passed. The branch frontend files are embedded in the staging Worker. The staging site is not yet authenticated: separate OAuth/secrets, live HTTP/API tests, and browser/device validation remain outstanding.
2. The existing production `storyforge` D1 database still has only migrations 0001–0003 applied; branch migrations 0004–0012 remain unapplied there. The active production Worker still runs an earlier build. Staging has its own D1 and API-only Worker. Do not apply branch migrations or deploy this branch to the production Worker.
3. No real Android tablet/browser E2E run has been performed.
4. Independent encrypted off-site D1 backup and restore drill is not evidenced.
5. DOCX/EPUB have automated package-level tests, but real office/e-reader rendering remains unverified.
6. Illustration Library and Character Reference Vault remain device-local; they are included in user Backup/Restore but are not cross-device Cloud asset storage.
7. AI text/image generation remains disabled; enabling paid APIs requires separate cost and privacy approval.

## Evidence policy

A checkbox is complete only when the run, device, environment, result, and date are recorded. Passing GitHub Actions unit/schema/contract checks does not substitute for browser, device, live D1, or independent backup/restore evidence.
