const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "public");
const MIME = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8",".json":"application/json; charset=utf-8",".svg":"image/svg+xml"};

function send(res, status, body, type="application/json; charset=utf-8") {
  res.writeHead(status, {"Content-Type":type, "X-Content-Type-Options":"nosniff"});
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
const server = http.createServer(async (req,res) => {
  if (req.method === "POST" && req.url === "/api/agent") {
    let raw = "";
    req.on("data", chunk => { raw += chunk; if (raw.length > 1e6) req.destroy(); });
    req.on("end", async () => {
      try {
        const {prompt, mode="writer", context=""} = JSON.parse(raw || "{}");
        if (!process.env.OPENAI_API_KEY) return send(res, 503, {error:"ยังไม่ได้ตั้งค่า OPENAI_API_KEY ใน Render"});
        if (!prompt || !String(prompt).trim()) return send(res, 400, {error:"กรุณาพิมพ์คำสั่งก่อน"});
        const instructions = {
          brainstorm:"คุณคือผู้ช่วยพัฒนาพล็อตนิยาย ช่วยคิดไอเดียอย่างสร้างสรรค์ เป็นระบบ และถามกลับเมื่อข้อมูลไม่พอ",
          writer:"คุณคือนักเขียนนิยายมืออาชีพ เขียนภาษาไทยลื่นไหล มีฉาก อารมณ์ บทสนทนา และความต่อเนื่อง",
          editor:"คุณคือบรรณาธิการนิยาย ตรวจภาษา จังหวะเรื่อง ความสมเหตุสมผล และเสนอวิธีแก้โดยรักษาเสียงของผู้เขียน",
          publisher:"คุณคือผู้เชี่ยวชาญการจัดทำต้นฉบับ ช่วยทำคำโปรย เรื่องย่อ ชื่อเรื่อง และข้อมูลประกอบการเผยแพร่"
        };
        const response = await fetch("https://api.openai.com/v1/responses", {
          method:"POST",
          headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
          body:JSON.stringify({
            model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
            instructions: instructions[mode] || instructions.writer,
            input: `บริบทโครงการ:\n${context}\n\nคำสั่ง:\n${prompt}`
          })
        });
        const data = await response.json();
        if (!response.ok) return send(res, response.status, {error:data.error?.message || "เรียกใช้ AI ไม่สำเร็จ"});
        fs.readFile(target, (err, data) => {
    return;
  }
  const pathname = decodeURIComponent((req.url || "/").split("?")[0]);
  const target = path.join(ROOT, pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
  if (!target.startsWith(ROOT)) return send(res, 403, "Forbidden", "text/plain");
  fs.readFile(target, (err, data) => {
    if (err) return send(res, 404, "Not found", "text/plain");
    send(res, 200, data, MIME[path.extname(target)] || "application/octet-stream");
  });
});
server.listen(PORT, () => console.log(`STORYFORGE running on ${PORT}`));
