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
  "aiFormatManuscript"
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
console.log("Novel Studio contract tests passed: shortcut targets, editor controls, hidden storage field, and save handlers are wired.");


assert.match(css, /\.genre-level\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 22px minmax\(90px, \.85fr\) 92px/s,
  "genre scoring rows must reserve a dedicated score column");
assert.match(css, /\.genre-level output\s*\{[^}]*width:\s*92px;[^}]*min-width:\s*92px;/s,
  "genre score output must have enough fixed width for the numeric label");
assert.match(css, /@media\s*\(max-width:\s*1280px\)[\s\S]*?\.genre-level-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/,
  "tablet layouts must stack genre scoring rows to prevent adjacent score overlap");
