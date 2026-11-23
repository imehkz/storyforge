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
const draftStore = new Function("$", "localStorage", "console", extractFunction("storeLocalChapterDraft") + "\nreturn storeLocalChapterDraft;")(
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
  extractFunction("save") + "\nreturn save;"
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

const restoreSource = extractFunction("restoreCloudBackup");
const makeRestore = (projectCreated, calls) => new Function(
  "validateCloudBackupData", "cloud", "cloudApi", "countWords",
  restoreSource.replace(/^function /, "async function ") + "\nreturn restoreCloudBackup;"
)(
  () => true,
  { authenticated: true, ready: true },
  async (path, options = {}) => {
    calls.push({ path, method: options.method || "GET" });
    if (path === "/api/projects" && options.method === "POST") {
      return { created: projectCreated, project: { status: "active" } };
    }
    if (path.endsWith("/chapters") && options.method === "POST") {
      const chapterCreates = calls.filter(call => call.path.endsWith("/chapters") && call.method === "POST").length;
      if (chapterCreates === 2) throw new Error("simulated chapter failure");
      return { created: true };
    }
    return { ok: true };
  },
  () => 0
);
const restoreProject = {
  project: { id: "11111111-1111-4111-8111-111111111111", title: "ทดสอบ", status: "active" },
  chapters: [
    { id: "22222222-2222-4222-8222-222222222222", title: "บท 1", body: "", sort_order: 0, word_count: 0 },
    { id: "44444444-4444-4444-8444-444444444444", title: "บท 2", body: "", sort_order: 1, word_count: 0 }
  ],
  modules: { characters: [{ id: "33333333-3333-4333-8333-333333333333", name: "ตัวละคร" }],
    relationships: [], "plot-threads": [], "world-lore": [], timeline: [], notes: [] }
};
const newProjectCalls = [];
await assert.rejects(() => makeRestore(true, newProjectCalls)([restoreProject]), /simulated chapter failure/);
assert.ok(newProjectCalls.some(call => call.path === "/api/projects/11111111-1111-4111-8111-111111111111" && call.method === "DELETE"),
  "new project is removed after failed restore");
assert.ok(!newProjectCalls.some(call => call.path === "/api/chapters/22222222-2222-4222-8222-222222222222"),
  "children of a newly created project are left to project cascade cleanup");

const existingProjectCalls = [];
await assert.rejects(() => makeRestore(false, existingProjectCalls)([restoreProject]), /simulated chapter failure/);
assert.ok(existingProjectCalls.some(call => call.path === "/api/chapters/22222222-2222-4222-8222-222222222222" && call.method === "DELETE"),
  "new chapter is removed from an existing project after failed restore");
assert.ok(!existingProjectCalls.some(call => call.path === "/api/projects/11111111-1111-4111-8111-111111111111" && call.method === "DELETE"),
  "existing project is never deleted during rollback");
console.log("Cloud restore rollback tests passed: newly created data is rolled back without deleting existing projects.");
