import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, css] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  readFile(new URL("../public/style.css", import.meta.url), "utf8")
]);

const requiredIds = [
  "chapterHistoryButton", "chapterHistoryInline", "studioHistoryShortcut",
  "continuityPanel", "runContinuityCheck", "studioContinuityShortcut",
  "manuscriptEditor", "manuscriptBody", "editorFont", "editorSize",
  "editorLineHeight", "editorPageMargin", "autoFormatManuscript",
  "aiFormatManuscript", "chapterStatus", "chapterTargetWords", "chapterSynopsis",
  "chapterAuthorNotes", "chapterWordProgressText", "chapterWordProgressBar", "projectWordProgressText"
];

for (const id of requiredIds) {
  const matches = html.match(new RegExp('\\bid="' + id + '"', "g")) || [];
  assert.equal(matches.length, 1, "HTML must contain exactly one #" + id);
}

assert.match(html, /id="manuscriptEditor"[^>]*contenteditable="true"/,
  "the visible manuscript surface must be editable");
assert.match(html, /<textarea id="manuscriptBody"[^>]*hidden/,
  "the legacy storage textarea must remain hidden");
assert.match(css, /#manuscriptBody\s*\[hidden\]\s*\{\s*display:\s*none\s*!important;/,
  "the hidden storage field must not override the hidden attribute");

for (const selector of [
  ' $("studioHistoryShortcut")?.addEventListener("click"',
  ' $("studioContinuityShortcut")?.addEventListener("click"',
  'editor.addEventListener("input"',
  'editor.addEventListener("compositionend"',
  'event.key.toLowerCase() === "s"',
  'event.key.toLowerCase() === "f"',
  '$("autoFormatManuscript")?.addEventListener("click"'
]) {
  assert.ok(app.includes(selector.trim()), "missing editor behavior: " + selector.trim());
}

assert.ok(app.includes("panel.hidden = false"), "continuity shortcut must reveal its panel");
assert.ok(app.includes('$("chapterHistoryButton")?.click()'),
  "history shortcut must activate the existing chapter history control");

assert.ok(app.includes('"newChapter", "studioContinuityShortcut"'),
  "continuity shortcut must be hidden when no Cloud project is active");
assert.ok(app.includes('"chapterHistoryInline", "studioHistoryShortcut"'),
  "history shortcut must be hidden when no chapter is active");

const recoveryStart = app.indexOf("async function recoverLocalChapterDraft()");
const recoveryEnd = app.indexOf("\nasync function moveActiveChapter", recoveryStart);
assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart,
  "local chapter recovery handler must remain discoverable");
const recoveryHandler = app.slice(recoveryStart, recoveryEnd);
const recoveryFetch = recoveryHandler.indexOf("await cloudApi(");
const recoveryGuard = recoveryHandler.indexOf("if (cloud.activeChapterId !== chapterId) return;");
assert.ok(recoveryHandler.includes("const chapterId = cloud.activeChapterId;") &&
  recoveryFetch >= 0 && recoveryGuard > recoveryFetch,
  "recovery must abort after an async fetch if the user switched chapters");
assert.ok(recoveryHandler.includes("latest.chapter.id !== chapterId"),
  "recovery must verify that Cloud returned the requested chapter");

const selectionStart = app.indexOf("async function selectCloudChapter(chapterId)");
const selectionEnd = app.indexOf("\nfunction scheduleCloudSave", selectionStart);
assert.ok(selectionStart >= 0 && selectionEnd > selectionStart,
  "Cloud chapter selection handler must remain discoverable");
const selectionHandler = app.slice(selectionStart, selectionEnd);
const selectionFetch = selectionHandler.indexOf("await cloudApi(");
const selectionGuard = selectionHandler.indexOf("selectionToken !== cloud.chapterSelectionToken", selectionFetch);
assert.ok(selectionHandler.includes("const selectionToken = ++cloud.chapterSelectionToken;") &&
  selectionFetch >= 0 && selectionGuard > selectionFetch,
  "late Cloud responses must not replace a more recent chapter selection");
assert.ok(selectionHandler.includes("loaded.chapter.id !== chapterId"),
  "chapter selection must verify the returned chapter ID");

const saveStart = app.indexOf("async function saveCloudChapter()");
const saveEnd = app.indexOf("\nasync function createCloudChapter", saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart,
  "Cloud chapter save handler must remain discoverable");
const saveHandler = app.slice(saveStart, saveEnd);
const currentDraftCheck = saveHandler.indexOf("const currentDraft = activeChapterDraft();");
const conditionalDraftStore = saveHandler.indexOf("if (saveStillCurrent) {");
const guardedDraftStore = saveHandler.indexOf("storeLocalChapterDraft(", conditionalDraftStore);
assert.ok(currentDraftCheck >= 0 &&
  saveHandler.includes("const saveStillCurrent = currentDraft.title === draft.title") &&
  conditionalDraftStore > currentDraftCheck && guardedDraftStore > conditionalDraftStore,
  "a stale Cloud save response must not overwrite a newer local recovery draft");
assert.ok(saveHandler.includes("if (saveStillCurrent) {") &&
  saveHandler.includes("มีการแก้ไขใหม่ · กำลังบันทึกต่อ") &&
  saveHandler.includes("กำลังส่งข้อความที่แก้ไขล่าสุดขึ้น Cloud"),
  "the UI must not claim the chapter is fully saved while newer edits are still pending");
assert.ok(saveHandler.includes("if (saveStillCurrent && $(\"recoverLocalDraft\"))"),
  "a newer local draft must not have its recovery affordance hidden by an older save response");

const historyStart = app.indexOf("async function showChapterHistory()");
const historyEnd = app.indexOf("\nasync function importLocalNovelData", historyStart);
assert.ok(historyStart >= 0 && historyEnd > historyStart,
  "chapter history handler must remain discoverable");
const historyHandler = app.slice(historyStart, historyEnd);
assert.ok(historyHandler.includes("const chapterId = cloud.activeChapterId;") &&
  historyHandler.includes("if (cloud.activeChapterId !== chapterId) return;") &&
  historyHandler.includes("restored.chapter.id !== chapterId"),
  "history and snapshot restore must be bound to the chapter that opened them");

assert.match(css, /@media \(min-width: 981px\) and \(max-width: 1280px\)[\s\S]*?#manuscript \.manuscript-layout\s*\{\s*grid-template-columns:\s*minmax\(150px, \.72fr\) minmax\(0, 2\.1fr\) minmax\(205px, \.96fr\)/,
  "tablet workspace must retain chapter, manuscript, and insight columns");
assert.match(css, /@media \(min-width: 1281px\)[\s\S]*?#manuscript \.manuscript-layout\s*\{\s*grid-template-columns:\s*minmax\(190px, 220px\) minmax\(420px, 1fr\) minmax\(245px, 285px\)/,
  "wide desktop workspace must retain three columns");
assert.match(css, /@media \(max-width: 980px\)[\s\S]*?#manuscript \.manuscript-layout\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/,
  "narrow layouts must collapse the workspace to one column");
assert.match(css, /@media \(max-width: 620px\)[\s\S]*?#manuscript \.chapter-list\s*\{\s*display:\s*flex;\s*overflow-x:\s*auto/,
  "mobile chapter navigation must remain horizontally scrollable");
assert.match(css, /#manuscript \.manuscript-main\s*\{\s*min-width:\s*0;/,
  "manuscript column must be allowed to shrink without forcing page overflow");
assert.match(html, /value="pending_approval"/, "chapter workflow must include the approval queue");
assert.match(html, /value="approved"/, "chapter workflow must include the approved state");
assert.ok(app.includes("workflow_status:") && app.includes("target_word_count:") && app.includes("author_notes:"),
  "chapter workflow metadata must be included in the autosave payload");
assert.ok(app.includes("renderChapterWordProgress") && app.includes("190,000 คำ"),
  "chapter and project word-goal progress must be rendered");
console.log("Novel Studio contract tests passed: editor, workflow, synopsis, notes, word goals, recovery, and autosave.");


assert.match(css, /\.genre-level\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 22px minmax\(90px, \.85fr\) 92px/s,
  "genre scoring rows must reserve a dedicated score column");
assert.match(css, /\.genre-level output\s*\{[^}]*width:\s*92px;[^}]*min-width:\s*92px;/s,
  "genre score output must have enough fixed width for the numeric label");
assert.match(css, /@media\s*\(max-width:\s*1280px\)[\s\S]*?\.genre-level-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/,
  "tablet layouts must stack genre scoring rows to prevent adjacent score overlap");


assert.match(css, /\.form-card\s+\.row-actions\s*>\s*\.gold-button\s*\{\s*margin-top:\s*0;/,
  "primary buttons inside form action rows must not inherit standalone submit spacing");


assert.match(css, /\.row-actions\s*,\s*\.project-form-actions\s*,\s*\.module-actions\s*,\s*\.export-actions\s*\{\s*align-items:\s*center;/,
  "all repeated action groups must share vertical centering");
assert.match(css, /\.form-card\s+\.project-form-actions\s*>\s*\.gold-button\s*\{\s*margin-top:\s*0;/,
  "project form primary action must not inherit standalone submit spacing");
assert.match(css, /\.form-card\s+\.row-actions\s*>\s*\.gold-button\s*\{\s*margin-top:\s*0;/,
  "cover, illustration, and character form action rows must not inherit standalone submit spacing");


assert.match(css, /#projects\s+\.genre-level-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
  "project genre controls must use one full-width column inside the constrained project form");
assert.match(css, /#projects\s+\.genre-level\s*>\s*label\s*\{[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;/s,
  "Thai genre labels must not break character-by-character in narrow cards");
assert.match(css, /#projects\s+\.genre-level\s*\{[^}]*grid-template-columns:\s*minmax\(112px,\s*1\.2fr\) 22px minmax\(96px,\s*\.9fr\) 58px;/s,
  "project genre row must reserve readable label, checkbox, slider, and score tracks");


assert.match(css, /#projects\s*>\s*\.two-column\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.25fr\) minmax\(280px,\s*\.75fr\);[^}]*align-items:\s*start;/s,
  "project form must receive the wider column and the empty list card must not stretch vertically");
assert.match(css, /@media\s*\(max-width:\s*980px\)[\s\S]*?#projects\s*>\s*\.two-column\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
  "project form and saved novel list must stack on tablet portrait and narrow screens");


assert.match(css, /\.genre-level\s*>\s*label\s*\{[^}]*overflow-wrap:\s*normal;[^}]*word-break:\s*normal;/s,
  "genre labels must never wrap Thai words character-by-character in any Studio view");


assert.match(css, /\.module-item small\s*,\s*\.scene-tracker-item-main p\s*,\s*\.plot-linked-scenes > span\s*,\s*\.character-reference-meta small\s*,\s*\.project-meta\s*\{\s*overflow-wrap:\s*normal;\s*word-break:\s*normal;/,
  "Thai descriptive prose across project, scene, plot, and character cards must wrap at natural word boundaries");
