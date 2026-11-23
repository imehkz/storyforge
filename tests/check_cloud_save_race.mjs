import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const start = source.indexOf("async function saveCloudChapter()");
const end = source.indexOf("\nasync function createCloudChapter", start);
assert.ok(start >= 0 && end > start, "Cloud save handler must be available for race testing");
const saveSource = source.slice(start, end);

const elements = {
  saveState: { innerHTML: "" },
  chapterSaveHint: { textContent: "" },
  recoverLocalDraft: { hidden: false },
  chapterTitle: { value: "บทที่ 1" },
  manuscriptBody: { value: "ข้อความฉบับแรก" },
  chapterSynopsis: { value: "" },
  chapterStatus: { value: "draft" },
  chapterCharacters: { selectedOptions: [] }
};
let liveDraft = {
  title: "บทที่ 1",
  body: "ข้อความฉบับแรก",
  synopsis: "",
  writing_status: "draft",
  character_ids_json: "[]"
};
let resolveCloudSave;
let storedDrafts = 0;
let scheduledSaves = 0;
let submittedPayload;

const cloud = {
  activeChapterId: "chapter-1",
  revision: 1,
  chapters: [{
    id: "chapter-1",
    title: "บทที่ 1",
    body: "ข้อความก่อนหน้า",
    synopsis: "",
    writing_status: "draft",
    character_ids_json: "[]"
  }],
  saving: false,
  savePromise: null,
  saveTimer: null
};

const saveCloudChapter = new Function(
  "cloud", "$", "activeChapterDraft", "countWords", "cloudApi",
  "storeLocalChapterDraft", "renderChapterCharacterReferences",
  "renderChapterSelect", "scheduleCloudSave", "console",
  saveSource + "\nreturn saveCloudChapter;"
)(
  cloud,
  id => elements[id],
  () => ({ ...liveDraft }),
  () => 2,
  async (_path, options) => {
    submittedPayload = JSON.parse(options.body);
    return new Promise(resolve => { resolveCloudSave = resolve; });
  },
  () => { storedDrafts++; },
  () => {},
  () => {},
  () => { scheduledSaves++; },
  { error() {} }
);

const pending = saveCloudChapter();
assert.equal(cloud.saving, true, "the first save must enter the in-flight state");
assert.equal(submittedPayload.body, "ข้อความฉบับแรก", "the request must contain the original snapshot");

// Simulate the writer continuing to type while the network request is pending.
liveDraft = { ...liveDraft, body: "ข้อความที่พิมพ์เพิ่มระหว่างบันทึก" };
elements.manuscriptBody.value = liveDraft.body;

resolveCloudSave({
  chapter: {
    id: "chapter-1",
    title: "บทที่ 1",
    body: "ข้อความฉบับแรก",
    synopsis: "",
    writing_status: "draft",
    character_ids_json: "[]",
    revision: 2
  }
});
assert.equal(await pending, true);

assert.equal(storedDrafts, 0, "an older response must not replace the newer local recovery draft");
assert.equal(elements.recoverLocalDraft.hidden, false, "an older response must not hide the recovery affordance");
assert.match(elements.saveState.innerHTML, /มีการแก้ไขใหม่ · กำลังบันทึกต่อ/,
  "the UI must not claim the newer text has already been saved");
assert.match(elements.chapterSaveHint.textContent, /กำลังส่งข้อความที่แก้ไขล่าสุดขึ้น Cloud/);
assert.equal(scheduledSaves, 1, "the newer text must be queued for a follow-up Cloud save");
assert.equal(cloud.saving, false, "the in-flight save state must be released");
console.log("Cloud save race test passed: newer edits remain local and are queued after the older save completes.");
