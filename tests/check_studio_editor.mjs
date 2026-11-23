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
console.log("Novel Studio contract tests passed: shortcut targets, editor controls, hidden storage field, and save handlers are wired.");
