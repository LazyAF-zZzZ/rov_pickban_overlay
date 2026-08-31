# การปรับแต่ง

## เปลี่ยนรูปฮีโร่

วางรูปไว้ที่:

```text
public/images/heroes/
```

แล้วแก้รายชื่อใน:

```text
data/heroes.json
```

ชื่อใน JSON ต้องตรงกับชื่อไฟล์รูปแบบไม่รวมนามสกุล

ตัวอย่าง:

```text
public/images/heroes/nakroth.png
```

ใน `data/heroes.json` ต้องมี:

```json
"nakroth"
```

## เปลี่ยนโลโก้ทีม

วางไฟล์ที่:

```text
public/images/team-logos/
```

จากนั้นเลือกในหน้า Control Panel

## แก้หน้าตา Overlay

ไฟล์หลัก:

```text
public/css/overlay.css
public/css/overlay-1440.css
public/css/result.css
```

## สำรองข้อมูลรายการ

ถ้าใช้แบบ source code ข้อมูลแมตช์กับทัวร์นาเมนต์จะอยู่ใน:

```text
data/
```

ถ้าใช้แบบ `.exe` ข้อมูลใช้งานจะอยู่ใน AppData ของ Windows:

```text
%APPDATA%/ROV Overlay Tool/data/
```
