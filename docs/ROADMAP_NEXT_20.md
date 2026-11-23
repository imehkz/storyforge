# STORYFORGE — Next 20 implementation tasks

Scope: test branch only (`feature/storyforge-studio-80`). No merge to `main`, production deployment, live migration, paid AI calls, or external data transfer without explicit approval.

The sequence is deliberately writer-first. Status is updated only after code and checks exist.

| # | Work item | Acceptance target | Status |
|---:|---|---|---|
| 1 | Scene Tracker data model | Scene records stored per novel, with type/status and chapter/character references | In progress |
| 2 | Scene Tracker UI | Create, list, edit, delete scenes and navigate to linked chapters | In progress |
| 3 | Scene reference integrity | Worker validates same-project chapter/character references; chapter deletion cleans links | In progress |
| 4 | Backup/restore for scenes | Backup validates scene links; restore defers chapter links until chapters exist | Planned |
| 5 | Continuity integration | Checker reports scenes without chapter links and dangling scene links | Planned |
| 6 | Scene-to-timeline linking | Events can reference relevant chapters/scenes without cross-project leakage | Planned |
| 7 | World-lore chapter links | Locations/rules can be traced to chapters that establish or use them | Planned |
| 8 | Plot-to-scene navigation | Plot cards expose their related scenes and chapter progression | Planned |
| 9 | Chapter status metadata | Track outline/draft/revision/final state separately from save revision | Planned |
| 10 | Chapter synopsis fields | Store per-chapter summary for navigation and context assembly | Planned |
| 11 | Manuscript outline view | Reorder chapters and inspect synopsis/scene coverage before drafting | Planned |
| 12 | Editor usability pass | Improve tablet toolbar, focus mode, keyboard and Thai typing behavior | Planned |
| 13 | Save/recovery acceptance | Test autosave, conflict, offline draft, reload and restore on real browser | Planned |
| 14 | TXT export validation | Verify complete multi-chapter Thai output and stable ordering | Planned |
| 15 | DOCX validation | Verify headings, Thai typography, embedded images and metadata in office readers | Planned |
| 16 | EPUB validation | Verify metadata, navigation, chapter XHTML, image embedding and Thai rendering | Planned |
| 17 | Publishing metadata | Add title page, pen name, copyright, foreword and author bio fields | Planned |
| 18 | Cover Studio persistence | Persist cover brief, prompt revisions and approved-cover selection per project | Planned |
| 19 | Illustration asset workflow | Improve project-local library categories, insert/replace/caption and backup checks | Planned |
| 20 | Private-beta QA gate | Browser/tablet, isolation, backup/restore, security and accessibility test report | Planned |

## Current execution note

The first implementation slice is Scene Tracker. It reuses the existing project-scoped Story Notes collection to avoid introducing a second scene API/table, while adding dedicated scene fields through a forward-only D1 migration. Existing notes remain intact. The feature must remain marked unavailable on production until migration 0008 is deliberately applied and the Worker build is approved.
