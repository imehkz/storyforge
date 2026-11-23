import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
function extractFunction(name) {
  const expression = new RegExp("function " + name + "\\([\\s\\S]*?\\n\\}");
  const match = source.match(expression);
  assert.ok(match, "Missing function " + name);
  return match[0];
}

const warningLog = [];
const storageFailure = { setItem() { throw new Error("QuotaExceededError"); } };
const hint = { textContent: "" };
const draftStore = new Function("$", "localStorage", "console", extractFunction("storeLocalChapterDraft") + "\\nreturn storeLocalChapterDraft;")(
  id => id === "chapterSaveHint" ? hint : null,
  storageFailure,
  { warn: (...args) => warningLog.push(args) }
);
assert.equal(draftStore("chapter-1", { title: "บท", body: "ข้อความ" }, 2), false);
assert.match(hint.textContent, /พื้นที่จัดเก็บฉบับกู้คืน/);
assert.equal(warningLog.length, 1);

const elements = {
  title: { value: "นิยาย" }, genre: { value: "แฟนตาซี" }, context: { value: "" },
  chapterTitle: { value: "บทที่ 1" }, manuscriptBody: { value: "ต้นฉบับล่าสุด" },
  projectMemory: { value: "" }, saveState: { innerHTML: "" }
};
let localDraftCalls = 0;
let cloudSaveSchedules = 0;
const save = new Function(
  "keys", "$", "localStorage", "storageKeyFor", "getProjectGenre", "renderDashboard",
  "cloud", "storeLocalChapterDraft", "scheduleCloudSave",
  extractFunction("save") + "\\nreturn save;"
)(
  ["chapterTitle", "manuscriptBody"],
  id => elements[id],
  storageFailure,
  key => "sf_" + key,
  () => "แฟนตาซี",
  () => {},
  { authenticated: true, ready: true, activeProjectId: "project-1", activeChapterId: "chapter-1", revision: 2 },
  () => { localDraftCalls++; return false; },
  () => { cloudSaveSchedules++; }
);
save("manuscriptBody");
assert.equal(localDraftCalls, 1, "local recovery draft is attempted");
assert.equal(cloudSaveSchedules, 1, "Cloud autosave is still scheduled after local storage fails");
assert.match(elements.saveState.innerHTML, /พื้นที่จัดเก็บในอุปกรณ์ไม่พร้อมใช้งาน/);
console.log("Editor recovery tests passed: quota errors are contained and Cloud autosave continues.");
