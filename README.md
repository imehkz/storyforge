# STORYFORGE — AI NOVEL STUDIO

STORYFORGE เป็นพื้นที่ทำงานสำหรับวางแผน เขียน และจัดการนิยายหลายเรื่อง โดยออกแบบตามแนว Dark Fantasy Literature / Ancient Royal Library และใช้ภาษาไทยเป็นหลัก

## สถานะโปรเจกต์

- โค้ดพัฒนาหลักอยู่บนสาขา `feature/storyforge-studio-80`
- Pull Request #1 ยังเป็น Draft และยังไม่รวมเข้า `main`
- Frontend รองรับ Novel Projects, Manuscript Studio, Chapter autosave/revisions, local recovery, story modules, continuity checks, illustration library และ export flows ตามขอบเขตที่ระบุในเอกสาร
- Cloudflare Worker/D1 ที่มีอยู่เป็นระบบเดิม ไม่ใช่ staging สำหรับโค้ดสาขานี้
- GitHub Actions ตรวจ syntax, export/recovery/continuity/editor contracts, D1 schema และ Worker security contracts
- การผ่าน CI ไม่ใช่หลักฐานว่าผ่านการทดสอบบน Browser, Android tablet, live Worker/D1 หรือการกู้คืน Backup จริง

## ข้อจำกัดที่ต้องทราบ

- ห้าม Deploy สาขาพัฒนาไปยัง Worker จริง หรือรวมเข้า `main` โดยไม่มีการอนุมัติชัดเจน
- ห้ามใช้ D1 จริงสำหรับทดสอบ Migration; ต้องสร้าง staging Worker และ staging D1 แยกก่อน
- Migration ของสาขาพัฒนาต้องนำไปรันกับ staging เท่านั้น หลังตรวจสอบ Backup และแผน Rollback
- AI text/image generation ยังปิดอยู่ การเชื่อม OpenAI API ต้องได้รับอนุมัติเรื่องค่าใช้จ่ายและความเป็นส่วนตัวก่อน และต้องเก็บ API key เป็น Worker secret เท่านั้น
- Character Reference Vault และ Illustration Library เป็นข้อมูลเฉพาะอุปกรณ์ในปัจจุบัน ควรทำ Backup ก่อนเปลี่ยนอุปกรณ์หรือ Browser

## เอกสารสำหรับพัฒนาและตรวจรับ

- `docs/IMPLEMENTATION_PLAN.md` — สถานะและแผนพัฒนา
- `docs/ROADMAP_NEXT_20.md` — ลำดับงานและผลการดำเนินงาน
- `docs/PRIVATE_BETA_QA_GATE.md` — เกณฑ์ตรวจรับก่อน Private Beta
- `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md` — การเตรียม Cloudflare
- `docs/CLOUDFLARE_WORKER_API.md` — API และ Authentication contract
- `docs/SECURITY_AND_STORAGE_DECISIONS.md` — ข้อกำหนดความปลอดภัยและการจัดเก็บข้อมูล

## ตรวจสอบโค้ด

ต้องใช้ Node.js 22+ และ Python 3.12+ ตาม GitHub Actions workflow

คำสั่งตรวจสอบหลัก:

```bash
node --input-type=module --check < cloudflare/worker.js
node --check public/app.js
node tests/check_exports.mjs
node tests/check_recovery.mjs
node tests/check_continuity.mjs
node tests/check_studio_editor.mjs
node tests/check_cloud_save_race.mjs
python3 tests/check_d1_schema.py
python3 tests/check_worker_contract.py
```

ดูผล CI ล่าสุดและสถานะ Pull Request ได้ที่:
https://github.com/imehkz/storyforge/pull/1

## การ Deploy

ยังไม่มีคำสั่ง Deploy สำหรับใช้งานจริงใน README นี้โดยตั้งใจ เพราะต้องสร้างและตรวจ staging environment, ทดสอบ end-to-end, ตรวจสอบ Backup/Restore และได้รับอนุมัติก่อนทุกครั้ง ดูขั้นตอนใน `docs/CLOUDFLARE_DEPLOYMENT_CHECKLIST.md` และ `docs/PRIVATE_BETA_QA_GATE.md` ก่อนดำเนินการ
