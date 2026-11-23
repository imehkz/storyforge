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
  chapterSynopsis: { value: "" }, chapterStatus: { value: "draft" }, chapterCharacters: { selectedOptions: [] },
  projectMemory: { value: "" }, saveState: { innerHTML: "" }
};
let localDraftCalls = 0;
let cloudSaveSchedules = 0;
const save = new Function(
  "keys", "$", "localStorage", "storageKeyFor", "getProjectGenre", "renderDashboard",
  "cloud", "activeChapterDraft", "storeLocalChapterDraft", "scheduleCloudSave",
  extractFunction("save") + "\nreturn save;"
)(
  ["chapterTitle", "manuscriptBody"],
  id => elements[id],
  storageFailure,
  key => "sf_" + key,
  () => "แฟนตาซี",
  () => {},
  { authenticated: true, ready: true, activeProjectId: "project-1", activeChapterId: "chapter-1", revision: 2 },
  () => ({ title: elements.chapterTitle.value, body: elements.manuscriptBody.value, synopsis: "", writing_status: "draft", character_ids_json: "[]" }),
  () => { localDraftCalls++; return false; },
  () => { cloudSaveSchedules++; }
);
save("manuscriptBody");
assert.equal(localDraftCalls, 1, "local recovery draft is attempted");
assert.equal(cloudSaveSchedules, 1, "Cloud autosave is still scheduled after local storage fails");
assert.match(elements.saveState.innerHTML, /พื้นที่จัดเก็บในอุปกรณ์ไม่พร้อมใช้งาน/);
console.log("Editor recovery tests passed: quota errors are contained and Cloud autosave continues.");

const backupValidator = new Function(
  "UUID_RE", "countWords",
  extractFunction("validateCloudBackupData") + "\nreturn validateCloudBackupData;"
)(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, () => 0);
const validPlotBackup = [{
  project: { id: "11111111-1111-4111-8111-111111111111", title: "Plot test", pen_name: "Pen", copyright_text: "Copyright", foreword: "Foreword", author_bio: "Bio" },
  chapters: [{ id: "22222222-2222-4222-8222-222222222222", title: "บท 1", body: "", synopsis: "สรุปบทแรก", writing_status: "planned", sort_order: 0 }],
  modules: {
    characters: [], relationships: [],
    "plot-threads": [{ id: "33333333-3333-4333-8333-333333333333", title: "Main", chapter_ids_json: '["22222222-2222-4222-8222-222222222222"]' }],
    "world-lore": [], timeline: [], notes: [{ id: "55555555-5555-4555-8555-555555555555", title: "ฉากเปิด", note_type: "scene", scene_type: "setup", scene_status: "planned", chapter_ids_json: '["22222222-2222-4222-8222-222222222222"]' }]
  }
}];
assert.equal(backupValidator(validPlotBackup), true, "plot chapter references in a backup are accepted");
assert.throws(() => backupValidator([{
  ...validPlotBackup[0],
  modules: { ...validPlotBackup[0].modules, "plot-threads": [{ ...validPlotBackup[0].modules["plot-threads"][0], chapter_ids_json: '["44444444-4444-4444-8444-444444444444"]' }] }
}]), /เส้นเรื่องอ้างถึงบทที่ไม่มีอยู่ในโครงการเดียวกัน/);
assert.throws(() => backupValidator([{
  ...validPlotBackup[0],
  chapters: [{ ...validPlotBackup[0].chapters[0], writing_status: "broken" }]
}]), /ข้อมูลบทนิยายใน Backup ไม่ถูกต้อง/);

console.log("Plot backup validation tests passed: chapter references must resolve within the same project.");

const restoreSource = extractFunction("restoreCloudBackup");
const makeRestore = (projectCreated, calls, failSecondChapter = true) => new Function(
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
      if (failSecondChapter && chapterCreates === 2) throw new Error("simulated chapter failure");
      return { created: true };
    }
    if (["/plot-threads", "/notes", "/world-lore", "/timeline"].some(part => path.includes(part)) && options.method === "POST") return { created: true };
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
    relationships: [], "plot-threads": [{ id: "55555555-5555-4555-8555-555555555555", title: "Main", chapter_ids_json: '["22222222-2222-4222-8222-222222222222"]' }], "world-lore": [], timeline: [],
    notes: [{ id: "66666666-6666-4666-8666-666666666666", title: "ฉากเปิด", note_type: "scene", scene_type: "setup", scene_status: "planned", chapter_ids_json: '["22222222-2222-4222-8222-222222222222"]' }],
    "world-lore": [{ id: "77777777-7777-4777-8777-777777777777", title: "หอคอย", chapter_ids_json: '["22222222-2222-4222-8222-222222222222"]' }],
    timeline: [{ id: "88888888-8888-4888-8888-888888888888", title: "การพบกัน", chapter_ids_json: '["22222222-2222-4222-8222-222222222222"]' }] }
};
const successCalls = [];
await makeRestore(true, successCalls, false)([restoreProject]);
const lastChapterCreate = successCalls.reduce((last, call, index) =>
  call.path.endsWith("/chapters") && call.method === "POST" ? index : last, -1);
const plotLinkPatch = successCalls.findIndex(call =>
  call.path.endsWith("/plot-threads/55555555-5555-4555-8555-555555555555") && call.method === "PATCH");
assert.ok(plotLinkPatch > lastChapterCreate, "plot-to-chapter links are restored only after chapters exist");
const sceneLinkPatch = successCalls.findIndex(call =>
  call.path.endsWith("/notes/66666666-6666-4666-8666-666666666666") && call.method === "PATCH");
assert.ok(sceneLinkPatch > lastChapterCreate, "scene-to-chapter links are restored only after chapters exist");
const worldLinkPatch = successCalls.findIndex(call => call.path.endsWith("/world-lore/77777777-7777-4777-8777-777777777777") && call.method === "PATCH");
const timelineLinkPatch = successCalls.findIndex(call => call.path.endsWith("/timeline/88888888-8888-4888-8888-888888888888") && call.method === "PATCH");
assert.ok(worldLinkPatch > lastChapterCreate, "world canon chapter links are restored only after chapters exist");
assert.ok(timelineLinkPatch > lastChapterCreate, "timeline chapter links are restored only after chapters exist");
console.log("Cloud restore plot-link ordering tests passed.");
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
