# STORYFORGE — AI NOVEL STUDIO

เว็บแอปช่วยวางแผนและเขียนนิยายด้วย AI

## Deploy บน Render
1. อัปโหลดไฟล์และโฟลเดอร์ทั้งหมดในโปรเจกต์นี้ไปยัง GitHub repository
2. เข้า Render แล้วเลือก New > Web Service เชื่อม GitHub repository
3. Runtime: Node, Build Command: เว้นว่าง, Start Command: `npm start`
4. เพิ่ม Environment Variable `OPENAI_API_KEY` แล้วใส่ API key ใน Render เท่านั้น
5. Deploy

## หมายเหตุ
- ต้องใช้ OpenAI API Key และมีค่าใช้จ่าย API แยกจาก ChatGPT
- ข้อมูลโครงการและต้นฉบับในเวอร์ชันนี้บันทึกในเบราว์เซอร์ของอุปกรณ์ผ่าน localStorage
- อย่าใส่ API Key ใน GitHub หรือในไฟล์หน้าเว็บ
