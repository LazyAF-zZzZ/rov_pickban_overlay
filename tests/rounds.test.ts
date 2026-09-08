// รอบ และดราฟต์ของรอบก่อนหน้า
//
// สิ่งที่เทสต์ชุดนี้เฝ้าอยู่จริงๆ มีสามอย่าง และทั้งสามอย่างเสียหายแบบเงียบๆ ทั้งคู่
//
//   1. เดินรอบในทัวร์นาเมนต์ต้องไม่ลบดราฟต์ของรอบที่เพิ่งจบ
//      ตัวบันทึกดราฟต์เกาะอยู่กับ emitState ล้างกระดานก่อนย้ายตัวชี้เมื่อไหร่
//      ความว่างจะถูกเขียนทับเกมนั้นทันที
//   2. เลขรอบกับเลขเกมของซีรีส์ต้องเป็นค่าเดียวกัน ไม่ใช่ตัวนับสองตัวที่บังเอิญตรงกัน
//   3. รอบก่อนหน้าต้องกลับมาครบหลังปิดแอพ ซึ่งแปลว่ามันต้องอ่านจากฐาน ไม่ใช่จาก state

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-rounds-test-'));
process.env.ROV_USER_DATA_DIR = path.join(TMP, 'data');
process.env.ROV_USER_MEDIA_DIR = path.join(TMP, 'media');
process.env.CONTROL_TOKEN = '';

const { getStores } = require('../server/store/index') as typeof import('../server/store/index');
const { closeDatabase } = require('../server/store/db') as typeof import('../server/store/db');
const live = require('../server/services/live-match') as typeof import('../server/services/live-match');
const liveState = require('../server/store/live-state') as typeof import('../server/store/live-state');
const rounds = require('../server/services/rounds') as typeof import('../server/services/rounds');
const { heroesData } = require('../server/domain/heroes') as typeof import('../server/domain/heroes');

import {
  MAX_ROUNDS, FIRST_ROUND, sanitizeRound, sanitizeRounds, sanitizeRoundNumber, hasAnything
} from '../server/domain/rounds';
import { sanitizeState, defaultState } from '../server/domain/match';
import { PICK_COUNT, BAN_COUNT } from '../server/domain/draft';
import { must } from './helpers';

live.attachDraftCapture();

const [HERO_A, HERO_B, HERO_C] = heroesData.heroes;

function setupMatch(bestOf = 5) {
  const { teams, tournaments, matches } = getStores();
  const tournament = must(tournaments.create({
    name: `Cup ${Math.random()}`, format: 'single_elim', bestOf
  }).tournament);
  const blue = must(teams.create({ name: 'FW', players: [{ name: 'ZHAN' }] }).team);
  const red = must(teams.create({ name: 'EA', players: [{ name: 'SRY' }] }).team);
  tournaments.addTeam(tournament.id, blue.id, 0);
  tournaments.addTeam(tournament.id, red.id, 1);
  const drawn = must(matches.generate(tournament.id).matches);
  return { tournament, blue, red, match: must(drawn[0]) };
}

test.after(() => {
  closeDatabase();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ระบบเก็บเอง */ }
});

// ตัวกรอง ---------------------------------------------------------------

test('a round number is always a whole number from 1 up', () => {
  assert.strictEqual(sanitizeRoundNumber(3), 3);
  assert.strictEqual(sanitizeRoundNumber('4'), 4);
  assert.strictEqual(sanitizeRoundNumber(2.8), 2);
  // อ่านไม่ออก = รอบแรก ไม่ใช่ 0 และไม่ใช่ค่าติดลบ
  [undefined, null, 'nonsense', {}, NaN, 0, -5].forEach((bad) => {
    assert.strictEqual(sanitizeRoundNumber(bad), FIRST_ROUND, `${JSON.stringify(bad)}`);
  });
  assert.strictEqual(sanitizeRoundNumber(9999), 99, 'clamped, never unbounded');
});

test('a stored round keeps a full set of slots and drops unknown heroes', () => {
  const record = sanitizeRound({
    round: 2,
    blue: { name: 'FW', picks: [HERO_A, 'not-a-hero'], bans: [HERO_B] },
    red: { name: 'EA', picks: [], bans: [] }
  }, 0);

  assert.strictEqual(record.round, 2);
  assert.strictEqual(record.blue.picks.length, PICK_COUNT, 'one slot per pick, always');
  assert.strictEqual(record.blue.bans.length, BAN_COUNT);
  assert.deepStrictEqual(record.blue.picks.slice(0, 2), [HERO_A, null], 'junk becomes an empty slot');
  assert.strictEqual(record.red.name, 'EA');

  // ฝั่งที่ไม่ได้ส่งอะไรมาเลยต้องได้ชื่อสำรอง ไม่ใช่ค่าว่างที่กราฟิกวาดเป็นช่องเปล่า
  const bare = sanitizeRound({}, 4);
  assert.strictEqual(bare.round, 5, 'no number given means its place in the list');
  assert.strictEqual(bare.blue.name, 'BLUE');
  assert.strictEqual(bare.red.name, 'RED');
});

// เพดานสำคัญจริง ทั้งก้อนนี้ถูกเขียนลง state.json และเดินทางไปกับ stateUpdate
// ทุกวินาทีตอนจับเวลา กองที่โตได้ไม่จำกัดคือไฟล์กับข้อความที่โตได้ไม่จำกัด
test('the pile of rounds is capped, and it is the oldest that goes', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ round: i + 1 }));
  const kept = sanitizeRounds(many);
  assert.strictEqual(kept.length, MAX_ROUNDS);
  assert.deepStrictEqual(sanitizeRounds('nonsense'), []);
  assert.deepStrictEqual(sanitizeRounds(undefined), []);

  // ต้องเหลือรอบท้ายๆ ไม่ใช่รอบแรกๆ
  //
  // fileRound เก็บท้ายสุด ถ้าตัวกรองตัดกลับด้านกัน กองที่ล้นจะหยุดรับรอบใหม่
  // แล้วกราฟิกก็ค้างอยู่กับรอบเก่าตลอดไป โดยที่ทุกอย่างยัง "ทำงาน" อยู่
  assert.strictEqual(must(kept[kept.length - 1]).round, 40, 'the newest round survives');
  assert.strictEqual(must(kept[0]).round, 40 - MAX_ROUNDS + 1);
});

test('an empty board is not a round worth keeping', () => {
  assert.ok(!hasAnything(sanitizeRound({ round: 1 }, 0)));
  assert.ok(hasAnything(sanitizeRound({ round: 1, red: { bans: [HERO_A] } }, 0)));
});

test('round and rounds ride along in the overlay state', () => {
  const state = sanitizeState({ round: 3, rounds: [{ round: 1, blue: { picks: [HERO_A] } }] });
  assert.strictEqual(state.round, 3);
  assert.strictEqual(state.rounds.length, 1);
  assert.strictEqual(must(state.rounds[0]).blue.picks[0], HERO_A);

  assert.strictEqual(defaultState.round, FIRST_ROUND);
  assert.deepStrictEqual(defaultState.rounds, []);
});

// รอบเดิมกับฮีโร่ซ้ำ ---------------------------------------------------

// dropDuplicateHeroes บังคับกฎ "ฮีโร่ตัวหนึ่งอยู่ได้ช่องเดียว" กับกระดานปัจจุบัน
// รอบที่ผ่านไปแล้วเป็นคนละเกม การเลือกฮีโร่ตัวเดิมซ้ำในเกมถัดไปคือเรื่องปกติที่สุด
// ถ้ากฎนั้นเผลอไปกินรอบเก่าด้วย ดราฟต์ย้อนหลังจะค่อยๆ ว่างลงทีละช่องโดยไม่มีใครเห็น
test('a hero picked again in a later round does not erase the earlier one', () => {
  const state = sanitizeState({
    teamBlue: { picks: [HERO_A] },
    rounds: [{ round: 1, blue: { picks: [HERO_A] }, red: { bans: [HERO_A] } }]
  });

  assert.strictEqual(state.teamBlue.picks[0], HERO_A);
  assert.strictEqual(must(state.rounds[0]).blue.picks[0], HERO_A, 'round 1 keeps its own draft');
  assert.strictEqual(must(state.rounds[0]).red.bans[0], HERO_A);
});

// การเดินรอบของแมตช์เดี่ยว ----------------------------------------------

function quickMatch() {
  getStores().liveMatch.clear();
  liveState.setState(sanitizeState({
    teamBlue: { name: 'ALPHA' },
    teamRed: { name: 'BRAVO' }
  }));
}

test('a quick match files the board and starts the next round clean', () => {
  quickMatch();
  const state = liveState.getState();
  state.teamBlue.picks[0] = HERO_A;
  state.teamRed.bans[0] = HERO_B;

  const result = must(live.stepRound(1).result);
  assert.strictEqual(result.round, 2);

  const after = liveState.getState();
  assert.strictEqual(after.round, 2);
  assert.strictEqual(after.teamBlue.picks[0], null, 'the next round starts empty');
  assert.strictEqual(after.rounds.length, 1);
  const filed = must(after.rounds[0]);
  assert.strictEqual(filed.round, 1);
  assert.strictEqual(filed.blue.picks[0], HERO_A);
  assert.strictEqual(filed.red.bans[0], HERO_B);
  assert.strictEqual(filed.blue.name, 'ALPHA', 'the round remembers who played it');
});

test('going back puts the earlier draft back on the board', () => {
  quickMatch();
  liveState.getState().teamBlue.picks[0] = HERO_A;
  live.stepRound(1);
  liveState.getState().teamRed.picks[1] = HERO_C;

  assert.ok(live.stepRound(-1).result, 'stepping back is allowed');
  const back = liveState.getState();
  assert.strictEqual(back.round, 1);
  assert.strictEqual(back.teamBlue.picks[0], HERO_A, 'round 1 is on the board again');

  // และรอบที่เพิ่งออกจากจอต้องไม่หาย กดเดินหน้าอีกทีต้องได้คืน
  assert.ok(live.stepRound(1).result);
  assert.strictEqual(liveState.getState().teamRed.picks[1], HERO_C);
});

test('round 1 is the floor and it says so rather than doing nothing', () => {
  quickMatch();
  const result = live.stepRound(-1);
  assert.strictEqual(result.result, undefined);
  assert.match(String(result.error), /round 1/i);
  assert.strictEqual(liveState.getState().round, 1);
});

// เดินไปกลับที่รอบเดิมต้องไม่ได้ ROUND 2 สองแถวบนจอ
test('walking back and forth does not stack duplicate rounds', () => {
  quickMatch();
  liveState.getState().teamBlue.picks[0] = HERO_A;
  live.stepRound(1);
  live.stepRound(-1);
  live.stepRound(1);
  live.stepRound(-1);

  const numbers = liveState.getState().rounds.map((r) => r.round);
  assert.deepStrictEqual(numbers, [...new Set(numbers)], 'one entry per round number');
});

// ประวัติ undo เป็นของรอบ ไม่ใช่ของทั้งแมตช์
//
// เห็นกับตาแล้วก่อนแก้: ดราฟต์รอบ 1 ครบสี่ตัว เดินไปรอบ 2 เลือกไปหนึ่งตัว
// แล้วกด Ctrl+Z สามครั้ง กระดานรอบ 2 กลายเป็น [airi, aleister] ทั้งที่ aleister
// ไม่เคยถูกเลือกในรอบนั้น มันคือดราฟต์ของรอบ 1 ที่ไหลข้ามมา
// และในโหมดทัวร์นาเมนต์ emit ครั้งถัดไปจะเขียนกระดานที่แต่งขึ้นนั้นลงฐานเป็นของจริง
test('undo cannot reach back into the previous round', () => {
  quickMatch();
  [HERO_A, HERO_B, HERO_C].forEach((hero, i) => {
    liveState.pushUndo();
    liveState.getState().teamBlue.picks[i] = hero;
  });

  must(live.stepRound(1).result);

  liveState.pushUndo();
  liveState.getState().teamBlue.picks[0] = HERO_A;

  // กดรัวกว่าจำนวนที่รอบนี้มีให้ย้อน
  const outcomes = [liveState.popUndo(), liveState.popUndo(), liveState.popUndo()];
  assert.deepStrictEqual(outcomes, [true, false, false], 'only this round is undoable');

  const board = liveState.getState().teamBlue.picks;
  assert.deepStrictEqual(board, [null, null, null, null, null], 'round 2 undoes to empty');
  // และรอบ 1 ที่เก็บไว้ต้องไม่ถูกแตะเลย
  assert.deepStrictEqual(
    must(liveState.getState().rounds[0]).blue.picks.slice(0, 3),
    [HERO_A, HERO_B, HERO_C]
  );
});

// RESET MATCH ล้างทั้งแมตช์ กองรอบเป็นของแมตช์นั้น ต้องไปพร้อมกัน
// ถ้าค้างอยู่ กราฟิกจะโชว์ดราฟต์ของคู่ที่เล่นจบไปแล้วทับคู่ที่กำลังจะขึ้น
test('resetting the match takes the rounds with it', () => {
  quickMatch();
  liveState.getState().teamBlue.picks[0] = HERO_A;
  live.stepRound(1);
  assert.strictEqual(liveState.getState().rounds.length, 1);

  liveState.setState(sanitizeState({}));
  assert.strictEqual(liveState.getState().round, FIRST_ROUND);
  assert.deepStrictEqual(liveState.getState().rounds, []);
});

// การเดินรอบของแมตช์ในทัวร์นาเมนต์ ---------------------------------------

test('in a tournament the round is the series game number, not a second counter', () => {
  const { match } = setupMatch(5);
  must(live.goLive(match.id).live);
  assert.strictEqual(liveState.getState().round, 1);

  liveState.getState().teamBlue.picks[0] = HERO_A;
  liveState.emitState();                       // ตัวบันทึกเกาะอยู่ตรงนี้

  must(live.stepRound(1).result);
  assert.strictEqual(liveState.getState().round, 2);
  assert.strictEqual(must(live.describeLive()).gameNo, 2, 'the pointer moved with it');
});

// ข้อที่สำคัญที่สุดของไฟล์นี้
//
// ล้างกระดานก่อนย้ายตัวชี้เมื่อไหร่ emit ครั้งถัดไปจะเขียนความว่างทับดราฟต์
// ของเกมที่เพิ่งจบ แล้วรอบก่อนหน้าจะกลายเป็นแถวเปล่าตลอดกาล
// เกมนั้นยังนับเป็น draft_locked = 1 อยู่ สถิติทั้งทัวร์นาเมนต์เพี้ยนตามไปด้วย
test('stepping forward in a tournament keeps the draft of the round it just left', () => {
  const { match } = setupMatch(5);
  must(live.goLive(match.id).live);

  const state = liveState.getState();
  state.teamBlue.picks[0] = HERO_A;
  state.teamRed.picks[0] = HERO_B;
  state.teamBlue.bans[0] = HERO_C;
  liveState.emitState();

  must(live.stepRound(1).result);
  liveState.emitState();                       // จังหวะที่เคยเขียนทับ

  const game1 = must(getStores().games.forMatch(match.id).find((g) => g.gameNo === 1));
  const picks = game1.slots.filter((s) => s.kind === 'pick').map((s) => s.hero);
  assert.ok(picks.includes(HERO_A), 'game 1 still has its blue pick');
  assert.ok(picks.includes(HERO_B), 'game 1 still has its red pick');
  assert.ok(game1.slots.some((s) => s.kind === 'ban' && s.hero === HERO_C));
});

test('the previous rounds of a tournament match come from the database', () => {
  const { match } = setupMatch(5);
  must(live.goLive(match.id).live);
  liveState.getState().teamBlue.picks[0] = HERO_A;
  liveState.emitState();

  must(live.stepRound(1).result);
  liveState.getState().teamRed.picks[0] = HERO_B;
  liveState.emitState();

  must(live.stepRound(1).result);
  const state = liveState.getState();
  assert.strictEqual(state.round, 3);
  assert.deepStrictEqual(state.rounds.map((r) => r.round), [1, 2]);
  assert.strictEqual(must(state.rounds[0]).blue.picks[0], HERO_A);
  assert.strictEqual(must(state.rounds[1]).red.picks[0], HERO_B);
  assert.strictEqual(must(state.rounds[0]).blue.name, 'FW', 'names come from the frozen copy');

  // และมันมาจากฐาน ไม่ใช่จาก state ก้อนเดิม: เอาแมตช์ขึ้นจอใหม่แล้วต้องยังอยู่ครบ
  // (goLive สร้าง state ใหม่ทั้งก้อนจากค่าเริ่มต้นทุกครั้ง)
  must(live.goLive(match.id, 3).live);
  assert.deepStrictEqual(liveState.getState().rounds.map((r) => r.round), [1, 2]);
});

// เกมที่ถูกจองแถวไว้ตั้งแต่ตอนจับคู่แต่ยังไม่มีใครเล่น ต้องไม่กลายเป็นแถบว่างบนอากาศ
test('a game nobody has drafted yet is not shown as a previous round', () => {
  const { match } = setupMatch(5);
  must(live.goLive(match.id).live);
  must(live.stepRound(1).result);              // ข้ามเกมที่ 1 ไปทั้งที่ยังว่าง

  assert.deepStrictEqual(liveState.getState().rounds, []);
});

// ซีรีส์มีเกมได้เท่าที่กติกาบอก ---------------------------------------

test('a series cannot be walked past its own length', () => {
  const { match } = setupMatch(3);
  must(live.goLive(match.id).live);

  must(live.stepRound(1).result);
  must(live.stepRound(1).result);
  assert.strictEqual(liveState.getState().round, 3);

  const refused = live.stepRound(1);
  assert.strictEqual(refused.result, undefined);
  assert.match(String(refused.error), /no more games/i);
  assert.strictEqual(liveState.getState().round, 3, 'and it stayed put');

  // ที่สำคัญกว่าตัวเลขบนจอ: ต้องไม่มีแถวเกมที่ 4 งอกอยู่ในฐาน
  const numbers = getStores().games.forMatch(match.id).map((g) => g.gameNo).sort();
  assert.deepStrictEqual(numbers, [1, 2, 3]);
});

// เอาแมตช์ที่เล่นจบแล้วขึ้นจอดูอีกรอบ เป็นเรื่องปกติ ไม่ควรสร้างขยะทิ้งไว้
//
// nextGameNo คือคะแนนรวม + 1 ซีรีส์ Bo3 ที่จบด้วย 2-1 จึงได้เลข 4
// ซึ่งเป็นเกมที่ไม่มีวันมีอยู่จริง ของเดิมสร้างแถวเปล่านั้นขึ้นมาทุกครั้งที่กดดู
test('re-airing a finished series opens its last game, not an invented one', () => {
  const { match } = setupMatch(3);
  const { matches } = getStores();
  must(matches.setResult(match.id, 2, 1).match);

  must(live.goLive(match.id).live);
  assert.strictEqual(liveState.getState().round, 3, 'the last game that was actually played');

  const numbers = getStores().games.forMatch(match.id).map((g) => g.gameNo).sort();
  assert.ok(!numbers.includes(4), `no game 4 row was created (got ${numbers.join(',')})`);
});

// การตัดที่ bestOf อย่างเดียวไม่พอ และนี่คือเคสที่พิสูจน์
//
// Bo5 ที่จบ 3-0 เล่นไปแค่สามเกม แต่คะแนนรวม + 1 ได้ 4 ซึ่งยังไม่เกิน 5
// จึงรอดด่านที่ตัดตาม bestOf ไปได้ วัดจริงก่อนแก้: ขึ้นจอเป็น GAME 4
// และในฐานเหลือแถวเกมเลข 1 กับ 4 โดยไม่มี 2 กับ 3 เลย
// คำถามที่ถูกคือ "ซีรีส์จบหรือยัง" ไม่ใช่ "เลขเกินกติกาไหม"
test('a series won without going the distance re-airs at the game it ended on', () => {
  const { match } = setupMatch(5);
  const { matches, games } = getStores();
  must(matches.setResult(match.id, 3, 0).match);

  must(live.goLive(match.id).live);
  assert.strictEqual(liveState.getState().round, 3, 'it ended on game 3, so game 3 goes up');

  const numbers = games.forMatch(match.id).map((g) => g.gameNo).sort();
  assert.ok(!numbers.includes(4), `no phantom game 4 (got ${numbers.join(',')})`);
});

// ยังไม่จบ ก็ต้องได้เกมถัดไปตามปกติ การแก้ข้างบนต้องไม่ไปกินเคสนี้
test('an undecided series still opens the game that has not been played', () => {
  const { match } = setupMatch(5);
  must(getStores().matches.setResult(match.id, 2, 1).match);

  must(live.goLive(match.id).live);
  assert.strictEqual(liveState.getState().round, 4, '2-1 in a Bo5 means game 4 is next');
});

// สลับฝั่งกลางซีรีส์ -----------------------------------------------------
//
// กระดานย้อนหลังต้องวางคอลัมน์ให้ตรงกับแถบหลักที่ออกอากาศอยู่
// ไม่งั้นคนดูเห็นสองทีมสลับที่กันระหว่างสองกราฟิกในฉากเดียวกัน
test('switching sides also flips the earlier rounds, and the names follow', () => {
  const { match } = setupMatch(5);
  must(live.goLive(match.id).live);
  liveState.getState().teamBlue.picks[0] = HERO_A;   // FW เลือก
  liveState.emitState();
  must(live.stepRound(1).result);

  const before = must(liveState.getState().rounds[0]);
  assert.strictEqual(before.blue.name, 'FW');
  assert.strictEqual(before.blue.picks[0], HERO_A);

  // สลับฝั่งบนจอ แล้วประกอบรอบก่อนหน้าใหม่ด้วยสายตาของจอที่สลับแล้ว
  const swapped = liveState.getState();
  const keep = swapped.teamBlue;
  swapped.teamBlue = swapped.teamRed;
  swapped.teamRed = keep;

  const after = must(rounds.roundsBefore(match.id, 2, swapped)[0]);
  assert.strictEqual(after.red.name, 'FW', 'FW is on the right now, in the old round too');
  assert.strictEqual(after.red.picks[0], HERO_A);
  assert.strictEqual(after.blue.name, 'EA');
});
