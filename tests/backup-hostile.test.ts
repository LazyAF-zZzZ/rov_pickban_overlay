// ไฟล์นำเข้าที่ถูกแต่งมาให้ทำร้ายเครื่อง
//
// เขียนก่อนตัวนำเข้า ตั้งใจ ไฟล์สำรองเป็นทางเดียวในแอพนี้ที่รับ "ข้อมูลจากคนอื่น"
// เข้ามาทั้งก้อน คนส่งคุมได้ทุกไบต์ และสองอย่างที่เขาอยากได้คือ
// เขียนไฟล์ลงเครื่อง กับรันสคริปต์ในต้นทางเดียวกับหน้าคุมงาน (ซึ่งถือโทเคน
// ที่สั่ง overlay ที่กำลังออกอากาศได้)
//
// เทสต์ชุดนี้จึงไม่ได้ถามว่า "นำเข้าได้ไหม" แต่ถามว่า "ปฏิเสธได้ไหม"

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-hostile-'));
process.env.ROV_USER_DATA_DIR = path.join(TMP, 'data');
process.env.ROV_USER_MEDIA_DIR = path.join(TMP, 'media');
process.env.CONTROL_TOKEN = '';

const { LOGO_DIR, SKIN_DIR } = require('../server/domain/media') as typeof import('../server/domain/media');

import {
  readBackup, readImage, summarise,
  BACKUP_FORMAT, BACKUP_VERSION, MAX_FILE_BYTES
} from '../server/domain/backup';
import { must } from './helpers';

// ไบต์ต้นไฟล์จริงของแต่ละชนิด ใช้สร้างรูปที่ "ถูกต้อง" ไว้เทียบ
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const b64 = (buf: Buffer) => buf.toString('base64');

function envelope(data: Record<string, unknown>) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kind: 'full',
    app: '2.0.0-beta',
    exportedAt: '2026-09-06T00:00:00.000Z',
    data: {
      teams: [], tournaments: [], matches: [], games: [],
      logos: {}, skins: {}, state: null,
      ...data
    }
  };
}

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ระบบเก็บเอง */ }
});

// ---- ชั้นที่ 1: ไฟล์ไม่มีสิทธิ์บอกชื่อไฟล์หรือที่อยู่ ----------------------

// อันตรายที่สุดในชุดนี้ เขียนไฟล์ไปที่ไหนก็ได้บนเครื่อง = ยึดเครื่องได้
// เป้าที่มีค่าจริงบนวินโดวส์คือโฟลเดอร์ Startup และตัว app.asar เอง
test('a logo key that tries to climb out of its folder is dropped', () => {
  const evil = [
    '../../../../AppData/Roaming/Microsoft/Windows/Start Menu/Programs/Startup/x',
    '..\\..\\..\\evil',
    '../heroes/airi',
    './../../app.asar',
    'a/b',
    'a\\b',
    '..',
    '.',
    'C:/Windows/System32/drivers/etc/hosts',
    '\\\\server\\share\\x',
    'x\u0000.png',
    ''
  ];

  const logos: Record<string, unknown> = {};
  evil.forEach((key) => { logos[key] = { ext: 'png', bytes: b64(PNG) }; });
  logos.goodteam1234 = { ext: 'png', bytes: b64(PNG) };

  const file = must(readBackup(envelope({ logos })).file);
  assert.deepStrictEqual(
    Object.keys(file.data.logos), ['goodteam1234'],
    'only an id that passes isSafeMediaId may become a filename'
  );
});

// 'blue-team' กับ 'red-team' คือชื่อไฟล์ของช่องโลโก้ในแมตช์ที่กำลังออกอากาศ
// คีย์เหล่านี้ปลอดภัยในแง่ path แต่เขียนทับภาพที่อยู่บนจอตอนนั้นได้
test('a logo cannot be smuggled into the live match logo slots', () => {
  const file = must(readBackup(envelope({
    logos: {
      'blue-team': { ext: 'png', bytes: b64(PNG) },
      'red-team': { ext: 'png', bytes: b64(PNG) },
      'team12345678': { ext: 'png', bytes: b64(PNG) }
    }
  })).file);

  assert.deepStrictEqual(
    Object.keys(file.data.logos), ['team12345678'],
    'the on-air logo slots belong to the running match, not to an imported file'
  );
});

// ช่องภาพพื้นหลังเป็นชุดปิด ไม่ใช่ข้อความอิสระ
test('a skin slot that is not one of the known slots is dropped', () => {
  const file = must(readBackup(envelope({
    skins: {
      'overlayTop1080': { ext: 'png', bytes: b64(PNG) },
      '../../evil': { ext: 'png', bytes: b64(PNG) },
      'notASlot': { ext: 'png', bytes: b64(PNG) }
    }
  })).file);
  assert.deepStrictEqual(Object.keys(file.data.skins), ['overlayTop1080']);
});

// id ของทีม แมตช์ และเกม ถูกเอาไปประกอบชื่อไฟล์และคีย์ ต้องผ่านตัวตรวจเดียวกัน
test('records whose id could become a path are refused entirely', () => {
  const file = must(readBackup(envelope({
    teams: [
      { id: '../../etc/passwd', name: 'Evil' },
      { id: 'good1234abcd', name: 'Fine' },
      { id: 'has space', name: 'Spacey' },
      { id: 123, name: 'Numeric' },
      { id: null, name: 'Null' }
    ]
  })).file);

  assert.deepStrictEqual(file.data.teams.map((t) => t.id), ['good1234abcd']);
});

// ---- ชั้นที่ 2: ไบต์ต้องตรงกับชนิดที่อ้าง ---------------------------------

// ไฟล์ HTML ที่ตั้งชื่อ .png แล้วถูกเสิร์ฟจากต้นทางเดียวกับหน้าคุมงาน
// คือทางที่สคริปต์ของคนอื่นได้อ่านโทเคนควบคุมไป
test('a file that is not really an image is refused however it is labelled', () => {
  const html = Buffer.from('<html><script>fetch("/api/state?token="+localStorage.rovControlToken)</script>');
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

  assert.strictEqual(readImage({ ext: 'png', bytes: b64(html) }), null, 'HTML claiming to be a PNG');
  assert.strictEqual(readImage({ ext: 'jpg', bytes: b64(html) }), null, 'HTML claiming to be a JPG');
  assert.strictEqual(readImage({ ext: 'webp', bytes: b64(html) }), null, 'HTML claiming to be a WEBP');
  assert.strictEqual(readImage({ ext: 'svg', bytes: b64(svg) }), null, 'svg is not an accepted type at all');
  assert.strictEqual(readImage({ ext: 'png', bytes: b64(svg) }), null, 'nor is it accepted in disguise');

  // ของจริงยังผ่าน ไม่ใช่ปฏิเสธทุกอย่างแล้วเรียกว่าปลอดภัย
  const ok = readImage({ ext: 'png', bytes: b64(PNG) });
  assert.ok(ok, 'a real PNG still imports');
  assert.strictEqual(must(ok).ext, 'png');
});

test('an image field that is not a string, or is not base64, is refused', () => {
  [
    { ext: 'png', bytes: null },
    { ext: 'png', bytes: 12345 },
    { ext: 'png', bytes: {} },
    { ext: 'png', bytes: '' },
    { ext: 'png' },
    { bytes: b64(PNG) },
    null,
    'nope',
    []
  ].forEach((bad) => {
    assert.strictEqual(readImage(bad), null, `${JSON.stringify(bad)} must not become a file`);
  });
});

// ---- ชั้นที่ 3: สร้างของใหม่จากคีย์ที่รู้จัก ------------------------------

test('prototype pollution in the file does not reach Object.prototype', () => {
  const payload = JSON.parse(`{
    "format": "${BACKUP_FORMAT}", "version": 1, "kind": "full",
    "app": "x", "exportedAt": "y",
    "data": {
      "teams": [{ "id": "team12345678", "name": "T", "__proto__": { "polluted": true } }],
      "tournaments": [], "matches": [], "games": [],
      "logos": {}, "skins": {},
      "__proto__": { "alsoPolluted": true }
    },
    "__proto__": { "topLevel": true }
  }`);

  const file = must(readBackup(payload).file);
  assert.strictEqual(({} as Record<string, unknown>).polluted, undefined);
  assert.strictEqual(({} as Record<string, unknown>).alsoPolluted, undefined);
  assert.strictEqual(({} as Record<string, unknown>).topLevel, undefined);
  assert.strictEqual(file.data.teams.length, 1, 'and the legitimate part still came through');
});

test('unknown keys are dropped rather than carried along', () => {
  const file = must(readBackup(envelope({
    teams: [{ id: 'team12345678', name: 'T', somethingElse: 'x', nested: { a: 1 } }]
  })).file);

  const team = must(file.data.teams[0]) as unknown as Record<string, unknown>;
  assert.strictEqual(team.somethingElse, undefined);
  assert.strictEqual(team.nested, undefined);
});

// ---- ชั้นที่ 4: ข้อความที่จะถูกเอาไปวาดบนจอ -------------------------------

// ชื่อทีมถูกวาดทั้งบนหน้าคุมงานและบนกราฟิกออกอากาศ
// หน้าเว็บทุกหน้าประกอบด้วย textContent อยู่แล้ว (มีเทสต์คุมอยู่)
// แต่ข้อความก็ยังต้องไม่มีอักขระควบคุมและต้องมีเพดานความยาว
test('names keep their text but lose control characters and excess length', () => {
  const nasty = 'A\u0000B\u001bC<script>alert(1)</script>';
  const file = must(readBackup(envelope({
    teams: [{ id: 'team12345678', name: nasty + 'x'.repeat(200), tag: nasty }]
  })).file);

  const team = must(file.data.teams[0]);
  assert.ok(!/[\u0000-\u001f\u007f]/.test(team.name), 'no control characters survive');
  assert.ok(team.name.length <= 40, 'and the length is capped');
  assert.ok(!/[\u0000-\u001f\u007f]/.test(team.tag));
  // ตัวอักษรธรรมดายังอยู่ครบ การกรองนี้ไม่ใช่การลบทุกอย่างที่ดูแปลก
  // ความปลอดภัยจาก XSS มาจากการวาดด้วย textContent ไม่ใช่จากการตัดคำทิ้ง
  assert.ok(team.name.includes('script'), 'text is kept as text, not mangled');
});

// ---- ชั้นที่ 5: เพดาน ------------------------------------------------------

test('the file cannot ask the app to hold an unbounded amount', () => {
  const many = Array.from({ length: 5000 }, (_, i) => ({ id: `team${String(i).padStart(8, '0')}`, name: `T${i}` }));
  const file = must(readBackup(envelope({ teams: many })).file);
  assert.ok(file.data.teams.length < 5000, 'the list is capped');
  assert.ok(file.data.teams.length > 0, 'but not emptied');

  assert.ok(MAX_FILE_BYTES > 0 && MAX_FILE_BYTES <= 128 * 1024 * 1024,
    'there is a byte ceiling for the transport layer to enforce');
});

test('an oversized image is refused rather than written', () => {
  const huge = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
  assert.strictEqual(readImage({ ext: 'png', bytes: b64(huge) }), null);
});

// ---- ชั้นที่ 6: ไฟล์ที่ไม่ใช่ไฟล์สำรอง ------------------------------------

test('anything that is not one of our backups is turned away by name', () => {
  const cases: [unknown, RegExp][] = [
    [null, /not a ROV Overlay backup/i],
    ['a string', /not a ROV Overlay backup/i],
    [{}, /not a ROV Overlay backup/i],
    [{ format: 'something-else' }, /not a ROV Overlay backup/i],
    [{ format: BACKUP_FORMAT }, /no version/i],
    [{ format: BACKUP_FORMAT, version: 0 }, /no version/i],
    [{ format: BACKUP_FORMAT, version: 99, kind: 'full' }, /newer version/i],
    [{ format: BACKUP_FORMAT, version: 1, kind: 'tournament' }, /full backups/i]
  ];

  cases.forEach(([input, pattern]) => {
    const result = readBackup(input);
    assert.strictEqual(result.file, undefined, `${JSON.stringify(input)} must not be read`);
    assert.match(String(result.error), pattern);
  });
});

// ---- สรุปที่เอาไปโชว์ก่อนถามยืนยัน ----------------------------------------

test('the summary counts what is really in the file, after filtering', () => {
  const file = must(readBackup(envelope({
    teams: [{ id: 'team12345678', name: 'Keep' }, { id: '../evil', name: 'Drop' }],
    games: [
      { id: 'game12345678', matchId: 'match1234567', slots: [{ side: 'blue', kind: 'pick', idx: 0, hero: 'airi' }] },
      { id: 'game22345678', matchId: 'match1234567', slots: [] }
    ],
    logos: { team12345678: { ext: 'png', bytes: b64(PNG) }, '../x': { ext: 'png', bytes: b64(PNG) } }
  })).file);

  const s = summarise(file);
  assert.strictEqual(s.teams, 1, 'the dropped team is not counted');
  assert.strictEqual(s.games, 2);
  assert.strictEqual(s.drafts, 1, 'only the game with slots counts as a recorded draft');
  assert.strictEqual(s.logos, 1);
});

// โฟลเดอร์ปลายทางต้องอยู่ใต้ USER_MEDIA_DIR เสมอ
// เป็นด่านสุดท้ายที่ไม่ขึ้นกับตัวกรองข้างบน ถ้าวันหลังใครผ่อน isSafeMediaId
// ให้หลวมลง ด่านนี้ยังกันการเขียนออกนอกโฟลเดอร์อยู่
test('the media directories are where we think they are', () => {
  const media = path.resolve(String(process.env.ROV_USER_MEDIA_DIR));
  assert.ok(path.resolve(LOGO_DIR).startsWith(media + path.sep), 'logos live under the media dir');
  assert.ok(path.resolve(SKIN_DIR).startsWith(media + path.sep), 'skins too');
});


// ตัดคอมเมนต์ออกก่อนตรวจ
//
// ไฟล์ที่ทำถูกมักมีคอมเมนต์อธิบายว่า "ห้ามใช้ innerHTML ตรงนี้" ซึ่งเป็นสิ่งที่
// อยากให้มี การเทียบข้อความดิบจะทำให้คอมเมนต์นั้นเองทำให้เทสต์ตก แล้วทางแก้
// ที่ง่ายที่สุดคือลบคอมเมนต์ทิ้ง ซึ่งตรงข้ามกับที่เทสต์นี้ต้องการ
// (พลาดท่านี้มาแล้วกับเทสต์ theme.css ในรอบก่อน)
function codeOnly(source: string): string {
  // หั่นสตริงเอา ไม่ใช้ regex และไม่ใช้ escape ของอักขระควบคุม
  // (กฎเดียวกับ lib/sanitize.ts: เขียนเป็นรหัสอักขระ ไม่ใช่ backslash-n)
  const NEWLINE = String.fromCharCode(10);

  const noBlocks = source.split('/*').map((part, index) => (
    index === 0 ? part : part.slice(part.indexOf('*/') + 2)
  )).join(' ');

  return noBlocks
    .split(NEWLINE)
    .map((line) => {
      const at = line.indexOf('//');
      return at === -1 ? line : line.slice(0, at);
    })
    .join(NEWLINE);
}

// ---- ชั้นที่ 7: หน้าที่วาดผลจากไฟล์ ต้องไม่ต่อ innerHTML -------------------

// หน้าแรกเป็นที่เดียวในแอพที่วาดข้อความซึ่งมาจากไฟล์ของคนอื่น
//
// ต่อ innerHTML ตรงนั้นทีเดียว = ทีมที่ชื่อ <img onerror=...> รันสคริปต์ใน
// ต้นทางเดียวกับหน้าคุมงาน แล้วอ่านโทเคนควบคุม overlay ไปได้
// กฎนี้มองไม่เห็นตอนรีวิว เพราะโค้ดที่ผิดอ่านแล้วดูสวยกว่าโค้ดที่ถูก
test('the page that renders an imported file never builds HTML from strings', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'js', 'home.js'), 'utf8'
  );

  const backupSection = codeOnly(source.slice(source.indexOf('// สำรองข้อมูลและกู้คืน')));
  assert.ok(backupSection.length > 500, 'the backup section is in this file');

  ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write'].forEach((bad) => {
    assert.ok(
      !backupSection.includes(bad),
      `home.js builds the restore preview with ${bad} - it must use textContent only`
    );
  });

  // และต้องวาดผ่าน textContent จริงๆ ไม่ใช่แค่ไม่มี innerHTML เพราะไม่ได้วาดอะไรเลย
  assert.ok(backupSection.includes('textContent'), 'it does render the file contents');
});

// ปุ่มกู้คืนต้องถามก่อนเสมอ ไม่ใช่ทำเลยแล้วค่อยบอก
test('restoring asks before it touches anything', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'js', 'home.js'), 'utf8'
  );
  const backupSection = codeOnly(source.slice(source.indexOf('// สำรองข้อมูลและกู้คืน')));

  const previewAt = backupSection.indexOf('/api/backup/preview');
  // หา 'การเรียก' ไม่ใช่ชื่อตัวแปร บรรทัด destructure ที่หัวไฟล์มีชื่อนี้อยู่ก่อนแล้ว
  const confirmAt = backupSection.indexOf('confirmBox({');
  const restoreAt = backupSection.indexOf('/api/backup/restore');

  assert.ok(previewAt > -1 && confirmAt > -1 && restoreAt > -1, 'all three steps exist');
  assert.ok(previewAt < confirmAt, 'the file is read and shown before the question is asked');
  assert.ok(confirmAt < restoreAt, 'and the question is asked before anything is written');
});

// คำปฏิเสธที่คนคุมงานได้เห็น ต้องเป็นภาษาที่เขาเลือกไว้
//
// ข้อความพวกนี้เกิดที่เซิร์ฟเวอร์ แล้วหน้าเว็บส่งผ่าน t() ซึ่งใช้ทั้งประโยค
// เป็นกุญแจ พิมพ์ไม่ตรงกันแม้แต่ตัวเดียว = โผล่เป็นภาษาอังกฤษเงียบๆ
// และคนอ่านจะเจอครึ่งไทยครึ่งอังกฤษ ซึ่งอ่านเหมือนของเสีย
test('every refusal the import can produce has a Thai translation', () => {
  const i18n = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'js', 'lib', 'i18n.js'), 'utf8'
  );

  // เก็บทุกข้อความที่ readBackup คืนออกมาได้ โดยยิงของที่ทำให้มันปฏิเสธจริงๆ
  const refusals = [
    readBackup(null).error,
    readBackup({ format: BACKUP_FORMAT }).error,
    readBackup({ format: BACKUP_FORMAT, version: 99, kind: 'full' }).error,
    readBackup({ format: BACKUP_FORMAT, version: 1, kind: 'tournament' }).error
  ].filter((m): m is string => typeof m === 'string');

  assert.ok(refusals.length >= 4, 'the refusals were actually produced');
  refusals.forEach((message) => {
    assert.ok(
      i18n.includes(`'${message}'`),
      `server refusal has no Thai entry in i18n.js: ${message}`
    );
  });
});

// ---- ตัวช่วยเรียก API ของหน้าเว็บ ต้องบอกชนิดของ body เสมอ -----------------

// fetch() ตั้ง Content-Type เป็น text/plain ให้เองเมื่อ body เป็นสตริง
// ส่วน express.json() แกะเฉพาะ application/json มันจึงข้ามไปเงียบๆ
// req.body กลายเป็น {} แล้วเซิร์ฟเวอร์เดินต่อด้วยค่าเริ่มต้นเหมือนไม่มีอะไรผิด
//
// เจอจริงตอนต่อปุ่มจับสายรอบน็อกเอาต์: ส่ง perGroup = 2 ไป เซิร์ฟเวอร์อ่านไม่เจอ
// เลยได้ค่าต่ำสุดคือ 1 ผ่านเข้ารอบกลุ่มละทีมเดียว โดยไม่มี error ให้เห็น
test('the shared fetch helper always names the type of a body it sends', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'js', 'lib', 'app-client.js'), 'utf8'
  );
  const helper = source.slice(source.indexOf('async function fetchJson'));
  const body = codeOnly(helper.slice(0, helper.indexOf('\n  }')));

  assert.ok(body.includes('Content-Type'), 'fetchJson sets a content type');
  assert.ok(
    /options\.body/.test(body),
    'and it decides based on whether there is a body to describe'
  );
});
