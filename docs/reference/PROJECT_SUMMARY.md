# 📦 ROV Overlay Tool - สรุปโปรเจค

## ✅ สิ่งที่สร้างเสร็จแล้ว

### 1. โครงสร้างโปรเจคครบถ้วน
- ✅ Server (Node.js + Express + Socket.IO)
- ✅ Control Panel (HTML + CSS + JavaScript)
- ✅ Overlay สำหรับ OBS (HTML + CSS + JavaScript)
- ✅ ระบบ Real-time Communication ด้วย WebSocket
- ✅ ข้อมูลฮีโร่ ROV ครบทั้ง 125 ตัว

### 2. Features ครบตามที่ขอ
- ✅ Draft Pick แสดง 5 ฮีโร่ต่อทีม
- ✅ Ban Phase แสดง 4 Ban ต่อทีม
- ✅ ขนาดช่องรูปฮีโร่ 240x390 พิกเซล
- ✅ ปรับแต่งชื่อทีม, สกอร์, ชื่อผู้เล่น
- ✅ Timer แบบ Custom
- ✅ Design คล้ายกับรูป MLBB ที่แนบมา

### 3. ไฟล์เอกสารประกอบ
- ✅ README.md - คู่มือหลัก
- ✅ QUICKSTART.md - เริ่มต้นใช้งานด่วน
- ✅ USAGE.md - คู่มือการใช้งานขั้นสูง
- ✅ .gitignore - สำหรับ Git
- ✅ check-heroes.js - สคริปต์ตรวจสอบรูปฮีโร่

## 📂 โครงสร้างไฟล์

```
rov-overlay-tool/
├── server.js                 # Express + Socket.IO Server
├── package.json             # Dependencies และ Scripts
├── check-heroes.js          # สคริปต์ตรวจสอบรูป
├── README.md                # คู่มือหลัก
├── QUICKSTART.md            # เริ่มต้นด่วน
├── USAGE.md                 # คู่มือขั้นสูง
├── .gitignore              # Git ignore rules
│
├── data/
│   └── heroes.json          # รายชื่อฮีโร่ทั้งหมด (125 ตัว)
│
└── public/
    ├── control.html         # หน้า Control Panel
    ├── overlay.html         # หน้า Overlay
    │
    ├── css/
    │   ├── theme.css        # Design tokens (operator pages)
    │   └── overlay.css      # Styles Overlay
    │
    ├── js/
    │   ├── control.js       # Logic Control Panel
    │   └── overlay.js       # Logic Overlay
    │
    └── images/
        └── heroes/          # โฟลเดอร์รูปฮีโร่ (ต้องเตรียมเอง)
```

## 🚀 วิธีใช้งาน

### ขั้นตอนที่ 1: แตกไฟล์
```bash
unzip rov-overlay-tool.zip
cd rov-overlay-tool
```

### ขั้นตอนที่ 2: ติดตั้ง Dependencies
```bash
npm install
```

### ขั้นตอนที่ 3: เตรียมรูปฮีโร่
วางรูปฮีโร่ (240x390 pixels) ในโฟลเดอร์:
```
public/images/heroes/
```

ชื่อไฟล์ต้องเป็น**ตัวเล็กทั้งหมด** เช่น:
- airi.png
- nakroth.png
- tel'annas.png (ระวังตัวพิเศษ)

### ขั้นตอนที่ 4: ตรวจสอบรูป
```bash
npm run check-heroes
```

### ขั้นตอนที่ 5: รัน Server
```bash
npm start
```

### ขั้นตอนที่ 6: เปิดใช้งาน
- Control Panel: http://localhost:3000
- Overlay: http://localhost:3000/overlay

## 🎯 การใช้งานกับ OBS

1. เปิด OBS Studio
2. เพิ่ม Browser Source
3. URL: `http://localhost:3000/overlay`
4. Width: 1920, Height: 1080
5. Done!

## 📋 รายชื่อฮีโร่ทั้งหมด

รองรับฮีโร่ 125 ตัว:
- Airi, Aleister, Alice, Allain, Amily, Annette, Aoi, Arduin, Arum, Astrid
- Ata, Aya, Azzen'Ka, Baldum, Bijan, Billow, Biron, Bolt Baron, Bonnie, Bright
- Butterfly, Capheny, Celica, Charlotte, Chaugnar, Cresht, D'Arcy, Dextra, Diaochan, Dirak
- และอื่นๆ อีกมากมาย... (ดูรายการเต็มใน data/heroes.json)

## ⚠️ สิ่งที่ต้องเตรียมเอง

### 1. รูปฮีโร่ (สำคัญมาก!)
- ต้องเตรียมรูปฮีโร่ด้วยตัวเอง
- ขนาดแนะนำ: 240x390 pixels
- ไฟล์: PNG
- **ชื่อไฟล์: ตัวเล็กทั้งหมด (lowercase)**
- จำนวน: 125 รูป (หรือเท่าที่จะใช้)

### 2. Node.js
- ต้องติดตั้ง Node.js เวอร์ชัน 14 ขึ้นไป
- ดาวน์โหลดที่: https://nodejs.org/

## 💡 Tips สำหรับรูปฮีโร่

### ที่หารูปได้:
1. Official ROV Website
2. ROV Wiki
3. Fan Art Sites (ต้องขออนุญาตผู้สร้าง)
4. Screenshot จากเกม

### การเตรียมรูป:
1. ใช้ Photoshop/GIMP ปรับขนาด
2. ตัดพื้นหลังออก (ถ้าต้องการ)
3. Save เป็น PNG
4. ตั้งชื่อให้ตรงกับระบบ

### Tool แนะนำ:
- Photoshop
- GIMP (ฟรี)
- Paint.NET (Windows, ฟรี)
- Preview (Mac)

## 🔧 คำสั่งที่ใช้บ่อย

```bash
npm start              # รัน Server
npm run dev           # รัน Development mode (Auto-restart)
npm run check-heroes  # ตรวจสอบรูปฮีโร่
```

## 📚 เอกสารเพิ่มเติม

- **README.md** - คู่มือหลักฉบับเต็ม
- **QUICKSTART.md** - เริ่มต้นใช้งานภายใน 5 นาที
- **USAGE.md** - การใช้งานขั้นสูงและ Customization

## 🆘 ช่วยเหลือ

### หากมีปัญหา:
1. อ่าน QUICKSTART.md ก่อน
2. ตรวจสอบ Console Log (F12)
3. ดู Server Log ใน Terminal
4. เช็ค Troubleshooting ใน README.md

### ปัญหาที่พบบ่อย:

**Q: รูปฮีโร่ไม่แสดง**
A: ตรวจสอบชื่อไฟล์ให้ตรงกับระบบทุกตัวอักษร (Case-sensitive)

**Q: Overlay ไม่อัพเดท**
A: กด F5 Refresh หรือ Restart Server

**Q: Port 3000 ถูกใช้งาน**
A: เปลี่ยน Port ในไฟล์ server.js

## 🎨 Customization

สามารถปรับแต่งได้ทุกส่วน:
- สี Theme
- ขนาดตัวอักษร
- Animation
- Layout

ดูวิธีใน USAGE.md

## 📝 License

MIT License - ใช้งานได้ฟรี

## 🙏 Credits

- สร้างโดย: ROV Community
- ใช้เทคโนโลยี: Node.js, Express, Socket.IO
- Inspired by: MLBB Draft Pick Overlay

---

## ✨ สิ่งที่ยอดเยี่ยม

✅ **โครงสร้างครบ** - ใช้โครงสร้างจาก MLBB overlay
✅ **125 ฮีโร่** - รองรับฮีโร่ครบทุกตัว
✅ **240x390** - ขนาดช่องตามที่ระบุ
✅ **Real-time** - อัพเดทแบบ Instant
✅ **Easy Control** - ใช้งาน Control Panel ง่าย
✅ **Professional** - ดีไซน์เหมือนงานจริง

## 🚀 พร้อมใช้งาน!

โปรเจคพร้อมใช้งานทันที เพียงแต่:
1. ติดตั้ง Node.js
2. ติดตั้ง npm packages
3. เตรียมรูปฮีโร่
4. รัน Server
5. Enjoy! 🎮

---

**หากมีคำถามเพิ่มเติม กรุณาอ่านเอกสารประกอบ**

**Good luck with your ROV tournament! 🏆**
