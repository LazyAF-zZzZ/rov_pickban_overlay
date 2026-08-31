# ROV Overlay Tool — User Guide / คู่มือการใช้งาน

This same guide is inside the app: open it from **GUIDE** in the top bar, or go to
`http://127.0.0.1:3000/guide` — that copy has a language switch and works offline.
คู่มือชุดเดียวกันนี้อยู่ในโปรแกรมด้วย กดที่ **GUIDE** บนแถบด้านบน หรือเปิด
`http://127.0.0.1:3000/guide` มีปุ่มสลับภาษาและใช้งานแบบออฟไลน์ได้

English first, Thai below it in every section.
แต่ละหัวข้อมีภาษาอังกฤษก่อน แล้วตามด้วยภาษาไทย

Everything runs on your own computer. No account, no internet needed.
ทุกอย่างทำงานในเครื่องของคุณเอง ไม่ต้องสมัครอะไร ไม่ต้องต่อเน็ต

---

## 1. Open the app / เปิดโปรแกรม

**EN**

1. Double-click **START_APP.cmd**
2. Wait for the window to open. Leave it open while you stream.

The pages you will use are on the top bar: **HOME · TEAMS · ANALYTICS · CONTROL · DESIGN · HOTKEYS**

**TH**

1. ดับเบิลคลิก **START_APP.cmd**
2. รอจนหน้าต่างเปิดขึ้นมา แล้วเปิดทิ้งไว้ตลอดเวลาที่ไลฟ์

หน้าที่ใช้บ่อยอยู่บนแถบด้านบน: **HOME · TEAMS · ANALYTICS · CONTROL · DESIGN · HOTKEYS**

---

## 2. Put the overlay into OBS / เอา overlay ใส่ OBS

**EN**

1. Go to **CONTROL**, scroll to **OBS browser sources**
2. Click **COPY URL** on *Overlay 1080p* (use *1440p* if your canvas is 2560×1440)
3. In OBS: **+ → Browser** → paste the URL → Width `1920`, Height `1080`
4. Tick **Control audio via OBS** so viewers can hear the sound effects
5. Leave **Shutdown source when not visible** unticked, so the overlay keeps running
6. Do the same for *Result* if you want the winner screen

If the COPY button does nothing, click the URL text once — it selects itself — then press Ctrl+C.

**TH**

1. ไปหน้า **CONTROL** เลื่อนลงไปที่ **OBS browser sources**
2. กด **COPY URL** ของ *Overlay 1080p* (ถ้า canvas เป็น 2560×1440 ให้ใช้ *1440p*)
3. ใน OBS: **+ → Browser** → วาง URL → Width `1920`, Height `1080`
4. ติ๊ก **Control audio via OBS** เพื่อให้คนดูได้ยินเสียงเอฟเฟกต์
5. อย่าติ๊ก **Shutdown source when not visible** เพื่อให้ overlay ทำงานค้างไว้
6. ถ้าอยากได้หน้าประกาศผู้ชนะ ให้เพิ่ม *Result* ด้วยวิธีเดียวกัน

ถ้ากดปุ่ม COPY แล้วไม่มีอะไรเกิดขึ้น ให้คลิกที่ตัว URL หนึ่งครั้ง มันจะเลือกให้เอง แล้วกด Ctrl+C

---

## 3. Run a quick match / คุมแมตช์แบบเร็ว

For a single match that is not part of a tournament.
ใช้กับแมตช์เดี่ยวที่ไม่ได้อยู่ในทัวร์นาเมนต์

**EN**

1. Go to **CONTROL**
2. Type the team names, or choose a saved team from **From registry**
3. Type the player names
4. During the draft, type hero names into **HERO PICK** and **BAN** — press Enter to confirm
5. Use the **Draft Timer**: `START` · `PAUSE` · `RESUME` · `PREV` · `NEXT`
6. `SHOW` / `HIDE` at the top hides the banner without removing the source in OBS

Bottom buttons: **UNDO** (last change), **SWITCH TEAMS** (swap sides), **CLEAR PICKS & BANS**, **RESET MATCH** (start over).

**TH**

1. ไปหน้า **CONTROL**
2. พิมพ์ชื่อทีม หรือเลือกทีมที่บันทึกไว้จากช่อง **From registry**
3. พิมพ์ชื่อผู้เล่น
4. ตอนดราฟต์ พิมพ์ชื่อฮีโร่ในช่อง **HERO PICK** และ **BAN** แล้วกด Enter
5. ใช้ **Draft Timer**: `START` · `PAUSE` · `RESUME` · `PREV` · `NEXT`
6. ปุ่ม `SHOW` / `HIDE` ด้านบนใช้ซ่อนแถบ overlay โดยไม่ต้องปิด source ใน OBS

ปุ่มด้านล่าง: **UNDO** (ย้อนการแก้ล่าสุด), **SWITCH TEAMS** (สลับฝั่ง), **CLEAR PICKS & BANS**, **RESET MATCH** (เริ่มใหม่ทั้งแมตช์)

---

## 4. Save teams once, use them everywhere / บันทึกทีมไว้ใช้ซ้ำ

**EN**

1. Go to **TEAMS → + NEW TEAM**
2. Fill in the name, tag, players, and a logo
3. Click **CREATE TEAM**

Saved teams appear in **From registry** on the control panel and can be added to any tournament.

**TH**

1. ไปที่ **TEAMS → + NEW TEAM**
2. ใส่ชื่อทีม ตัวย่อ ผู้เล่น และโลโก้
3. กด **CREATE TEAM**

ทีมที่บันทึกไว้จะโผล่ในช่อง **From registry** ของหน้า Control และเอาไปใส่ทัวร์นาเมนต์ไหนก็ได้

---

## 5. Run a tournament / จัดทัวร์นาเมนต์

**EN**

1. **HOME → + NEW TOURNAMENT** → name, format, Best of → **CREATE**
2. **+ ADD TEAM** — pick saved teams, or create new ones here
3. Click **OPEN MATCH SESSION**, then **DRAW MATCHES**
4. Click a match box to put it on air — the control panel opens with both teams filled in
5. Type the scores into the bracket. Winners move to the next round by themselves

To delete a tournament: open it and click **DELETE TOURNAMENT**, or use the **DELETE** button on its card on the home page. This cannot be undone — the bracket and every saved draft go with it. Your teams stay.

**TH**

1. **HOME → + NEW TOURNAMENT** → ชื่อ รูปแบบ จำนวนเกม → **CREATE**
2. **+ ADD TEAM** — เลือกทีมที่บันทึกไว้ หรือสร้างทีมใหม่ตรงนั้นเลย
3. กด **OPEN MATCH SESSION** แล้วกด **DRAW MATCHES**
4. คลิกที่กล่องคู่แข่งเพื่อเอาขึ้นจอ หน้า Control จะเปิดพร้อมชื่อทีมทั้งสองฝั่งให้เลย
5. กรอกคะแนนในสาย ผู้ชนะจะเลื่อนไปรอบถัดไปเอง

ถ้าจะลบทัวร์นาเมนต์: เข้าไปในทัวร์นาเมนต์แล้วกด **DELETE TOURNAMENT** หรือกดปุ่ม **DELETE** บนการ์ดที่หน้าแรก ลบแล้วกู้ไม่ได้ สายการแข่งกับดราฟต์ที่บันทึกไว้หายไปด้วย แต่ทีมในทะเบียนยังอยู่

---

## 6. Sound effects / เสียงเอฟเฟกต์

**EN**

1. Menu **ROV Tool → Open Sounds Folder**
2. Put your own files in, named exactly:

   | File | Plays |
   |---|---|
   | `pick.mp3` | when a hero is picked |
   | `ban.mp3` | when a hero is banned |
   | `timer-warning.mp3` | every second of the last 10 |

   `.wav` works too. You do not need all three.
3. The URLs you copy from the app already have sound switched on
4. Adjust volume on **CONTROL → Sound effects**. **TEST** plays on your computer only, not on stream

Keep `timer-warning` short (under half a second) — it plays once a second.

**The overlay has to stay live for sound to reach viewers.** OBS only mixes audio from
sources in the scene you are broadcasting, so the overlay must be in *that* scene, not only in
another one. Leave **Shutdown source when not visible** unticked, or OBS stops the page every
time you switch away. Keep the app window open too — closing it stops the server.

If you hear nothing, open **http://127.0.0.1:3000/sfx-test** — it tells you what is wrong.

**TH**

1. เมนู **ROV Tool → Open Sounds Folder**
2. เอาไฟล์เสียงของคุณไปวาง ตั้งชื่อให้ตรงนี้เป๊ะๆ:

   | ไฟล์ | ดังตอน |
   |---|---|
   | `pick.mp3` | เลือกฮีโร่ |
   | `ban.mp3` | แบนฮีโร่ |
   | `timer-warning.mp3` | ทุกวินาทีในสิบวินาทีสุดท้าย |

   ใช้ `.wav` ก็ได้ ไม่จำเป็นต้องมีครบทั้งสามไฟล์
3. URL ที่ก๊อปจากในโปรแกรมเปิดเสียงมาให้แล้ว
4. ปรับความดังที่ **CONTROL → Sound effects** ปุ่ม **TEST** ดังที่เครื่องคุณเท่านั้น ไม่ออกอากาศ

ไฟล์ `timer-warning` ควรสั้นๆ (ไม่เกินครึ่งวินาที) เพราะมันดังทุกวินาที

**ต้องเปิด overlay ค้างไว้ตลอด เสียงถึงจะออกไปถึงคนดู** OBS ผสมเสียงเฉพาะ source ที่อยู่ในซีน
ที่กำลังออกอากาศ ดังนั้น overlay ต้องอยู่ในซีนนั้นด้วย ไม่ใช่อยู่แค่ในซีนอื่น
และอย่าติ๊ก **Shutdown source when not visible** ไม่งั้นพอสลับซีนออกไป OBS จะปิดหน้านั้นทิ้ง
ต้องเปิดหน้าต่างโปรแกรมค้างไว้ด้วย ถ้าปิดโปรแกรม เซิร์ฟเวอร์จะหยุดทำงาน

ถ้าไม่ได้ยินเสียงเลย ให้เปิด **http://127.0.0.1:3000/sfx-test** มันจะบอกว่าติดตรงไหน

---

## 7. Change how it looks / เปลี่ยนหน้าตา

**EN**

Go to **DESIGN**. You can change colours, text sizes, logo size, and upload your own background images. The preview at the top updates as you change things.

**TH**

ไปหน้า **DESIGN** เปลี่ยนสี ขนาดตัวหนังสือ ขนาดโลโก้ และอัปโหลดภาพพื้นหลังของคุณเองได้ ตัวอย่างด้านบนจะเปลี่ยนตามทันที

---

## 8. Keyboard shortcuts / คีย์ลัด

| Key / ปุ่ม | What it does | ทำอะไร |
|---|---|---|
| `Alt` | Show / hide the banner | ซ่อน/แสดงแถบ overlay |
| `Space` | Pause / resume the timer | หยุด/เดินเวลาต่อ |
| `←` `→` | Previous / next draft phase | ย้อน/ไปเฟสถัดไป |
| `Ctrl + Z` | Undo | ย้อนกลับ |
| `Enter` | Confirm the hero you typed | ยืนยันฮีโร่ที่พิมพ์ |
| `Esc` | Leave the box, or go back a page | ออกจากช่อง หรือย้อนกลับหน้าก่อนหน้า |

Change these on the **HOTKEYS** page. They only work while the app window is in front — not while you are in OBS or in the game.

เปลี่ยนได้ที่หน้า **HOTKEYS** คีย์ลัดทำงานเฉพาะตอนที่หน้าต่างโปรแกรมอยู่ข้างหน้าเท่านั้น ไม่ทำงานตอนอยู่ใน OBS หรือในเกม

---

## 9. When something looks wrong / เวลามีอะไรผิดปกติ

| Problem / อาการ | Try this / ลองทำแบบนี้ |
|---|---|
| Overlay not updating in OBS | Right-click the source → **Refresh** |
| overlay ใน OBS ไม่อัปเดต | คลิกขวาที่ source → **Refresh** |
| No sound | Open `/sfx-test`, and tick **Control audio via OBS** in the source properties |
| ไม่มีเสียง | เปิด `/sfx-test` และติ๊ก **Control audio via OBS** ใน properties ของ source |
| Sound plays twice | Only one browser source may have `?sfx=1` in its URL |
| เสียงดังซ้อนสองครั้ง | ให้มี `?sfx=1` ใน URL ของ source เดียวเท่านั้น |
| Sound stops after switching scenes | The overlay must be in the scene you are broadcasting, and **Shutdown source when not visible** must be unticked |
| สลับซีนแล้วเสียงหาย | overlay ต้องอยู่ในซีนที่กำลังออกอากาศ และห้ามติ๊ก **Shutdown source when not visible** |
| Wrong teams on screen | Press **RESET MATCH**, or put the right match on air again |
| ทีมบนจอผิด | กด **RESET MATCH** หรือเอาแมตช์ที่ถูกขึ้นจอใหม่ |
| Changed a sound file but hear the old one | Add `&v=2` to the end of the source URL, then Refresh |
| เปลี่ยนไฟล์เสียงแล้วยังได้ยินเสียงเก่า | เติม `&v=2` ท้าย URL ของ source แล้ว Refresh |

---

## Where your files are / ไฟล์ของคุณอยู่ที่ไหน

| What / อะไร | Where / ที่ไหน |
|---|---|
| Sounds / เสียง | Menu **ROV Tool → Open Sounds Folder** |
| Teams, tournaments / ทีม ทัวร์นาเมนต์ | `%APPDATA%\rov-overlay-tool\data` |
| Logos, backgrounds / โลโก้ ภาพพื้นหลัง | `%APPDATA%\rov-overlay-tool\media` |

Back these up by copying the folders. Nothing is stored online.
สำรองข้อมูลด้วยการก๊อปโฟลเดอร์พวกนี้ไปเก็บไว้ ไม่มีอะไรถูกเก็บบนออนไลน์
