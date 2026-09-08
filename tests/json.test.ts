// เทสต์การอ่าน/เขียนไฟล์ JSON
//
// ไฟล์เดียวที่เขียนผ่านทางนี้คือ state.json ซึ่งเก็บทุกอย่างของแมตช์ที่ออกอากาศอยู่
// และถูกเขียนใหม่ทุกวินาทีระหว่างจับเวลาดราฟต์ การเขียนที่ขาดกลางคันจึงไม่ใช่
// เรื่องทฤษฎี และผลของมันคือข้อมูลทั้งวันหายในครั้งเดียว

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { loadJson, writeJson } from '../server/lib/json';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-json-test-'));

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ระบบเก็บเอง */ }
});

test('writing goes through a temp file so the real one is never half written', () => {
  const target = path.join(TMP, 'nested', 'state.json');
  writeJson(target, { a: 1 });

  assert.deepStrictEqual(loadJson(target, null), { a: 1 }, 'the folder is created and the file round-trips');
  assert.ok(!fs.existsSync(`${target}.tmp`), 'no temp file is left behind');

  writeJson(target, { a: 2 });
  assert.deepStrictEqual(loadJson(target, null), { a: 2 }, 'overwriting an existing file works');
  assert.ok(!fs.existsSync(`${target}.tmp`), 'and still leaves no temp file');
});

test('a missing file falls back quietly, a corrupt one falls back loudly', () => {
  const missing = path.join(TMP, 'not-there.json');
  assert.deepStrictEqual(loadJson(missing, { fallback: true }, { quiet: true }), { fallback: true });

  // ไฟล์ที่มีอยู่แต่พัง ต้องไม่เงียบ แม้จะสั่ง quiet มา
  // quiet แปลว่า "ยังไม่มีไฟล์ก็ไม่เป็นไร" ไม่ได้แปลว่า "ข้อมูลหายก็ไม่ต้องบอก"
  const broken = path.join(TMP, 'broken.json');
  fs.writeFileSync(broken, '{ "half": ', 'utf8');

  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
  try {
    assert.deepStrictEqual(loadJson(broken, { fallback: true }, { quiet: true }), { fallback: true });
  } finally {
    console.warn = realWarn;
  }

  assert.strictEqual(warnings.length, 1, 'a corrupt file is always reported');
  assert.match(warnings[0] as string, /not valid JSON/);
});

test('the fallback is copied, so one caller cannot poison the next', () => {
  const shared = { list: [1, 2] };
  const first = loadJson(path.join(TMP, 'absent.json'), shared, { quiet: true }) as { list: number[] };
  first.list.push(3);

  const second = loadJson(path.join(TMP, 'absent.json'), shared, { quiet: true });
  assert.deepStrictEqual(second, { list: [1, 2] }, 'the second caller gets a clean copy');
});
