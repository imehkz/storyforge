"""Static security and frontend contract checks.

These source-level checks are not a substitute for integration tests against a
Cloudflare Worker and D1 database.
"""
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKER = (ROOT / "cloudflare" / "worker.js").read_text(encoding="utf-8")
APP = (ROOT / "public" / "app.js").read_text(encoding="utf-8")
HTML = (ROOT / "public" / "index.html").read_text(encoding="utf-8")
WRANGLER = (ROOT / "cloudflare" / "wrangler.toml.example").read_text(encoding="utf-8")
CSS = (ROOT / "public" / "style.css").read_text(encoding="utf-8")


class IdCollector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key == "id" and value:
                self.ids.append(value)


class WorkerContractTests(unittest.TestCase):
    def test_owner_allowlist_is_required_and_enforced(self):
        self.assertIn("env.GITHUB_OWNER_ID", WORKER)
        self.assertIn('String(githubUser.id) !== String(env.GITHUB_OWNER_ID)', WORKER)
        self.assertIn("role = 'owner'", WORKER)

    def test_oauth_state_is_hashed_expiring_and_single_use(self):
        self.assertIn("sha256(state)", WORKER)
        self.assertIn("DELETE FROM oauth_states", WORKER)
        self.assertIn("RETURNING state_hash", WORKER)
        self.assertIn("STATE_TTL_SECONDS", WORKER)
        self.assertIn('redirect_uri: new URL("/auth/callback", request.url).toString()', WORKER)

    def test_sessions_are_hashed_and_csrf_protected(self):
        self.assertIn("sha256(sessionToken)", WORKER)
        self.assertIn("HttpOnly; SameSite=Lax", WORKER)
        self.assertIn("X-CSRF-Token", WORKER)
        self.assertIn('request.headers.get("Origin")', WORKER)
        self.assertIn("__Host-storyforge_csrf", WORKER)
        self.assertIn("cookieValue(request, CSRF_COOKIE)", WORKER)
        self.assertIn("HttpOnly; SameSite=Strict", WORKER)
        self.assertIn('headers.append("Set-Cookie", item)', WORKER)
        self.assertIn("revoked_at", WORKER)

    def test_health_endpoint_probes_database_readiness(self):
        self.assertIn('await env.DB.prepare("SELECT 1 AS ok").first()', WORKER)
        self.assertIn('error: "DATABASE_UNAVAILABLE"', WORKER)
        self.assertIn('databaseReady: true', WORKER)

    def test_project_queries_are_owner_scoped(self):
        self.assertIn("WHERE owner_id = ?", WORKER)
        self.assertIn("projects.owner_id = ?", WORKER)
        self.assertIn("project_id = ?", WORKER)

    def test_local_import_uses_stable_client_ids(self):
        self.assertIn("INSERT OR IGNORE INTO projects", WORKER)
        self.assertIn("INSERT OR IGNORE INTO chapters", WORKER)
        self.assertIn("INSERT OR IGNORE INTO ${config.table}", WORKER)
        self.assertIn("clientId", APP)
        self.assertIn("migrationMapKey", APP)

    def test_chapter_snapshot_history_is_bounded(self):
        self.assertGreaterEqual(
            WORKER.count("ORDER BY created_at DESC, id DESC LIMIT 100"),
            2,
            "Both chapter edits and restores must prune history to the latest 100 snapshots",
        )
        self.assertGreaterEqual(
            WORKER.count("DELETE FROM snapshots WHERE resource_type = 'chapter' AND resource_id = ?"),
            2,
        )

    def test_cloud_restore_rolls_back_only_records_created_by_failed_restore(self):
        restore = APP[APP.index("async function restoreCloudBackup"):APP.index("function restoreFromFile")]
        self.assertIn("const createdProjects = new Set()", restore)
        self.assertIn("const createdItems = []", restore)
        self.assertIn("if (result.created)", restore)
        self.assertIn('method: "DELETE"', restore)
        self.assertIn("if (createdProjects.has(item.projectId)) continue", restore)
        self.assertIn("if (createdProjects.has(project.id)) continue", restore)
        self.assertIn("rollbackErrors.length", restore)

    def test_local_recovery_storage_failure_does_not_block_cloud_autosave(self):
        self.assertIn("function storeLocalChapterDraft(chapterId, draft, revision = 0)", APP)
        self.assertIn("Local chapter recovery draft could not be stored", APP)
        draft_function = APP[APP.index("function storeLocalChapterDraft"):APP.index("async function cloudApi")]
        self.assertIn("return false;", draft_function)
        self.assertIn("localStorageReady = false", APP)
        self.assertIn("scheduleCloudSave();", APP)

    def test_telegram_backup_requires_owner_session_and_csrf(self):
        route = WORKER[WORKER.index('if (path === "/api/telegram-backup"'):WORKER.index('if (path === "/api/session"')]
        self.assertIn("await requireSession(request, env, true)", route)
        self.assertIn('"X-CSRF-Token": cloud.csrfToken', APP)

    def test_automatic_backup_retries_soon_after_failure(self):
        self.assertIn("const AUTO_BACKUP_RETRY_MS = 15 * 60 * 1000", APP)
        self.assertIn("const succeeded = await sendTelegramBackup(true)", APP)
        self.assertIn("Date.now() + AUTO_BACKUP_RETRY_MS", APP)
        self.assertIn("Backup อัตโนมัติไม่สำเร็จ ระบบจะลองใหม่ใน 15 นาที", APP)

    def test_chapter_history_and_revision_are_atomic(self):
        self.assertGreaterEqual(WORKER.count("env.DB.batch(["), 2)
        self.assertIn("expectedRevision", WORKER)
        self.assertIn("'word_count', word_count, 'revision', revision", WORKER)
        self.assertIn("validateWordCount(input.wordCount, countWords(body))", WORKER)
        self.assertIn("countWords(body)", WORKER)
        self.assertIn("word_count", WORKER)
        self.assertIn("resource_type = 'chapter'", WORKER)
        self.assertIn("DELETE FROM snapshots WHERE resource_type = 'chapter'", WORKER)
        self.assertIn("/move", WORKER)
        self.assertIn("sort_order", WORKER)

    def test_thai_word_count_uses_consistent_unicode_segmentation(self):
        self.assertIn('new Intl.Segmenter("th", { granularity: "word" })', WORKER)
        self.assertIn('new Intl.Segmenter("th", { granularity: "word" })', APP)
        self.assertIn("filter(part => part.isWordLike).length", WORKER)
        self.assertIn("filter(part => part.isWordLike).length", APP)

    def test_frontend_has_cloud_project_and_editor_integration(self):
        for fragment in (
            "/api/projects", "/api/chapters/", "scheduleCloudSave",
            "importLocalNovelData", "showChapterHistory",
            "loadProjectModules", "createModuleItem",
            "moveActiveChapter", "deleteActiveChapter",
            "toggleCloudProjectArchive", "deleteCloudProject",
            "renderRelationshipGraph", "renderPlotBoard", "renderTimelineView",
            "saveCharacter", "countWords"
        ):
            self.assertIn(fragment, APP)

    def test_illustration_library_is_project_scoped(self):
        for fragment in ("ILLUSTRATION_LIBRARY_STORE", "illustrationLibraryRecords(projectId)", "savePendingIllustrationToLibrary", "renderIllustrationLibrary"):
            self.assertIn(fragment, APP)
        self.assertIn("indexedDB.open(CHARACTER_VAULT_DB, 2)", APP)
        self.assertIn("id=\"illustrationLibraryGallery\"", HTML)
        self.assertIn("id=\"saveIllustrationToLibrary\"", HTML)
        self.assertIn(".illustration-library-card", CSS)

    def test_illustration_library_backup_v4_is_project_scoped(self):
        for fragment in ("collectIllustrationLibraryBackup", "validateIllustrationLibraryBackup", "restoreIllustrationLibraryRecords", "illustrationLibrary", "version: 4", "backup.version >= 4"):
            self.assertIn(fragment, APP)
        self.assertIn("[1, 2, 3, 4].includes(backup.version)", APP)

    def test_editor_backup_key_is_preserved(self):
        self.assertIn('key === "manuscriptBody" ? "sf_manuscript"', APP)
        self.assertIn("storageKeyFor", APP)
        self.assertIn("sf_manuscript", APP)

    def test_user_content_is_escaped_before_html_rendering(self):
        self.assertIn("function escapeHtml(value)", APP)
        for fragment in (
            "escapeHtml(item.title)",
            "escapeHtml(item.summary ||",
            "escapeHtml(item.description ||",
            "escapeHtml(item.name.slice",
            "escapeHtml(item.id)",
        ):
            self.assertIn(fragment, APP)

    def test_manuscript_html_is_sanitized_with_a_small_allowlist(self):
        self.assertIn("function sanitizeManuscriptHtml(value)", APP)
        self.assertIn('new Set(["P","DIV","BR","STRONG","B","EM","I","U","H1","H2","H3","BLOCKQUOTE","UL","OL","LI","SPAN","FIGURE","FIGCAPTION","IMG"])', APP)
        self.assertIn('if (attr.name !== "style") node.removeAttribute(attr.name);', APP)
        self.assertIn('["text-align","font-family","font-size","line-height","width","max-width","height","display","margin"].includes(key)', APP)
        self.assertIn(".test(val)) safe.push", APP)

    def test_character_vault_profile_fields_round_trip(self):
        for field in (
            "nickname", "gender", "birthday", "profession", "age", "pronouns",
            "species", "height", "face", "skin", "eyes", "hair", "build",
            "clothing", "accessories", "expressions", "appearance", "personality",
            "motivation", "backstory", "strengths", "weaknesses", "likes", "dislikes",
            "skills", "family", "customFields", "secret", "description"
        ):
            self.assertIn(field + ":", APP)
        for element_id in (
            "characterNickname", "characterGender", "characterBirthday",
            "characterProfession", "characterLikes", "characterDislikes",
            "characterSkills", "characterFamily", "characterFace", "characterSkin",
            "characterEyes", "characterHair", "characterBuild", "characterClothing",
            "characterAccessories", "characterExpressions", "characterCustomFields"
        ):
            self.assertIn(element_id, HTML)
            self.assertIn(element_id, APP)

    def test_relationship_map_has_visible_keyboard_focus(self):
        self.assertIn(".relationship-node:focus-visible rect", CSS)
        self.assertIn(".relationship-edge:focus-visible path", CSS)

    def test_relationship_edges_follow_nodes_during_drag(self):
        self.assertIn('path?.setAttribute("d"', APP)
        self.assertIn('label?.setAttribute("x"', APP)
        self.assertIn('label?.setAttribute("y"', APP)

    def test_relationship_map_supports_english_and_thai_relationship_types(self):
        for term in ("enemy", "family", "romance", "ally", "business", "mentor"):
            self.assertIn(term, APP)

    def test_relationship_map_keeps_interactive_nodes_accessible(self):
        self.assertIn('id="relationshipGraph" class="relationship-graph" role="region"', HTML)
        self.assertIn('role="group" aria-label="แผนผังสายใยความสัมพันธ์ของตัวละคร"', APP)
        self.assertIn('role="button" aria-label="ตัวละคร ', APP)
        self.assertIn('edge.setAttribute("role","button")', APP)

    def test_worker_rejects_relationships_linking_characters_outside_project(self):
        module_route = WORKER[WORKER.index("const moduleMatch"):WORKER.index("const chaptersMatch")]
        self.assertIn("const validateRelationshipEndpoints = async (sourceId, targetId)", module_route)
        self.assertIn('"SELECT id FROM characters WHERE project_id = ? AND id IN (?, ?)"', module_route)
        self.assertIn("await validateRelationshipEndpoints(values.source_character_id, values.target_character_id)", module_route)
        self.assertIn("await validateRelationshipEndpoints(source, target)", module_route)
        self.assertIn("INVALID_RELATIONSHIP_CHARACTER", module_route)

    def test_plot_world_and_timeline_character_references_are_project_scoped(self):
        module_route = WORKER[WORKER.index("const moduleMatch"):WORKER.index("const chaptersMatch")]
        self.assertGreaterEqual(module_route.count('character_ids_json: ["json_array", 8000]'), 3)
        self.assertIn("const validateCharacterReferences = async (raw)", module_route)
        self.assertIn('"SELECT id FROM characters WHERE project_id = ? AND id IN (" + placeholders + ")"', module_route)
        self.assertIn("await validateCharacterReferences(values.character_ids_json)", module_route)
        for control in ("plotCharacters", "worldCharacters", "timelineCharacters"):
            self.assertIn(control, HTML)
            self.assertIn(control, APP)
        self.assertIn("promptCharacterReferences", APP)
        self.assertIn("characterReferenceNames", APP)

    def test_canonical_character_references_survive_backup_and_restore(self):
        restore = APP[APP.index("async function restoreCloudBackup"):APP.index("function restoreFromFile")]
        self.assertIn('character_ids_json: ["json_array", 8000]', WORKER)
        self.assertIn('"character_ids_json"', restore)
        self.assertIn('for (const collection of ["plot-threads", "world-lore", "timeline"])', restore)
        self.assertIn('characterIds.has(id)', restore)

    def test_relationship_edit_can_reassign_character_endpoints(self):
        self.assertIn("characters[sourceIndex].id", APP)
        self.assertIn("characters[targetIndex].id", APP)
        self.assertIn("targetIndex === sourceIndex", APP)

    def test_ai_assistant_does_not_advertise_copilot(self):
        self.assertNotIn("Copilot", APP)
        self.assertNotIn("Copilot", HTML)
        self.assertIn("OpenAI (ChatGPT)", HTML)
        self.assertIn("ยังไม่เชื่อมต่อ API", HTML)
        self.assertIn("คัดลอกบริบทไปใช้กับ ChatGPT", HTML)
        self.assertIn("ผู้ให้บริการหลักที่วางแผนไว้: OpenAI (ChatGPT)", APP)
        self.assertIn("ยังไม่เปิดใช้ API", APP)
        self.assertNotIn("Copilot", APP + HTML)

    def test_story_context_copy_is_scoped_to_the_active_project(self):
        self.assertIn('id="copyStoryContext"', HTML)
        self.assertIn("active.id === cloud.activeProjectId", APP)
        self.assertIn("cloud.modules || {}", APP)
        self.assertIn("ข้อกำหนด: ใช้ข้อมูลของนิยายนี้เท่านั้น", APP)
        self.assertIn("buildStoryAssistantContext()", APP)
        self.assertIn("writingSettingsKey(active.id)", APP)
        self.assertIn("writingSettings.genres", APP)
        self.assertIn("writingSettings.selectedGenres", APP)
        self.assertIn("selectedGenres.forEach(genre", APP)
        self.assertIn("writingWordGoalKey(active.id)", APP)
        self.assertIn("context.length > 40000", APP)
        self.assertIn("projectGuardrail", APP)

    def test_character_profile_size_is_checked_before_cloud_save(self):
        self.assertIn("JSON.stringify(profile).length > 19000", APP)
        self.assertIn("profile_json: profile", APP)

    def test_novel_genres_are_explicitly_multi_select_and_project_scoped(self):
        self.assertIn('class="genre-level"><label for="genreLevel0"', HTML)
        self.assertIn("data-genre-enabled", HTML)
        self.assertIn("selectedGenres", APP)
        self.assertIn('writingSettingsKey()', APP)
        self.assertIn("input.disabled = !toggle?.checked", APP)
        self.assertIn("grid-template-columns:minmax(90px,1fr) 20px minmax(70px,1.6fr) 42px", CSS)
        self.assertGreaterEqual(CSS.count("grid-template-columns:minmax(90px,1fr) 20px minmax(70px,1.6fr) 42px"), 2)

    def test_dashboard_word_goal_uses_active_novel_settings(self):
        self.assertIn("writingSettingsKey(active?.id)", APP)
        self.assertIn("configuredNovelGoal", APP)
        self.assertIn("projectWritingSettings.chapterCount", APP)
        self.assertIn("projectWritingSettings.wordsPerChapter", APP)

    def test_active_project_id_is_visible_in_workspace_and_dashboard(self):
        self.assertIn('" · ID: " + active.id', APP)
        self.assertIn('" · Project ID: " + active.id', APP)

    def test_book_cover_studio_is_project_scoped_and_does_not_fake_image_generation(self):
        for fragment in ('data-tab="cover"', 'id="cover"', 'id="coverTitle"', 'id="coverPenName"',
                         'id="coverCharacters"', 'id="coverBlurb"', 'id="coverDirection"',
                         'id="coverPrompt"', 'id="copyCoverPrompt"'):
            self.assertIn(fragment, HTML)
        self.assertIn('function activeCoverProject()', APP)
        self.assertIn('function coverBriefKey(projectId) { return "sf_cover_brief_" + projectId; }', APP)
        self.assertIn('project.id === cloud.activeProjectId', APP)
        self.assertIn('function buildCoverPromptText()', APP)
        self.assertIn('setupCoverStudio();', APP)
        self.assertIn('ยังไม่มีระบบสร้างภาพปกเชื่อมต่ออยู่', HTML)
        self.assertIn('.cover-studio-grid', CSS)

    def test_illustration_studio_inserts_project_content_images_safely(self):
        for fragment in ('data-tab="illustrations"', 'id="illustrations"', 'id="illustrationFile"',
                         'id="illustrationCaption"', 'id="insertIllustration"', 'id="illustrationPrompt"'):
            self.assertIn(fragment, HTML)
        self.assertIn('function compressIllustration(file)', APP)
        self.assertIn('function buildIllustrationPromptText()', APP)
        self.assertIn('function insertIllustrationAtCursor()', APP)
        self.assertIn('data:image\\/(?:png|jpeg|webp);base64', APP)
        self.assertIn('node.tagName === "IMG"', APP)
        self.assertIn('setupIllustrationStudio();', APP)
        self.assertIn('ยังไม่มีผู้ให้บริการสร้างภาพเชื่อมต่อ', HTML)
        self.assertIn('.illustration-studio-grid', CSS)

    def test_manuscript_illustrations_are_embedded_in_exports(self):
        self.assertIn("function wordImageRun(node)", APP)
        self.assertIn("word/_rels/document.xml.rels", APP)
        self.assertIn("word/media/", APP)
        self.assertIn("function exportManuscriptEpub(chapters = null, projectTitle = null)", APP)
        self.assertIn("OEBPS/images/", APP)
        self.assertIn("epubImages.map", APP)
        self.assertIn("function exportManuscriptPdf()", APP)
        self.assertIn("sanitizeManuscriptHtml(editor.innerHTML)", APP)

    def test_character_reference_vault_is_project_and_character_scoped(self):
        for fragment in ('id="characterVaultPanel"', 'id="characterReferenceFile"',
                         'id="characterReferenceGallery"', 'id="characterVaultStatus"'):
            self.assertIn(fragment, HTML)
        self.assertIn('const CHARACTER_VAULT_DB = "storyforge_character_vault_v1"', APP)
        self.assertIn('index("projectCharacter")', APP)
        self.assertIn('function addCharacterReference(file)', APP)
        self.assertIn('current.length >= 8', APP)
        self.assertIn('record.canonical', APP)
        self.assertIn('setupCharacterVault();', APP)
        self.assertIn('ไม่ซิงก์ข้ามอุปกรณ์', HTML)
        self.assertIn('.character-reference-gallery', CSS)

    def test_character_vault_cleans_deleted_characters_and_guards_project_switch(self):
        self.assertIn("deleteCharacterVaultForCharacter", APP)
        self.assertIn('if (cloud.activeProjectId && cloud.activeProjectId !== project.id) resetCharacterForm()', APP)
        self.assertIn("cloud.editingCharacterId !== characterId", APP)
        self.assertIn("hydrateRelationshipPortraits(svg, characters, cloud.activeProjectId)", APP)
        self.assertIn('image.setAttribute("href", canonical.dataUrl)', APP)

    def test_character_reference_vault_is_in_backup_v4(self):
        self.assertIn("async function collectCharacterVaultBackup(cloudProjects)", APP)
        self.assertIn("async function restoreCharacterVaultRecords(records)", APP)
        self.assertIn("function validateCharacterVaultBackup(records, cloudProjects)", APP)
        self.assertIn("version: 4", APP)
        self.assertIn("characterVault", APP)
        self.assertIn("restoreCharacterVaultRecords(characterVault)", APP)
        self.assertIn("backup.version >= 3", APP)
        self.assertIn("รวมในไฟล์ Backup รุ่น 4", HTML)

    def test_character_reference_images_can_be_inserted_into_manuscript(self):
        self.assertIn("data-reference-insert", APP)
        self.assertIn("record.projectId !== cloud.activeProjectId", APP)
        self.assertIn("insertIllustrationAtCursor();", APP)

    def test_html_ids_are_unique(self):
        parser = IdCollector()
        parser.feed(HTML)
        duplicates = [value for value, count in Counter(parser.ids).items() if count > 1]
        self.assertEqual(duplicates, [], "Duplicate HTML IDs: " + ", ".join(duplicates))

    def test_worker_routes_auth_before_static_fallback(self):
        self.assertIn('run_worker_first = ["/api/*", "/auth/*"]', WRANGLER)


if __name__ == "__main__":
    unittest.main(verbosity=2)
