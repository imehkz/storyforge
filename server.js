const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const MAX_BACKUP_BYTES = 35 * 1024 * 1024;
const MAX_REQUEST_BYTES = 40 * 1024 * 1024;

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff"
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let tooLarge = false;

    req.on("data", chunk => {
      total += chunk.length;

      if (total > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }

      if (!tooLarge) chunks.push(chunk);
    });

    req.on("end", () => {
      if (tooLarge) {
        reject(new Error("REQUEST_TOO_LARGE"));
        return;
      }

      resolve(Buffer.concat(chunks).toString("utf8"));
    });

    req.on("error", reject);
  });
}

function validSecret(received, expected) {
  if (!received || !expected) return false;

  const a = Buffer.from(received);
  const b = Buffer.from(expected);

  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

async function telegramBackup(req, res) {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const backupSecret = process.env.TELEGRAM_BACKUP_SECRET;

    if (!botToken || !chatId || !backupSecret) {
      return send(res, 503, {
        error: "กรุณาตรวจสอบการตั้งค่า Telegram ใน Render"
      });
    }

    const suppliedSecret = req.headers["x-backup-secret"];

    if (!validSecret(suppliedSecret, backupSecret)) {
      return send(res, 401, {
        error: "รหัสยืนยันไม่ถูกต้อง"
      });
    }

    const raw = await readBody(req, MAX_REQUEST_BYTES);
    let body;

    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return send(res, 400, {
        error: "รูปแบบข้อมูลไม่ถูกต้อง"
      });
    }

    if (typeof body.content !== "string" || !body.content.length) {
      return send(res, 400, {
        error: "ไม่พบข้อมูลสำรอง"
      });
    }

    const contentSize = Buffer.byteLength(body.content, "utf8");

    if (contentSize > MAX_BACKUP_BYTES) {
      return send(res, 413, {
        error: "ไฟล์สำรองมีขนาดใหญ่เกินกำหนด 35 MB"
      });
    }

    const filename = String(body.filename || "storyforge-backup.json")
      .replace(/[^a-zA-Z0-9ก-๙._-]/g, "_")
      .slice(0, 100);

    const form = new FormData();

    form.append("chat_id", chatId);
    form.append(
      "document",
      new Blob([body.content], {
        type: "application/json"
      }),
      filename
    );

    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${botToken}/sendDocument`,
      {
        method: "POST",
        body: form
      }
    );

    const result = await telegramResponse.json();

    if (!telegramResponse.ok || !result.ok) {
      console.error("Telegram backup failed:", result.description || "Unknown error");

      return send(res, 502, {
        error: "Telegram ไม่สามารถรับไฟล์สำรองได้"
      });
    }

    return send(res, 200, {
      success: true,
      message: "สำรองข้อมูลไปยัง Telegram สำเร็จ",
      message_id: result.result?.message_id
    });

  } catch (error) {
    if (error.message === "REQUEST_TOO_LARGE") {
      return send(res, 413, {
        error: "ข้อมูลที่ส่งมีขนาดใหญ่เกินกำหนด"
      });
    }

    console.error("Telegram backup error:", error.message);

    return send(res, 500, {
      error: "เกิดข้อผิดพลาดระหว่างสำรองข้อมูล"
    });
  }
}

const server = http.createServer((req, res) => {

  // Telegram Backup API
  if (
    req.method === "POST" &&
    req.url.split("?")[0] === "/api/telegram-backup"
  ) {
    return telegramBackup(req, res);
  }

  // Original AI API
  if (
    req.method === "POST" &&
    req.url === "/api/agent"
  ) {
    let raw = "";

    req.on("data", chunk => {
      raw += chunk;

      if (raw.length > 1e6) {
        req.destroy();
      }
    });

    req.on("end", async () => {
      try {
        const { prompt, mode = "writer", context = "" } =
          JSON.parse(raw || "{}");

        if (!process.env.OPENAI_API_KEY) {
          return send(res, 503, {
            error: "ยังไม่ได้ตั้งค่า OPENAI_API_KEY ใน Render"
          });
        }

        if (!prompt || !String(prompt).trim()) {
          return send(res, 400, {
            error: "กรุณาพิมพ์คำสั่งก่อน"
          });
        }

        const instructions = {
          brainstorm: "คุณคือผู้ช่วยพัฒนาพล็อตนิยาย ช่วยคิดไอเดียอย่างสร้างสรรค์ เป็นระบบ และถามกลับเมื่อข้อมูลไม่พอ",

          writer: "คุณคือนักเขียนนิยายมืออาชีพ เขียนภาษาไทยลื่นไหล มีฉาก อารมณ์ บทสนทนา และความต่อเนื่อง",

          editor: "คุณคือบรรณาธิการนิยาย ตรวจภาษา จังหวะเรื่อง ความสมเหตุสมผล และเสนอวิธีแก้โดยรักษาเสียงของผู้เขียน",

          publisher: "คุณคือผู้เชี่ยวชาญการจัดทำต้นฉบับ ช่วยทำคำโปรย เรื่องย่อ ชื่อเรื่อง และข้อมูลประกอบการเผยแพร่"
        };

        const response = await fetch(
          "https://api.openai.com/v1/responses",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
              instructions: instructions[mode] || instructions.writer,
              input: `บริบทโครงการ:\n${context}\n\nคำสั่ง:\n${prompt}`
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          return send(res, response.status, {
            error: data.error?.message || "เรียกใช้ AI ไม่สำเร็จ"
          });
        }

        const output = (data.output || [])
          .flatMap(x => x.content || [])
          .filter(x => x.type === "output_text")
          .map(x => x.text)
          .join("\n");

        send(res, 200, {
          text: output || "AI ไม่ได้ส่งข้อความกลับมา"
        });

      } catch (e) {
        send(res, 500, {
          error: "เกิดข้อผิดพลาด: " + e.message
        });
      }
    });

    return;
  }

  // Original website file server
  const pathname = decodeURIComponent(
    (req.url || "/").split("?")[0]
  );

  const target = path.join(
    ROOT,
    pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
  );

  if (
    !target.startsWith(ROOT + path.sep) &&
    target !== path.join(ROOT, "index.html")
  ) {
    return send(res, 403, "Forbidden", "text/plain");
  }

  fs.readFile(target, (err, data) => {
    if (err) {
      return send(res, 404, "Not found", "text/plain");
    }

    res.writeHead(200, {
      "Content-Type": MIME[path.extname(target)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });

    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`STORYFORGE running on ${PORT}`);
});
