import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const stylesheet = await readFile(new URL("../public/style.css", import.meta.url), "utf8");

function extractFunction(name) {
  const expression = new RegExp("function " + name + "\\([\\s\\S]*?\\n\\}");
  const match = source.match(expression);
  assert.ok(match, "Missing function " + name);
  return match[0];
}

function readStoredZip(buffer) {
  const endOffset = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(endOffset), 0x06054b50, "ZIP end record");
  const count = buffer.readUInt16LE(endOffset + 10);
  let cursor = buffer.readUInt32LE(endOffset + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50, "central directory header");
    const method = buffer.readUInt16LE(cursor + 10);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    assert.equal(method, 0, "files are stored without compression");
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, "local file header");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataOffset, dataOffset + size);
    assert.equal(crc32(data), buffer.readUInt32LE(cursor + 16), "CRC32 for " + name);
    files.set(name, data.toString("utf8"));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const names = [
  "xmlEscape", "crc32", "createStoredZip", "exportBaseName",
  "wordParagraph", "countWords", "getManuscriptText", "manuscriptHtmlToWord", "exportManuscriptDocx", "exportManuscriptEpub"
];
const code = names.map(extractFunction).join("\n");
const values = {
  title: { value: "ห้องสมุดแห่งความทรงจำ" },
  chapterTitle: { value: "บทที่ 1 — ประตูแรก" },
  manuscriptBody: { value: "บรรทัดแรก\nบททดสอบ & <tag>" },
  manuscriptEditor: { innerText: "บรรทัดแรก\nบททดสอบ & <tag>" }
};
const $ = id => values[id];
const downloads = [];
const downloadBlob = (filename, blob) => downloads.push({ filename, blob });
const mockCrypto = { randomUUID: () => "11111111-1111-4111-8111-111111111111" };
const countWords = new Function(extractFunction("countWords") + "\nreturn countWords;")();
assert.equal(countWords(""), 0);
assert.equal(countWords("ห้องสมุดแห่งความทรงจำ"), 6, "Thai word segmentation");
const exportsApi = new Function("$", "downloadBlob", "crypto", code +
  "\nreturn { exportManuscriptDocx, exportManuscriptEpub };")($, downloadBlob, mockCrypto);

exportsApi.exportManuscriptDocx();
const docx = downloads.pop();
assert.ok(docx.filename.endsWith(".docx"));
const docxFiles = readStoredZip(Buffer.from(await docx.blob.arrayBuffer()));
assert.ok(docxFiles.has("[Content_Types].xml"));
assert.ok(docxFiles.has("word/document.xml"));
assert.ok(docxFiles.has("word/styles.xml"));
assert.ok(docxFiles.get("word/document.xml").includes("ห้องสมุดแห่งความทรงจำ"));
assert.ok(docxFiles.get("word/document.xml").includes("&amp; &lt;tag&gt;"));

exportsApi.exportManuscriptEpub();
const epub = downloads.pop();
assert.ok(epub.filename.endsWith(".epub"));
const epubBuffer = Buffer.from(await epub.blob.arrayBuffer());
const firstNameLength = epubBuffer.readUInt16LE(26);
const firstName = epubBuffer.toString("utf8", 30, 30 + firstNameLength);
assert.equal(firstName, "mimetype", "EPUB mimetype must be first");
const epubFiles = readStoredZip(epubBuffer);
assert.equal(epubFiles.get("mimetype"), "application/epub+zip");
assert.ok(epubFiles.has("META-INF/container.xml"));
assert.ok(epubFiles.has("OEBPS/content.opf"));
assert.ok(epubFiles.get("OEBPS/chapter.xhtml").includes("บททดสอบ &amp; &lt;tag&gt;"));

assert.ok(source.includes("function exportManuscriptPdf"));
assert.ok(source.includes("window.print()"));
assert.ok(stylesheet.includes("@page { size: A4"));
assert.ok(stylesheet.includes("#printManuscriptText"));

console.log("Export smoke tests passed: DOCX and EPUB ZIP packages are valid; A4 print-to-PDF flow is wired.");

assert.ok(source.includes("async function collectCloudBackup()"), "Cloud backup collector is implemented");
assert.ok(source.includes("cloudApi(\"/api/projects/\" + encodeURIComponent(project.id) + \"/chapters\")"), "Backup includes project chapters");
assert.ok(source.includes('["characters", "relationships", "plot-threads", "world-lore", "timeline", "notes"]'), "Backup includes project studio modules");
assert.ok(source.includes("snapshotHistory: false"), "Backup explicitly discloses that snapshot history is not included");
assert.ok(source.includes("async function restoreCloudBackup(backupProjects)"), "Cloud backup restore is implemented");
assert.ok(source.includes("clientId: chapter.id"), "Cloud restore preserves stable chapter IDs");
assert.ok(source.includes("version: 3"), "New backup format is versioned");
assert.ok(source.includes("async function collectCharacterVaultBackup(cloudProjects)"), "Character references are included in backup");
assert.ok(source.includes("async function restoreCharacterVaultRecords(records)"), "Character references can be restored");
assert.ok(source.includes("function validateCharacterVaultBackup(records, cloudProjects)"), "Character reference restore is validated");
assert.ok(source.includes('field === "pinned" ? Boolean(item[field]) : item[field]'), "Cloud restore normalizes SQLite booleans");
assert.ok(source.includes('if (project.status === "archived")'), "Cloud restore preserves archived project state");

assert.ok(source.includes("ถึงขีดจำกัดที่ API ส่งกลับ"), "Backup refuses collections at API result caps instead of silently omitting records");
assert.ok(source.includes("validateCloudBackupData(cloudProjects)"), "Cloud restore is preflight-validated before confirmation and writes");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validateCloudBackupData = new Function("UUID_RE", "countWords", extractFunction("validateCloudBackupData") +
  "\nreturn validateCloudBackupData;")(UUID_RE, countWords);
const projectId = "11111111-1111-4111-8111-111111111111";
const characterId = "22222222-2222-4222-8222-222222222222";
const chapterId = "33333333-3333-4333-8333-333333333333";
const validCloudBackup = [{
  project: { id: projectId, title: "ทดสอบ", genre: "แฟนตาซี", synopsis: "", status: "active" },
  chapters: [{ id: chapterId, title: "บทที่ 1", body: "ทดสอบ", sort_order: 0, word_count: 1 }],
  modules: {
    characters: [{ id: characterId, name: "ตัวละคร", role: "", profile_json: "{}", sort_order: 0 }],
    relationships: [], "plot-threads": [], "world-lore": [], timeline: [], notes: []
  }
}];
assert.equal(validateCloudBackupData(validCloudBackup), true, "valid cloud backup passes preflight");
const expectInvalidBackup = (mutate, message) => {
  const copy = JSON.parse(JSON.stringify(validCloudBackup));
  mutate(copy);
  assert.throws(() => validateCloudBackupData(copy), message);
};
expectInvalidBackup(copy => copy.push(JSON.parse(JSON.stringify(copy[0]))), /รหัสโครงการซ้ำ/);
expectInvalidBackup(copy => { copy[0].chapters[0].body = 123; }, /ข้อมูลบทนิยาย/);
expectInvalidBackup(copy => { delete copy[0].modules.notes; }, /โครงสร้างโครงการ/);
expectInvalidBackup(copy => { copy[0].chapters[0].word_count = 99; }, /ข้อมูลบทนิยาย/);
expectInvalidBackup(copy => {
  copy[0].modules.relationships.push({
    id: "44444444-4444-4444-8444-444444444444",
    source_character_id: characterId,
    target_character_id: "55555555-5555-4555-8555-555555555555"
  });
}, /ไม่มีอยู่ในโครงการเดียวกัน/);
console.log("Cloud backup preflight tests passed: valid archive accepted; duplicate IDs, invalid chapter data, and dangling relationships rejected.");
