import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import type { SkinSlot, LogoSlot } from '../server/domain/media';
import { newId } from '../server/domain/ids';
import {
  SKIN_SLOTS,
  LOGO_SLOTS,
  SKIN_DIR,
  LOGO_DIR,
  SKIN_TYPES,
  SKIN_MAGIC,
  isSafeMediaId,
  skinFilePath,
  logoFilePath,
  sanitizeLogo,
  sanitizeSkin,
  SOUND_FILES
} from '../server/domain/media';

test('magic byte checks accept the right headers and reject mismatches', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16)]);
  const junk = Buffer.alloc(32, 9);

  assert.ok(SKIN_MAGIC.png(png));
  assert.ok(SKIN_MAGIC.jpg(jpg));
  assert.ok(SKIN_MAGIC.webp(webp));
  assert.ok(!SKIN_MAGIC.png(junk));
  assert.ok(!SKIN_MAGIC.jpg(png));
  assert.ok(!SKIN_MAGIC.webp(png));
  assert.ok(!SKIN_MAGIC.png(Buffer.alloc(2)), 'short buffers must not pass');
});

test('skin and logo paths never escape their directory', () => {
  (Object.keys(SKIN_SLOTS) as SkinSlot[]).forEach((slot) => {
    Object.values(SKIN_TYPES).forEach((ext) => {
      const full = path.resolve(skinFilePath(slot, ext));
      assert.ok(full.startsWith(path.resolve(SKIN_DIR)), `${slot} stays inside the skin dir`);
    });
  });
  (Object.keys(LOGO_SLOTS) as LogoSlot[]).forEach((team) => {
    Object.values(SKIN_TYPES).forEach((ext) => {
      const full = path.resolve(logoFilePath(team, ext));
      assert.ok(full.startsWith(path.resolve(LOGO_DIR)), `${team} stays inside the logo dir`);
    });
  });
});

// เตรียมไว้สำหรับโลโก้ต่อทีมในโหมดทัวร์นาเมนต์ (128 ทีม)
// ชื่อไฟล์จะมาจาก id ที่เซิร์ฟเวอร์สร้าง ไม่ใช่ชื่อทีมที่ผู้ใช้พิมพ์
test('isSafeMediaId rejects anything that could climb out of a folder', () => {
  assert.ok(isSafeMediaId('t3f9a2c81'));
  assert.ok(isSafeMediaId('team-01'));

  ['../evil', 'a/b', 'a\\b', '.', '..', '', 'UPPER', 'has space', 'dot.name', '-leading', null, 42]
    .forEach((bad) => {
      assert.ok(!isSafeMediaId(bad), `${JSON.stringify(bad)} must be rejected`);
    });
  assert.ok(!isSafeMediaId('x'.repeat(65)), 'over-long ids rejected');
});

test('sanitizeLogo only trusts known extensions', () => {
  assert.deepStrictEqual(sanitizeLogo({ v: 123, ext: 'png' }), { v: 123, ext: 'png' });
  assert.deepStrictEqual(sanitizeLogo({ v: 123, ext: 'gif' }), { v: 0, ext: '' });
  assert.deepStrictEqual(sanitizeLogo({ v: 0, ext: 'png' }), { v: 0, ext: '' });
  assert.deepStrictEqual(sanitizeLogo(null), { v: 0, ext: '' });
});

test('sanitizeSkin always returns every known slot', () => {
  const skin = sanitizeSkin({ enabled: true, slots: { overlayTop1080: 5, bogus: 9 } });
  assert.strictEqual(skin.enabled, true);
  assert.strictEqual(skin.showPanels, true);
  // ช่องที่ไม่รู้จักต้องไม่รอดออกมา อ่านผ่าน Record เพราะมันไม่มีในชนิด Skin
  assert.strictEqual((skin.slots as unknown as Record<string, unknown>).bogus, undefined);
  (Object.keys(SKIN_SLOTS) as SkinSlot[]).forEach((slot) => {
    assert.strictEqual(typeof skin.slots[slot], 'number', `${slot} present`);
  });
  assert.strictEqual(skin.slots.overlayTop1080, 5);
});

// เสียงที่ต้องติดไปกับตัวติดตั้ง
//
// เสียงย้ายมาอยู่ใน public/images/sounds เพื่อให้ติดไปกับ .exe ที่คนโหลด
// (ดู USER_SOUND_DIR ใน config.ts และ build.files ใน package.json)
// ไฟล์หายไปจากโฟลเดอร์นี้เมื่อไหร่ ตัวติดตั้งก็จะเงียบ โดยที่ทุกอย่างยังผ่านหมด
// เพราะโค้ดไม่ได้พังอะไร แค่ไม่มีไฟล์ให้เล่น ซึ่งแยกไม่ออกจากของเสีย
test('the app ships with its own sound files, so a download is not silent', () => {
  const dir = path.join(__dirname, '..', '..', 'public', 'images', 'sounds');

  SOUND_FILES.forEach((name) => {
    const found = ['mp3', 'wav']
      .map((ext) => path.join(dir, `${name}.${ext}`))
      .find((file) => fs.existsSync(file));

    assert.ok(found, `${name} is missing from public/images/sounds - the installer would ship silent`);
    assert.ok(fs.statSync(found).size > 0, `${name} is an empty file`);
  });
});

// ภาพที่ผู้ใช้อัปโหลดเองต้องไม่ติดไปกับตัวติดตั้ง
//
// โลโก้ทีมกับภาพพื้นหลังเป็นของผู้ใช้ ไม่ใช่ทรัพยากรของแอพ ต่างจากรูปฮีโร่กับไฟล์เสียง
// build.files ใน package.json เอา public/**/* ไปทั้งก้อน ถ้าไม่ยกเว้นให้ครบ
// เครื่องที่กด build จะแพ็กโลโก้ของทีมที่ตัวเองซ้อมไว้ ส่งไปให้ทุกคนที่โหลดไปใช้
//
// เกิดขึ้นจริงมาแล้ว: ตัวติดตั้งที่สร้างไว้มี blue-team.png กับ red-team.png
// ของเครื่องที่ build ฝังอยู่ใน app.asar
//
// ตรวจทั้งสามนามสกุลที่ตัวอัปโหลดรับ ไม่ใช่แค่ png (ดู SKIN_TYPES)
test('the installer never ships images the operator uploaded', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
  ) as { build: { files: string[] } };

  const extensions = Object.values(SKIN_TYPES);
  (['team-logos', 'skins'] as const).forEach((folder) => {
    extensions.forEach((ext) => {
      const rule = `!public/images/${folder}/*.${ext}`;
      assert.ok(
        pkg.build.files.includes(rule),
        `build.files must exclude ${rule} - uploaded images are the user's own data`
      );
    });
  });

  // ของที่ต้องติดไปด้วยจริงๆ ห้ามถูกยกเว้นตามไปด้วย
  ['public/images/heroes', 'public/images/sounds'].forEach((keep) => {
    assert.ok(
      !pkg.build.files.some((f) => f.startsWith('!') && f.includes(keep)),
      `${keep} is an app asset and must keep shipping`
    );
  });
});

// ตัวถอยของรูปที่โหลดไม่ขึ้น ต้องถอยได้ครั้งเดียว ไม่ใช่วนไม่รู้จบ
//
// รูปแบบที่พัง: onerror ชี้ src ไปที่ไฟล์สำรอง โดยไม่เปลี่ยน onerror ก่อน
// ถ้าไฟล์สำรองก็ไม่มี error จะยิงอีกครั้ง แล้วเขียน src ค่าเดิมทับ ซึ่งสั่งให้โหลดใหม่
// วนอยู่แบบนั้นตลอดไป วัดในเบราว์เซอร์จริงได้ error 1607 ครั้งใน 2.5 วินาที
// (ราว 640 คำขอต่อวินาที) และมันอยู่ในทั้ง overlay.js กับ result.js ซึ่งเป็น
// กราฟิกที่ออกอากาศอยู่ ไม่มีอะไรบนจอบอกว่ากำลังเกิดเรื่องนี้
//
// ฮีโร่ที่ทำให้เกิดได้จริง: ชื่ออยู่ใน heroes.json แต่ไฟล์ภาพหายหรือถูกเปลี่ยนชื่อ
// ซึ่ง CLAUDE.md เตือนไว้แล้วว่าเกิดขึ้นได้และประวัติเก่าจะชี้ไปที่ชื่อเดิม
test('an image fallback gives up instead of asking for a missing file forever', () => {
  const jsDir = path.join(__dirname, '..', '..', 'public', 'js');

  const files: string[] = [];
  (function walk(dir: string) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) files.push(full);
    });
  })(jsDir);

  files.forEach((file) => {
    const src = fs.readFileSync(file, 'utf8');
    // ตัวเนื้อของ onerror แต่ละตัว เอาแบบหยาบๆ ถึงวงเล็บปีกกาปิดตัวแรก
    [...src.matchAll(/onerror\s*=\s*(?:function\s*\([^)]*\)|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)\s*\{([\s\S]*?)\n\s*\}/g)]
      .forEach((match) => {
        const body = match[1] || '';
        const setsSrc = /\.src\s*=/.test(body) || /\bsrc\s*=\s*imageUrl|\bsrc\s*=\s*hero/.test(body);
        if (!setsSrc) return;
        assert.ok(
          /onerror\s*=/.test(body),
          `${path.relative(jsDir, file)}: an onerror that retries a src must replace onerror `
          + 'in the same handler, or a hero with neither image loops forever'
        );
      });
  });
});

// ชื่ออุปกรณ์ของ Windows ต้องไม่ผ่านด่าน id ที่จะกลายเป็นชื่อไฟล์
//
// Windows ตีความ "aux" เป็นอุปกรณ์ ไม่ใช่ไฟล์ และยังตีความแบบนั้นแม้มีนามสกุล
// ต่อท้าย ("aux.png") การเขียนลงไปจึงล้มเหลวหรือค้าง ไม่ได้ไฟล์ภาพ
//
// วันนี้ยังไปไม่ถึง: id มาจาก newId() และเส้นทางอัปโหลดโลโก้เช็คก่อนว่ามีทีมนั้นจริง
// ด่านนี้กันไว้เผื่อวันหลังมีคนเปิดให้ตั้ง id เอง (เหตุผลเดียวกับที่ newId เช็คซ้ำ)
test('a Windows device name is never a usable media id', () => {
  const devices = ['con', 'prn', 'aux', 'nul', 'com1', 'com9', 'lpt1', 'lpt9'];
  devices.forEach((name) => {
    assert.strictEqual(isSafeMediaId(name), false, `${name} is refused`);
  });

  // และของที่เคยผ่านต้องยังผ่านอยู่ ไม่ใช่กันกว้างเกินไป
  ['aux2', 'con-fig', 'com10', 'lpt', 'auxiliary', 'tabc123def456'].forEach((name) => {
    assert.strictEqual(isSafeMediaId(name), true, `${name} still passes`);
  });

  // id ที่เซิร์ฟเวอร์สร้างเองต้องไม่มีทางชนชื่ออุปกรณ์ (ขึ้นต้นด้วยตัวอักษรนำหน้าเสมอ)
  for (let i = 0; i < 200; i += 1) {
    assert.strictEqual(isSafeMediaId(newId('team')), true);
  }
});
