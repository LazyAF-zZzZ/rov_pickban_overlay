// ค่า default ของธีม overlay ถูกเขียนไว้สามที่
//
//   server/domain/settings.ts   THEME_DEFAULTS  - ค่าที่เซิร์ฟเวอร์ยัดให้ state
//   public/css/overlay.css      :root           - ค่าที่ใช้ก่อน overlay.js จะเขียนทับ
//   public/js/design.js         THEME_DEFAULTS  - ค่าที่ปุ่ม Reset บนหน้า Design พากลับไป
//
// ทั้งสองไฟล์มีคอมเมนต์เตือนไว้แล้วว่า "ต้องตรงกันเป๊ะๆ ไม่งั้นกด Reset แล้ว
// หน้าตาเปลี่ยน" แต่ไม่มีอะไรบังคับ และมันเพิ่งเพี้ยนมาแล้วจริงตอน 2026-09-09
// ระหว่างขยายขนาดชื่อผู้เล่น: CSS ถูกแก้เป็น 22 ส่วนอีกสองที่ยังเป็น 18
// อาการคือหน้าเว็บดูปกติ (overlay.js เขียนค่าจาก state ทับอยู่แล้ว) แต่ผู้ใช้
// ที่ติดตั้งใหม่หรือกด Reset จะได้คนละขนาดกับที่ CSS เขียนไว้
//
// เทสต์นี้อ่านของจริงจากทั้งสามไฟล์มาเทียบกัน ไม่ได้เขียนค่าคาดหวังทิ้งไว้เอง
// เพราะถ้าเขียนไว้ ก็จะกลายเป็นสำเนาที่สี่ที่ต้องคอยตามแก้

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

import { THEME_DEFAULTS, THEME_NUMBER_RANGE } from '../server/domain/settings';

const ROOT = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ชื่อคีย์ในโค้ด -> ชื่อ CSS custom property
// ตารางนี้คือของ overlay.js เอง อ่านมาจากไฟล์เพื่อไม่ให้เป็นสำเนาอีกชุด
function tokenNames(): Record<string, string> {
  const js = read('public/js/overlay.js');
  const block = js.slice(js.indexOf('const THEME_VARS'), js.indexOf('function hexToRgbTriplet'));
  const map: Record<string, string> = {};
  for (const m of block.matchAll(/(\w+):\s*\['(--[a-z-]+)'/g)) map[m[1]] = m[2];
  return map;
}

// อ่านค่าใน :root ของ overlay.css
function cssRootValues(): Record<string, string> {
  const css = read('public/css/overlay.css');
  const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
  const out: Record<string, string> = {};
  for (const m of root.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

// อ่าน THEME_DEFAULTS ของ design.js โดยไม่ต้อง import (เป็น classic script)
function designDefaults(): Record<string, string> {
  const js = read('public/js/design.js');
  const start = js.indexOf('const THEME_DEFAULTS');
  const block = js.slice(start, js.indexOf('};', start));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(\w+):\s*('#[0-9a-fA-F]{6}'|"#[0-9a-fA-F]{6}"|\d+)/g)) {
    out[m[1]] = m[2].replace(/['"]/g, '');
  }
  return out;
}

test('every theme key maps to a CSS custom property', () => {
  const tokens = tokenNames();
  const keys = Object.keys(THEME_DEFAULTS);
  assert.ok(keys.length > 0);
  keys.forEach((key) => {
    assert.ok(tokens[key], `${key} has no --ov-* token in overlay.js, so nothing on the overlay would move`);
  });
  // ไม่มี token ค้างที่ไม่มีใครตั้งค่าให้
  Object.keys(tokens).forEach((key) => {
    assert.ok(key in THEME_DEFAULTS, `overlay.js writes ${key} but THEME_DEFAULTS has no default for it`);
  });
});

test('THEME_DEFAULTS matches :root in overlay.css exactly', () => {
  const tokens = tokenNames();
  const css = cssRootValues();

  Object.entries(THEME_DEFAULTS).forEach(([key, value]) => {
    const token = tokens[key];
    const declared = css[token];
    assert.ok(declared !== undefined, `${token} is missing from :root in overlay.css`);

    // ค่าตัวเลขในโค้ดไม่มีหน่วย ส่วนใน CSS มี px
    const expected = typeof value === 'number' ? `${value}px` : String(value);
    assert.strictEqual(
      declared.toLowerCase(),
      expected.toLowerCase(),
      `${key}: overlay.css says ${declared}, THEME_DEFAULTS says ${expected} - a fresh install and a Reset would not look the same`
    );
  });
});

test('the Design page resets to the same values the server defaults to', () => {
  const design = designDefaults();

  Object.entries(THEME_DEFAULTS).forEach(([key, value]) => {
    assert.ok(key in design, `design.js has no default for ${key}, so Reset would leave it alone`);
    assert.strictEqual(
      design[key].toLowerCase(),
      String(value).toLowerCase(),
      `${key}: design.js resets to ${design[key]}, the server defaults to ${value}`
    );
  });
});

test('every default sits inside the range the Design page allows', () => {
  Object.entries(THEME_NUMBER_RANGE).forEach(([key, [min, max]]) => {
    const value = THEME_DEFAULTS[key as keyof typeof THEME_DEFAULTS];
    assert.strictEqual(typeof value, 'number', `${key} has a numeric range but a non-numeric default`);
    assert.ok(
      (value as number) >= min && (value as number) <= max,
      `${key} defaults to ${value}, outside its own ${min}..${max} slider range`
    );
  });
});

test('a player name stays inside its slot at the default size', () => {
  // ช่องพิคกว้าง 144px ตายตัว กล่องชื่อคือส่วนที่เหลือหลังหัก padding กับเส้นขอบ
  // ถ้า default ของชื่อผู้เล่นโตจนชื่อจริงล้น จะโดนตัดด้วย ellipsis บนจอออกอากาศ
  // ตัวเลขข้างล่างวัดมาจากเบราว์เซอร์จริงด้วยฟอนต์ Kanit 600 ที่ 22px
  const css = read('public/css/overlay.css');
  const info = css.slice(css.indexOf('.player-info {'), css.indexOf('}', css.indexOf('.player-info {')));
  const padding = /padding:\s*\d+px\s+(\d+)px/.exec(info);
  assert.ok(padding, '.player-info must keep an explicit horizontal padding - the name box width depends on it');

  const SLOT = 144;
  const BORDER = 2;
  const box = SLOT - Number(padding[1]) * 2 - BORDER * 2;

  // ชื่อที่ยาวที่สุดที่เจอจริงในสนามคือรูปแบบ NAME(C) ประมาณ 10 ตัวอักษร
  // วัดได้ 130px ที่ 22px ถ้ากล่องแคบกว่านี้ต้องลด default หรือลด padding
  const MEASURED_WIDEST = 130;
  assert.ok(
    box >= MEASURED_WIDEST,
    `the name box is ${box}px but a 10-character name measures ${MEASURED_WIDEST}px at the default size - names would be cut off`
  );
});
