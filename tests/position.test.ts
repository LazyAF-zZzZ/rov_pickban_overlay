// ตำแหน่ง (เลน) ของผู้เล่น
//
// ค่านี้ไม่ใช่แค่ข้อความที่เอาไปโชว์ มันถูกเอาไปต่อเป็นชื่อไฟล์ไอคอนบนกราฟิก
// ออกอากาศ (public/images/positions/<slug>.png) กฎเดียวกับชื่อฮีโร่และ
// domain/media.ts: ชื่อไฟล์ห้ามมาจากข้อความที่ผู้ใช้พิมพ์

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

import { POSITIONS, POSITION_LABELS, isPosition, sanitizePosition } from '../server/domain/position';
import { sanitizeRoster, sanitizeTeamInput } from '../server/domain/team';
import { sanitizeState, defaultState } from '../server/domain/match';
import { PICK_COUNT } from '../server/domain/draft';
import { must } from './helpers';

test('there are exactly the five ROV positions, as filename-safe slugs', () => {
  assert.deepStrictEqual([...POSITIONS], ['jungle', 'carry', 'midlane', 'offlane', 'support']);
  POSITIONS.forEach((slug) => {
    assert.match(slug, /^[a-z]+$/, `${slug} is used as a filename, so it must stay plain lowercase`);
    assert.ok(POSITION_LABELS[slug], `${slug} needs a label people can read`);
  });
});

test('anything that is not one of the five becomes empty, never a filename', () => {
  // ค่าที่ยอมรับ
  assert.strictEqual(sanitizePosition('jungle'), 'jungle');
  assert.strictEqual(sanitizePosition('SUPPORT'), 'support');
  assert.strictEqual(sanitizePosition('  Carry  '), 'carry');
  // ป้ายที่คนอ่าน แปลงกลับเป็น slug ได้ เผื่อค่าที่เคยพิมพ์มือไว้ในช่อง role เดิม
  assert.strictEqual(sanitizePosition('Mid lane'), 'midlane');
  assert.strictEqual(sanitizePosition('Off Lane'), 'offlane');
  assert.strictEqual(sanitizePosition('off-lane'), 'offlane');

  // ค่าที่ต้องถูกปัดทิ้ง — ตัวที่อันตรายคือพวกที่ออกนอกโฟลเดอร์ได้
  ['', '   ', 'roamer', 'top', '../../etc/passwd', '../heroes/airi',
    'jungle.png', 'jungle/../x', null, undefined, 42, {}, []
  ].forEach((bad) => {
    assert.strictEqual(sanitizePosition(bad), '', `${JSON.stringify(bad)} must not survive`);
  });

  assert.ok(isPosition('midlane'));
  assert.ok(!isPosition('Mid lane'), 'isPosition checks the slug itself, it does not normalise');
});

test('the registry keeps a position per player and refuses junk', () => {
  const roster = sanitizeRoster([
    { name: 'ZHAN', position: 'jungle' },
    { name: 'WETZ', position: 'Mid lane' },
    { name: 'NAILIU', position: 'roamer' },
    { name: 'VUXIANG', position: '' },
    { name: 'QQ' }
  ]);

  assert.strictEqual(roster.length, PICK_COUNT);
  assert.deepStrictEqual(roster.map((p) => p.position), ['jungle', 'midlane', '', '', '']);
});

test('a team round-trips its positions through sanitizeTeamInput', () => {
  const team = must(sanitizeTeamInput({
    name: 'FW',
    players: [{ name: 'ZHAN', position: 'support' }]
  }).team);
  assert.strictEqual(must(team.players[0]).position, 'support');
});

// state คือสิ่งที่กราฟิกออกอากาศอ่าน ถ้า positions ไม่รอดมาถึงตรงนี้ ไอคอนก็ไม่ขึ้น
test('positions ride along in the overlay state, one per pick slot', () => {
  const state = sanitizeState({
    teamBlue: { name: 'FW', positions: ['jungle', 'carry', 'nonsense', 'offlane'] }
  });

  assert.strictEqual(state.teamBlue.positions.length, PICK_COUNT, 'always one per pick slot');
  assert.deepStrictEqual(state.teamBlue.positions, ['jungle', 'carry', '', 'offlane', '']);
  // ฝั่งที่ไม่ได้ส่งอะไรมาต้องได้ช่องว่างครบ ไม่ใช่ undefined
  assert.deepStrictEqual(state.teamRed.positions, ['', '', '', '', '']);
  assert.deepStrictEqual(defaultState.teamBlue.positions, ['', '', '', '', '']);
});

// สคริปต์ฝั่งเบราว์เซอร์เป็นแบบคลาสสิก import จาก server/ ไม่ได้ จึงมีสำเนาของรายการนี้
// สองที่ที่หลุดจากกัน = หน้าทะเบียนเสนอตำแหน่งที่เซิร์ฟเวอร์ปัดทิ้ง โดยไม่มีอะไรบอก
test('the browser copy of the position list matches the server', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'js', 'lib', 'team-ui.js'), 'utf8'
  );
  const block = source.slice(source.indexOf('const POSITIONS = ['));
  const pairs = [...block.slice(0, block.indexOf('];')).matchAll(/value:\s*'([^']*)'[^}]*label:\s*'([^']+)'/g)];

  const values = pairs.map((m) => m[1]).filter((v) => v !== '');
  const labels = pairs.filter((m) => m[1] !== '').map((m) => m[2]);

  assert.deepStrictEqual(values, [...POSITIONS], 'team-ui.js offers exactly the server positions');
  assert.deepStrictEqual(labels, POSITIONS.map((p) => POSITION_LABELS[p]), 'and the same labels');
});

// ไอคอนหายไม่ทำให้อะไรพัง แต่โฟลเดอร์กับคำอธิบายต้องมีอยู่
// ไม่งั้นคนที่มาทีหลังไม่รู้ว่าต้องเอาไฟล์ไปวางที่ไหนและตั้งชื่อว่าอะไร
test('the positions folder exists and says which filenames it wants', () => {
  const dir = path.join(__dirname, '..', '..', 'public', 'images', 'positions');
  assert.ok(fs.existsSync(dir), 'public/images/positions is where the icons go');

  const readme = fs.readFileSync(path.join(dir, 'README.txt'), 'utf8');
  POSITIONS.forEach((slug) => {
    assert.ok(readme.includes(`${slug}.png`), `the readme must name ${slug}.png`);
  });
});
