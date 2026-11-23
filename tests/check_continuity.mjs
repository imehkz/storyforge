import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const start = app.indexOf("function analyzeStoryContinuity(");
const end = app.indexOf("function renderContinuityResults(", start);
assert.ok(start >= 0 && end > start, "continuity analyzer must exist");
const analyze = new Function(app.slice(start, end) + "\nreturn analyzeStoryContinuity;")();

const characters = [
  { id: "c1", name: "Mira", profile_json: JSON.stringify({ nickname: "Mi", aliases: "เจ้าหญิงเงา, Mira of Dawn" }) },
  { id: "c2", name: "Tao", profile_json: "{}" }
];
const findings = analyze({
  characters,
  chapters: [
    { id: "ch1", title: "บทแรก", body: "เจ้าหญิงเงาเดินเข้าปราสาท", character_ids_json: '["c1"]' },
    { id: "ch2", title: "บทแรก", body: "Tao พบกับ Mira ที่ประตู", character_ids_json: "[]" },
    { id: "ch3", title: "บทสาม", body: "ฝนตกหนัก", character_ids_json: '["c1"]' },
    { id: "ch4", title: "บทสี่", body: "เจ้าหญิงเงาปรากฏตัว", character_ids_json: "[]" }
  ],
  timeline: [
    { title: "เหตุการณ์หลัง", story_time: "2026-12-02", sort_order: 1, character_ids_json: '["c2"]' },
    { title: "เหตุการณ์ก่อน", story_time: "2026-11-01", sort_order: 2 }
  ],
  plotThreads: [
    { title: "เส้นเรื่องของ Tao", status: "in_progress", character_ids_json: '["c2"]' }
  ]
});

assert.ok(findings.some(item => item.title === "ชื่อบทซ้ำ" && item.chapterId === "ch2"));
assert.ok(findings.some(item => item.title === "ตรวจ Canon ตัวละคร" && item.chapterId === "ch2"));
assert.ok(findings.some(item => item.title === "ตรวจการปรากฏของตัวละคร" && item.chapterId === "ch3"));
assert.ok(findings.some(item => item.title === "ตรวจ Canon ตัวละคร" && item.chapterId === "ch4" && item.detail.includes("เจ้าหญิงเงา")));
assert.ok(findings.some(item => item.title === "เหตุการณ์ Timeline ยังไม่เชื่อมกับบท"));
assert.ok(findings.some(item => item.title === "ลำดับ Timeline อาจไม่ตรงวันที่"));
assert.ok(findings.some(item => item.title === "เส้นเรื่องยังไม่เชื่อมกับบท"));
assert.ok(!findings.some(item => item.title === "ตรวจการปรากฏของตัวละคร" && item.chapterId === "ch1"));
assert.ok(!findings.some(item => item.title === "ตรวจ Canon ตัวละคร" && item.chapterId === "ch1"), "aliases should count as a character mention");
console.log("Continuity checker tests passed");
