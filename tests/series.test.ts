// เทสต์การเดาผู้ชนะรายเกมจากคะแนนซีรีส์
//
// ตั้ง env ก่อน import อะไรก็ตาม เพราะ config อ่านตอน import
//
// เรื่องที่ต้องถูกที่สุดคือ "เมื่อไหร่ที่ต้องไม่เดา"
// การเดาผิดแล้วเงียบ แย่กว่าการปล่อยว่างไว้ให้คนมากรอกเอง
// เพราะค่าที่ผิดจะไหลเข้าอัตราชนะรายฮีโร่โดยไม่มีใครสังเกต

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-series-test-'));
process.env.ROV_USER_DATA_DIR = path.join(TMP, 'data');
process.env.ROV_USER_MEDIA_DIR = path.join(TMP, 'media');
process.env.CONTROL_TOKEN = '';

const { getStores } = require('../server/store/index') as typeof import('../server/store/index');
const { closeDatabase } = require('../server/store/db') as typeof import('../server/store/db');
const { recordSeriesResult } = require('../server/services/series') as typeof import('../server/services/series');

import { must } from './helpers';

test.after(() => {
  closeDatabase();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ระบบเก็บเอง */ }
});

let cup = 0;

// แมตช์เดียว Bo5 พร้อมเกมที่ "เคยขึ้นจอแล้ว" ตามจำนวนที่ขอ
// สร้างเกมตรงๆ ไม่ผ่าน goLive เพราะเทสต์นี้สนใจแค่การผูกผล ไม่ได้สนใจ overlay
function setup(gameCount: number) {
  const { teams, tournaments, matches, games } = getStores();
  cup += 1;
  const tournament = must(tournaments.create({ name: `Series ${cup}`, format: 'single_elim', bestOf: 5 }).tournament);
  const blue = must(teams.create({ name: `Blue ${cup}` }).team);
  const red = must(teams.create({ name: `Red ${cup}` }).team);
  tournaments.addTeam(tournament.id, blue.id, 0);
  tournaments.addTeam(tournament.id, red.id, 1);
  const match = must(must(matches.generate(tournament.id).matches)[0]);

  for (let no = 1; no <= gameCount; no += 1) {
    games.ensure(match.id, no, {
      blueTeamId: blue.id, redTeamId: red.id, blueName: blue.name, redName: red.name
    });
  }
  return { match, blue, red };
}

const winners = (matchId: string) =>
  getStores().games.forMatch(matchId).map((g) => g.winner);

test('one point to one side records that side as winning the game just played', () => {
  const { match } = setup(1);
  const result = recordSeriesResult(match.id, 1, 0);
  assert.ok(result.match, result.error ?? 'setResult failed');
  assert.deepStrictEqual(winners(match.id), ['blue']);
});

test('the losing side scoring next attributes only the new game', () => {
  const { match } = setup(2);
  recordSeriesResult(match.id, 1, 0);
  recordSeriesResult(match.id, 1, 1);
  assert.deepStrictEqual(winners(match.id), ['blue', 'red'], 'game 1 keeps its winner');
});

test('two points to one side attributes both games, since that is unambiguous', () => {
  const { match } = setup(2);
  recordSeriesResult(match.id, 2, 0);
  assert.deepStrictEqual(winners(match.id), ['blue', 'blue']);
});

// ---- เมื่อไหร่ที่ต้องไม่เดา ----

test('both sides gaining at once is left alone rather than guessed', () => {
  const { match } = setup(3);
  // กรอกทีเดียวตอนจบซีรีส์: รู้ว่าเล่นสามเกม แต่ไม่รู้ว่าเกมไหนใครชนะ
  const result = recordSeriesResult(match.id, 2, 1);
  assert.ok(result.match, result.error ?? 'setResult failed');
  assert.deepStrictEqual(winners(match.id), [null, null, null], 'no invented winners');
});

test('a game that never went on air has nothing to attribute, and none is invented', () => {
  const { match } = setup(0);   // ไม่เคยเปิดแมตช์นี้ขึ้นจอเลย
  recordSeriesResult(match.id, 1, 0);
  assert.deepStrictEqual(getStores().games.forMatch(match.id), [], 'no empty game rows created');
});

// ---- ถอยคะแนนกลับ ----

test('lowering the score clears the winners of games that no longer happened', () => {
  const { match } = setup(3);
  recordSeriesResult(match.id, 1, 0);
  recordSeriesResult(match.id, 1, 1);
  recordSeriesResult(match.id, 2, 1);
  assert.deepStrictEqual(winners(match.id), ['blue', 'red', 'blue']);

  // คนคุมพิมพ์ผิด ถอยกลับเป็น 1-1
  recordSeriesResult(match.id, 1, 1);
  assert.deepStrictEqual(
    winners(match.id), ['blue', 'red', null],
    'game 3 is unplayed again, so its winner must not linger onto the next draft'
  );
});

test('a manual override is not overwritten by a later, unrelated score change', () => {
  const { match } = setup(3);
  const { games } = getStores();
  recordSeriesResult(match.id, 1, 0);

  // คนคุมแก้ผลเกมที่ 1 เอง เพราะระบบเดาผิด
  const first = must(games.forMatch(match.id)[0]);
  games.setWinner(first.id, 'red');

  // แล้วซีรีส์เดินต่อ เกมที่ 2 ฝั่งแดงชนะ
  recordSeriesResult(match.id, 1, 1);

  const all = winners(match.id);
  assert.strictEqual(all[0], 'red', 'the override on game 1 survives');
  assert.strictEqual(all[1], 'red', 'game 2 still gets filled in');
});
