import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import type { SkinSlot, LogoSlot } from '../server/domain/media';
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
