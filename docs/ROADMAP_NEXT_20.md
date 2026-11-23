# STORYFORGE — Next 20 implementation tasks

Scope: test branch only (`feature/storyforge-studio-80`). No merge to `main`, production deployment, live migration, paid AI calls, or external data transfer without explicit approval.

The sequence is deliberately writer-first. Status is updated only after code and checks exist.

| # | Work item | Acceptance target | Status |
|---:|---|---|---|
| 1 | Scene Tracker data model | Scene records stored per novel, with type/status and chapter/character references | Implemented; CI passed; migration 0008 pending runtime application |
| 2 | Scene Tracker UI | Create, list, edit, delete scenes and navigate to linked chapters | Implemented; CI passed; browser QA pending |
| 3 | Scene reference integrity | Worker validates same-project chapter/character references; chapter deletion cleans links | Implemented; CI passed; live D1 runtime QA pending |
| 4 | Backup/restore for scenes | Backup validates scene links; restore defers chapter links until chapters exist | Implemented; regression tests passed in CI |
| 5 | Continuity integration | Checker reports scenes without chapter links and dangling scene links | Implemented; continuity regression tests passed in CI |
| 6 | Timeline-to-chapter linking | Events can reference relevant chapters without cross-project leakage | Implemented; CI passed; migration 0009 pending runtime application |
| 7 | World-lore chapter links | Locations/rules can be traced to chapters that establish or use them | Implemented; CI passed; migration 0009 pending runtime application |
| 8 | Plot-to-scene navigation | Plot cards expose their related scenes and chapter progression | Implemented; CI passed |
| 9 | Chapter status metadata | Track outline/draft/revision/final state separately from save revision | Implemented; CI passed; migration 0010 pending runtime application |
| 10 | Chapter synopsis fields | Store per-chapter summary for navigation and context assembly | Implemented; CI passed; migration 0010 pending runtime application |
| 11 | Manuscript outline view | Reorder chapters and inspect synopsis/scene coverage before drafting | Implemented; CI passed |
| 12 | Editor usability pass | Improve tablet toolbar, focus mode, keyboard and Thai typing behavior | Implemented; tablet toolbar, focus/save shortcuts and Thai IME composition handling; CI passed |
| 13 | Save/recovery acceptance | Test autosave, conflict, offline draft, reload and restore on real browser | Code-level race/recovery regressions pass CI, including typing during an in-flight save; live browser/device acceptance blocked on isolated staging Worker/D1 |
| 14 | TXT export validation | Verify complete multi-chapter Thai output and stable ordering | Implemented and tested with multi-chapter Thai fixtures and project isolation; CI passed |
| 15 | DOCX validation | Verify headings, Thai typography, embedded images and metadata in office-reader package tests; real reader QA pending | Implemented package tests for multi-chapter Thai, TOC, page breaks and publishing metadata; real reader QA pending |
| 16 | EPUB validation | Verify metadata, navigation, chapter XHTML, image embedding and Thai rendering | Implemented package tests for Thai language, chapter navigation and publication metadata; real e-reader QA pending |
| 17 | Publishing metadata | Add title page, pen name, copyright, foreword and author bio fields | Implemented per-project metadata fields and TXT/DOCX/EPUB metadata export; CI passed; migration 0011 pending runtime application |
| 18 | Cover Studio persistence | Persist cover brief, prompt and selected character references per project; approved artwork selection awaits image assets | Implemented Cloud/local project-scoped brief persistence; approved cover asset workflow remains pending; migration 0012 pending runtime application |
| 19 | Illustration asset workflow | Categorize, filter, caption and reinsert project-local illustrations with backup checks | Implemented categories, filtering, captions and reinsert; library remains device-local by design |
| 20 | Private-beta QA gate | Browser/tablet, isolation, backup/restore, security and accessibility test report | QA gate checklist corrected to require migrations 0001–0012 on isolated staging; release remains blocked pending staging/browser/device and backup-restore drills |

## Current execution note

The first implementation slice is Scene Tracker. It reuses the existing project-scoped Story Notes collection to avoid introducing a second scene API/table, while adding dedicated scene fields through a forward-only D1 migration. Existing notes remain intact. The feature must remain marked unavailable on production until migration 0008 is deliberately applied and the Worker build is approved.
