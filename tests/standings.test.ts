// ตารางคะแนน และการเลื่อนชั้นเข้ารอบน็อกเอาต์
//
// ก่อนหน้านี้แอพสร้างคู่ในกลุ่มให้ครบแล้วปล่อยมือ คนจัดต้องนับคะแนนเองบนกระดาษ
// แล้วไปสร้างทัวร์นาเมนต์ที่สองเพื่อจับสายรอบน็อกเอาต์ ซึ่งทำให้ผลรอบแบ่งกลุ่ม
// กับรอบน็อกเอาต์กลายเป็นสองรายการที่ไม่รู้จักกัน และสถิติก็นับเป็นสองงาน
//
// สิ่งที่ต้องถูกที่สุดคือ "ตอนไหนที่ยังตัดสินไม่ได้" การเดาแทนคนจัดตรงนั้น
// แปลว่าทีมผิดได้ไปต่อ แล้วกว่าจะรู้ตัวก็จับสายและเล่นไปแล้ว

import test from 'node:test';
import assert from 'node:assert';

import type { StandingsMatch } from '../server/domain/standings';
import {
  buildGroup, buildStandings, groupsOf, promoteFromGroups, WIN_POINTS
} from '../server/domain/standings';
import { must } from './helpers';

function played(
  bracket: string, a: string, b: string, scoreA: number, scoreB: number
): StandingsMatch {
  const winnerId = scoreA > scoreB ? a : b;
  return {
    bracket, teamAId: a, teamBId: b,
    status: 'complete', scoreA, scoreB, winnerId, isBye: false
  };
}

function pending(bracket: string, a: string, b: string): StandingsMatch {
  return {
    bracket, teamAId: a, teamBId: b,
    status: 'pending', scoreA: 0, scoreB: 0, winnerId: null, isBye: false
  };
}

test('a win is three points and a loss is none', () => {
  const group = buildGroup('A', ['x', 'y'], [played('A', 'x', 'y', 2, 0)]);

  const x = must(group.rows.find((r) => r.teamId === 'x'));
  const y = must(group.rows.find((r) => r.teamId === 'y'));

  assert.strictEqual(x.points, WIN_POINTS);
  assert.strictEqual(y.points, 0);
  assert.deepStrictEqual([x.played, x.won, x.lost], [1, 1, 0]);
  assert.deepStrictEqual([y.played, y.won, y.lost], [1, 0, 1]);
  assert.deepStrictEqual([x.gamesWon, x.gamesLost, x.gameDiff], [2, 0, 2]);
  assert.deepStrictEqual([y.gamesWon, y.gamesLost, y.gameDiff], [0, 2, -2]);
});

// ทีมที่ยังไม่ได้ลงเล่นต้องมีแถวของตัวเอง ไม่ใช่หายไปจากตาราง
// ตารางที่ไม่มีชื่อทีมอยู่เลย อ่านแล้วเหมือนทีมนั้นไม่ได้ลงแข่ง
test('a team that has not played yet still appears, on zero', () => {
  const group = buildGroup('A', ['x', 'y', 'z'], [played('A', 'x', 'y', 2, 1)]);

  assert.strictEqual(group.rows.length, 3);
  const z = must(group.rows.find((r) => r.teamId === 'z'));
  assert.deepStrictEqual([z.played, z.points], [0, 0]);

  // ทีมที่ยังไม่ได้เล่น (ผลต่างเกม 0) อยู่เหนือทีมที่แพ้ไปแล้ว (ผลต่าง -1)
  // ทั้งคู่ยังไม่มีแต้ม ผลต่างเกมจึงเป็นตัวแยก ซึ่งตรงกับตารางกีฬาทั่วไป
  assert.deepStrictEqual(group.rows.map((r) => r.teamId), ['x', 'z', 'y']);
  assert.strictEqual(z.rank, 2);
});

test('matches that are not finished are counted as still to play', () => {
  const group = buildGroup('A', ['x', 'y', 'z'], [
    played('A', 'x', 'y', 2, 0),
    pending('A', 'x', 'z'),
    pending('A', 'y', 'z')
  ]);

  assert.strictEqual(group.remaining, 2);
  assert.strictEqual(must(group.rows.find((r) => r.teamId === 'x')).played, 1);
});

test('game difference breaks a tie on points, and games won breaks that', () => {
  // ทั้งคู่ชนะหนึ่งแพ้หนึ่ง แต่ผลต่างเกมต่างกัน
  const group = buildGroup('A', ['x', 'y', 'z'], [
    played('A', 'x', 'z', 2, 0),
    played('A', 'y', 'x', 2, 1),
    played('A', 'z', 'y', 2, 1)
  ]);

  const order = group.rows.map((r) => r.teamId);
  const x = must(group.rows.find((r) => r.teamId === 'x'));
  const y = must(group.rows.find((r) => r.teamId === 'y'));
  const z = must(group.rows.find((r) => r.teamId === 'z'));

  assert.strictEqual(x.points, y.points, 'all three won once');
  assert.strictEqual(y.points, z.points);
  assert.deepStrictEqual([x.gameDiff, y.gameDiff, z.gameDiff], [1, 0, -1]);
  assert.deepStrictEqual(order, ['x', 'y', 'z'], 'sorted by game difference');
});

// เท่ากันทุกตัวชี้วัด ต้องบอกว่าเท่ากัน ไม่ใช่เรียงมั่วแล้วทำเป็นว่าตัดสินได้
test('teams level on every measure share a rank and are marked tied', () => {
  const group = buildGroup('A', ['x', 'y', 'z', 'w'], [
    played('A', 'x', 'z', 2, 0),
    played('A', 'y', 'w', 2, 0)
  ]);

  const x = must(group.rows.find((r) => r.teamId === 'x'));
  const y = must(group.rows.find((r) => r.teamId === 'y'));
  assert.strictEqual(x.rank, y.rank, 'level teams get the same rank');
  assert.ok(x.tied && y.tied, 'and the page can say so');

  // อันดับแบบแข่งขัน: 1, 1, 3, 3 ไม่ใช่ 1, 1, 2, 2
  assert.deepStrictEqual(group.rows.map((r) => r.rank), [1, 1, 3, 3]);
});

test('every group in the tournament is built, and groups come from the fixtures', () => {
  const matches = [
    played('A', 'a1', 'a2', 2, 0),
    played('B', 'b1', 'b2', 2, 1),
    pending('B', 'b1', 'b3')
  ];

  assert.deepStrictEqual([...groupsOf(matches).keys()], ['A', 'B']);
  const groups = buildStandings(matches);
  assert.deepStrictEqual(groups.map((g) => g.bracket), ['A', 'B']);
  assert.strictEqual(must(groups[1]).rows.length, 3, 'B has three teams from its fixtures');
  assert.strictEqual(must(groups[1]).remaining, 1);
});

// ---- การเลื่อนชั้น ---------------------------------------------------

function twoFinishedGroups() {
  return buildStandings([
    played('A', 'a1', 'a2', 2, 0),
    played('A', 'a1', 'a3', 2, 0),
    played('A', 'a2', 'a3', 2, 1),
    played('B', 'b1', 'b2', 2, 0),
    played('B', 'b1', 'b3', 2, 0),
    played('B', 'b2', 'b3', 2, 1)
  ]);
}

test('the top of each group goes through, seeded so group winners meet late', () => {
  const result = promoteFromGroups(twoFinishedGroups(), 2);
  // ที่ 1 ของทุกกลุ่มก่อน แล้วค่อยที่ 2 — หัวกลุ่มจะได้ไม่เจอกันในรอบแรก
  assert.deepStrictEqual(must(result.teamIds), ['a1', 'b1', 'a2', 'b2']);
});

test('promotion waits until the groups have actually finished', () => {
  const groups = buildStandings([
    played('A', 'a1', 'a2', 2, 0),
    pending('A', 'a1', 'a3')
  ]);
  const result = promoteFromGroups(groups, 1);
  assert.strictEqual(result.teamIds, undefined);
  assert.match(String(result.error), /still has matches to play/i);
});

// ข้อที่สำคัญที่สุดของไฟล์นี้
//
// เสมอกันพอดีที่เส้นตัด แล้วโปรแกรมเลือกให้เอง = ทีมผิดได้ไปต่อ
// และกว่าจะรู้ตัวก็จับสายและเล่นกันไปแล้ว ปฏิเสธแล้วบอกให้ไปตัดสินเองดีกว่ามาก
test('a tie on the cut line stops the promotion instead of guessing', () => {
  const groups = buildStandings([
    // ทั้งสี่ทีมชนะคนละหนึ่ง แพ้คนละหนึ่ง ผลต่างเกมเท่ากันหมด
    played('A', 'a1', 'a2', 2, 1),
    played('A', 'a3', 'a4', 2, 1),
    played('A', 'a2', 'a3', 2, 1),
    played('A', 'a4', 'a1', 2, 1)
  ]);

  const result = promoteFromGroups(groups, 2);
  assert.strictEqual(result.teamIds, undefined);
  assert.match(String(result.error), /tied on the cut line/i);
});

test('promotion refuses what it cannot do rather than half doing it', () => {
  assert.match(String(promoteFromGroups([], 2).error), /no groups/i);
  assert.match(String(promoteFromGroups(twoFinishedGroups(), 0).error), /at least one team/i);
  assert.match(String(promoteFromGroups(twoFinishedGroups(), 9).error), /only 3 teams/i);

  // กลุ่มเดียวเอาไปต่อทีมเดียว ไม่ใช่รอบน็อกเอาต์
  const single = buildStandings([played('A', 'a1', 'a2', 2, 0)]);
  assert.match(String(promoteFromGroups(single, 1).error), /at least two teams/i);
});

// บายไม่ใช่นัดที่ใครลงเล่น ต้องไม่ให้แต้มใคร
test('a bye is not a win', () => {
  const group = buildGroup('A', ['x', 'y'], [
    { bracket: 'A', teamAId: 'x', teamBId: null, status: 'complete', scoreA: 0, scoreB: 0, winnerId: 'x', isBye: true }
  ]);
  assert.strictEqual(must(group.rows.find((r) => r.teamId === 'x')).points, 0);
  assert.strictEqual(group.remaining, 0);
});
