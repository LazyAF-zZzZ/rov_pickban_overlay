// เทสต์ว่าโลโก้รู้ว่าตัวเองอยู่ไฟล์ไหน
//
// ตั้ง env ก่อน import อะไรก็ตาม เพราะ config อ่านตอน import
//
// เดิมชื่อไฟล์ถูกเดาจาก "ฝั่ง" (น้ำเงิน = blue-team เสมอ) ซึ่งพังสองแบบ:
//   1. สลับฝั่งแล้วข้อมูลสลับ แต่ไฟล์ไม่สลับ ภาพจึงไม่เปลี่ยน
//   2. เอาแมตช์ทัวร์นาเมนต์ขึ้นจอ แล้ว overlay ไปเปิดไฟล์ของช่องน้ำเงิน
//      ซึ่งเป็นภาพของทีมอื่นที่ค้างอยู่ ไม่ใช่ของทีมที่กำลังแข่ง

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-logosrc-test-'));
process.env.ROV_USER_DATA_DIR = path.join(TMP, 'data');
process.env.ROV_USER_MEDIA_DIR = path.join(TMP, 'media');
process.env.CONTROL_TOKEN = '';

const { getStores } = require('../server/store/index') as typeof import('../server/store/index');
const { closeDatabase } = require('../server/store/db') as typeof import('../server/store/db');
const live = require('../server/services/live-match') as typeof import('../server/services/live-match');
const liveState = require('../server/store/live-state') as typeof import('../server/store/live-state');
const media = require('../server/domain/media') as typeof import('../server/domain/media');

import { must } from './helpers';

test.after(() => {
  closeDatabase();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ระบบเก็บเอง */ }
});

// ---- sanitizeLogo ----

test('a logo remembers which file holds it, and refuses a made-up one', () => {
  const slot = media.sanitizeLogo({ v: 5, ext: 'png', src: 'blue-team' });
  assert.strictEqual(slot.src, 'blue-team', 'a match slot name is a valid source');

  const registry = media.sanitizeLogo({ v: 5, ext: 'png', src: 't9f2a1' });
  assert.strictEqual(registry.src, 't9f2a1', 'a registry team id is too');

  // ชื่อไฟล์ห้ามมาจากข้อความที่ผู้ใช้พิมพ์ ไม่งั้นหลุดออกนอกโฟลเดอร์ได้
  const evil = media.sanitizeLogo({ v: 5, ext: 'png', src: '../../etc/passwd' });
  assert.strictEqual(evil.src, undefined, 'a path is not a source');
  assert.strictEqual(media.sanitizeLogo({ v: 5, ext: 'png', src: 42 }).src, undefined);
});

test('a logo saved before this field existed still loads', () => {
  const old = media.sanitizeLogo({ v: 7, ext: 'png' });
  assert.deepStrictEqual(old, { v: 7, ext: 'png' }, 'no src, and that is fine');
});

// ---- สลับฝั่ง ----

test('switching teams carries each logo with its own team', () => {
  const state = liveState.getState();
  state.teamBlue.logo = { v: 111, ext: 'png', src: 'blue-team' };
  state.teamRed.logo = { v: 222, ext: 'webp', src: 'red-team' };

  // สลับแบบเดียวกับที่ socket handler ทำ
  const swap = state.teamBlue;
  state.teamBlue = state.teamRed;
  state.teamRed = swap;

  assert.deepStrictEqual(
    liveState.getState().teamBlue.logo, { v: 222, ext: 'webp', src: 'red-team' },
    'the blue side now shows the file that belongs to the team standing there'
  );
  assert.strictEqual(liveState.getState().teamRed.logo.src, 'blue-team');
});

// ---- แมตช์ของทัวร์นาเมนต์ ----

test('going live points the overlay at the registry logo, not the slot file', () => {
  const { teams, tournaments, matches } = getStores();
  const tournament = must(tournaments.create({ name: 'Logo cup', format: 'single_elim' }).tournament);
  const blue = must(teams.create({ name: 'Has Logo' }).team);
  const red = must(teams.create({ name: 'No Logo' }).team);
  teams.setLogo(blue.id, { v: 999, ext: 'png' });
  tournaments.addTeam(tournament.id, blue.id, 0);
  tournaments.addTeam(tournament.id, red.id, 1);
  const match = must(must(matches.generate(tournament.id).matches)[0]);

  const result = live.goLive(match.id);
  assert.ok(result.live, result.error ?? 'goLive failed');

  const state = liveState.getState();
  assert.strictEqual(
    state.teamBlue.logo.src, blue.id,
    'the file named is the registry team, not blue-team'
  );
  assert.strictEqual(state.teamBlue.logo.ext, 'png');
  assert.notStrictEqual(state.teamBlue.logo.src, 'blue-team', 'this was the bug');
});
