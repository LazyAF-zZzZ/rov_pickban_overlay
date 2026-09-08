// เทสต์สถิติ pick/ban
//
// ตั้ง env ก่อน import อะไรก็ตาม เพราะ config อ่านตอน import
//
// เรื่องที่ตั้งใจจับ:
//   1. ตัวหารเป็น "จำนวนเกม" ไม่ใช่ "จำนวนช่องในดราฟต์"
//   2. เกมที่ดราฟต์ยังไม่ครบต้องไม่ถูกนับ ทั้งตัวเศษและตัวหาร
//   3. อัตราชนะหารด้วยเกมที่ "รู้ผลแล้ว" ไม่ใช่เกมที่ถูกเลือกทั้งหมด
//   4. อันดับการแบนนับเฉพาะการแบนเฟสแรก

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-analytics-test-'));
process.env.ROV_USER_DATA_DIR = path.join(TMP, 'data');
process.env.ROV_USER_MEDIA_DIR = path.join(TMP, 'media');
process.env.CONTROL_TOKEN = '';

const { getStores } = require('../server/store/index') as typeof import('../server/store/index');
const { closeDatabase } = require('../server/store/db') as typeof import('../server/store/db');
const live = require('../server/services/live-match') as typeof import('../server/services/live-match');
const liveState = require('../server/store/live-state') as typeof import('../server/store/live-state');
const { heroesData } = require('../server/domain/heroes') as typeof import('../server/domain/heroes');
const analytics = require('../server/domain/analytics') as typeof import('../server/domain/analytics');
const { defaultState, sanitizeState } = require('../server/domain/match') as typeof import('../server/domain/match');
const { carryOverSettings } = require('../server/domain/settings') as typeof import('../server/domain/settings');

import type { Team } from '../server/domain/team';
import { must } from './helpers';

live.attachDraftCapture();

test.after(() => {
  closeDatabase();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ระบบเก็บเอง */ }
});

// HELPERS ------------------------------------------------------------

let cupNo = 0;

function twoTeamCup(name: string): { tournamentId: string; matchId: string; blue: Team; red: Team } {
  const { teams, tournaments, matches } = getStores();
  cupNo += 1;
  const tournament = must(tournaments.create({ name, format: 'single_elim', bestOf: 3 }).tournament);
  const blue = must(teams.create({ name: `Blue ${cupNo}` }).team);
  const red = must(teams.create({ name: `Red ${cupNo}` }).team);
  tournaments.addTeam(tournament.id, blue.id, 0);
  tournaments.addTeam(tournament.id, red.id, 1);
  const drawn = must(matches.generate(tournament.id).matches);
  return { tournamentId: tournament.id, matchId: must(drawn[0]).id, blue, red };
}

// เติมดราฟต์ให้ครบทั้ง 18 ช่อง แล้วปล่อยให้ตัวบันทึกทำงานเอง
// ระบุฮีโร่ที่สนใจได้ ที่เหลือเติมด้วยตัวอื่นที่ไม่ซ้ำ
function playFullDraft(gameId: string, wanted: {
  bluePicks?: string[]; redPicks?: string[]; blueBans?: string[]; redBans?: string[];
} = {}): void {
  const used = new Set<string>([
    ...(wanted.bluePicks || []), ...(wanted.redPicks || []),
    ...(wanted.blueBans || []), ...(wanted.redBans || [])
  ]);
  const spare = heroesData.heroes.filter((h) => !used.has(h));
  let cursor = 0;
  const fill = (given: string[] | undefined, count: number): string[] =>
    Array.from({ length: count }, (_, i) => given?.[i] || must(spare[cursor++]));

  const state = liveState.getState();
  state.teamBlue.picks = fill(wanted.bluePicks, 5);
  state.teamRed.picks = fill(wanted.redPicks, 5);
  state.teamBlue.bans = fill(wanted.blueBans, 4);
  state.teamRed.bans = fill(wanted.redBans, 4);
  liveState.emitState();

  assert.strictEqual(must(getStores().games.get(gameId)).draftLocked, true, 'draft should be locked');
}

function statFor(hero: string, scope = {}) {
  const raw = getStores().analytics.read(scope);
  const stats = analytics.toHeroStats(raw.counts, raw.games);
  return { stat: stats.find((s) => s.hero === hero), games: raw.games, decided: raw.decidedGames };
}

const [A, B, C, D] = heroesData.heroes as string[];

// TESTS --------------------------------------------------------------

test('rates divide by games, not by draft slots', () => {
  const cup = twoTeamCup('Denominator cup');
  const gameId = must(must(live.goLive(cup.matchId).live).gameId);
  playFullDraft(gameId, { bluePicks: [must(A)] });

  const { stat, games } = statFor(must(A), { tournamentId: cup.tournamentId });
  assert.strictEqual(games, 1);
  // หารด้วยช่อง (18) จะได้ 5.6% หารด้วยเกมได้ 100% ซึ่งคือสิ่งที่ต้องการ
  assert.strictEqual(must(stat).picked, 1);
  assert.strictEqual(must(stat).pickRate, 1, 'picked in the only game = 100%');
  assert.strictEqual(must(stat).presence, 1);
});

test('a draft that never completed is counted nowhere', () => {
  const cup = twoTeamCup('Half draft cup');
  const gameId = must(must(live.goLive(cup.matchId).live).gameId);

  // เลือกแค่ตัวเดียวแล้วหยุด ดราฟต์ไม่ล็อก
  const state = liveState.getState();
  state.teamBlue.picks[0] = must(B);
  liveState.emitState();

  assert.strictEqual(must(getStores().games.get(gameId)).draftLocked, false);

  const { stat, games } = statFor(must(B), { tournamentId: cup.tournamentId });
  assert.strictEqual(games, 0, 'an unfinished draft does not inflate the denominator');
  assert.strictEqual(stat, undefined, 'and contributes no numerator either');
});

test('presence counts a hero that was banned as well as one that was picked', () => {
  const cup = twoTeamCup('Presence cup');
  const gameId = must(must(live.goLive(cup.matchId).live).gameId);
  playFullDraft(gameId, { bluePicks: [must(A)], redBans: [must(C)] });

  const scope = { tournamentId: cup.tournamentId };
  const picked = must(statFor(must(A), scope).stat);
  const banned = must(statFor(must(C), scope).stat);

  assert.strictEqual(picked.pickRate, 1);
  assert.strictEqual(picked.banRate, 0);
  assert.strictEqual(picked.presence, 1);

  assert.strictEqual(banned.pickRate, 0);
  assert.strictEqual(banned.banRate, 1);
  assert.strictEqual(banned.presence, 1, 'banned counts towards presence too');
});

test('ban priority only counts first-phase bans', () => {
  const cup = twoTeamCup('Priority cup');
  const gameId = must(must(live.goLive(cup.matchId).live).gameId);
  // ช่อง 0-1 คือเฟสแบนแรก ช่อง 2-3 คือเฟสที่สอง
  playFullDraft(gameId, { blueBans: [must(A), must(B), must(C), must(D)] });

  const scope = { tournamentId: cup.tournamentId };
  const first = must(statFor(must(A), scope).stat);
  const second = must(statFor(must(C), scope).stat);

  assert.strictEqual(first.earlyBans, 1);
  assert.ok(first.banPriority !== null, 'a first-phase ban is ranked');
  assert.strictEqual(second.banned, 1, 'still counted as a ban');
  assert.strictEqual(second.earlyBans, 0, 'but not as a first-phase one');
  assert.strictEqual(second.banPriority, null, 'so it gets no priority rank');
});

// ---- อัตราชนะ ----

test('win rate is null until a game winner is recorded, not zero', () => {
  const cup = twoTeamCup('Unknown winner cup');
  const gameId = must(must(live.goLive(cup.matchId).live).gameId);
  playFullDraft(gameId, { bluePicks: [must(A)] });

  const { stat, decided } = statFor(must(A), { tournamentId: cup.tournamentId });
  assert.strictEqual(decided, 0);
  assert.strictEqual(must(stat).decided, 0);
  assert.strictEqual(must(stat).winRate, null, 'no winner recorded is not the same as never winning');
});

test('win rate divides by games with a recorded winner, and follows the side that won', () => {
  const cup = twoTeamCup('Winner cup');
  const gameId = must(must(live.goLive(cup.matchId).live).gameId);
  playFullDraft(gameId, { bluePicks: [must(A)], redPicks: [must(B)] });

  getStores().games.setWinner(gameId, 'blue');

  const scope = { tournamentId: cup.tournamentId };
  const winner = must(statFor(must(A), scope).stat);
  const loser = must(statFor(must(B), scope).stat);

  assert.strictEqual(winner.wins, 1);
  assert.strictEqual(winner.decided, 1);
  assert.strictEqual(winner.winRate, 1, 'picked by the winning side');

  assert.strictEqual(loser.wins, 0);
  assert.strictEqual(loser.decided, 1);
  assert.strictEqual(loser.winRate, 0, 'picked by the losing side');
});

// ---- ขอบเขต ----

test('a tournament scope excludes games from other tournaments', () => {
  const one = twoTeamCup('Scope cup one');
  const two = twoTeamCup('Scope cup two');

  playFullDraft(must(must(live.goLive(one.matchId).live).gameId), { bluePicks: [must(A)] });
  playFullDraft(must(must(live.goLive(two.matchId).live).gameId), { bluePicks: [must(A)] });

  assert.strictEqual(statFor(must(A), { tournamentId: one.tournamentId }).games, 1);
  assert.strictEqual(statFor(must(A), { tournamentId: two.tournamentId }).games, 1);
  // ขอบเขตรวมเห็นทั้งสอง บวกกับเกมของเทสต์อื่นที่รันมาก่อน
  assert.ok(statFor(must(A), {}).games >= 2, 'the unscoped view sees both');
});

test('a team scope counts only the side that team was on', () => {
  const cup = twoTeamCup('Team scope cup');
  const gameId = must(must(live.goLive(cup.matchId).live).gameId);
  // ฝั่งน้ำเงินคือทีม A ของแมตช์ (goLive วางฝั่ง A เป็นน้ำเงิน)
  playFullDraft(gameId, { bluePicks: [must(A)], redPicks: [must(B)] });

  const blueScope = { teamId: cup.blue.id };
  const ourPick = must(statFor(must(A), blueScope).stat);
  const theirPick = statFor(must(B), blueScope).stat;

  assert.strictEqual(ourPick.picked, 1, 'our own pick is counted');
  assert.strictEqual(theirPick, undefined, 'the opponent pick is not our statistic');
  assert.strictEqual(statFor(must(A), blueScope).games, 1);
});

// สลับฝั่งบนจอแล้ว ดราฟต์ต้องยังถูกบันทึกให้ถูกทีม
//
// ปุ่ม "สลับฝั่ง" บนหน้า Control สลับเฉพาะสิ่งที่เห็นบนจอ ไม่ได้แตะสำเนาแช่แข็งของเกม
// (ซึ่งตรึงไว้ว่า blue = ทีม A ของแมตช์) ถ้าตัวบันทึกเขียนช่องตามฝั่งที่เห็น
// ดราฟต์ของสองทีมจะถูกบันทึกสลับตัวกันทั้งชุด และไม่มีอะไรบนจอบอกว่าผิด
//
// เคยพังจริงและพังเงียบมาก: สถิติรายทีมคืนฮีโร่ของคู่แข่งมาทั้งหมด
// และอัตราชนะรายฮีโร่กลับด้าน เพราะ g.winner เก็บในมุมของแมตช์ ส่วน s.side เก็บในมุมของจอ
test('swapping sides on the overlay still records the draft against the right team', () => {
  const cup = twoTeamCup('Swapped cup');
  const gameId = must(must(live.goLive(cup.matchId).live).gameId);

  // สลับฝั่ง ทำแบบเดียวกับ handler ของ switchTeams เป๊ะๆ
  const state = liveState.getState();
  const held = JSON.parse(JSON.stringify(state.teamBlue));
  state.teamBlue = JSON.parse(JSON.stringify(state.teamRed));
  state.teamRed = held;
  liveState.emitState();

  // ตอนนี้ช่อง "น้ำเงิน" บนจอคือทีมแดงของแมตช์ ฮีโร่ A จึงเป็นของทีมแดง
  playFullDraft(gameId, { bluePicks: [must(A)], redPicks: [must(B)] });

  const forRed = statFor(must(A), { teamId: cup.red.id }).stat;
  const forBlue = statFor(must(A), { teamId: cup.blue.id }).stat;
  assert.strictEqual(must(forRed).picked, 1, 'the hero belongs to whoever actually picked it');
  assert.strictEqual(forBlue, undefined, 'and not to the team it was shown next to');

  // ฮีโร่ของอีกฝั่งต้องสลับกันด้วย ไม่ใช่ถูกแค่ข้างเดียว
  assert.strictEqual(must(statFor(must(B), { teamId: cup.blue.id }).stat).picked, 1);
  assert.strictEqual(statFor(must(B), { teamId: cup.red.id }).stat, undefined);

  // ทีม A ของแมตช์ (ที่ตอนนี้อยู่ช่องแดงบนจอ) ชนะเกมนี้
  // ฮีโร่ A เป็นของทีมแดงซึ่งแพ้ จึงต้องนับเป็นแพ้ ไม่ใช่ชนะ
  getStores().games.setWinner(gameId, 'blue');
  const scoped = must(statFor(must(A), { tournamentId: cup.tournamentId }).stat);
  assert.strictEqual(scoped.decided, 1);
  assert.strictEqual(scoped.wins, 0, 'the losing side\'s hero must not be counted as a win');
  assert.strictEqual(must(statFor(must(B), { tournamentId: cup.tournamentId }).stat).wins, 1);
});

// กด RESET MATCH แล้วดราฟต์ที่บันทึกไว้ต้องไม่หาย
//
// ตัวบันทึกเกาะอยู่กับ emitState และเขียนสิ่งที่อยู่บนจอลงเกมที่ตัวชี้บอก
// RESET MATCH แทนที่ state ทั้งก้อนด้วยกระดานเปล่า แต่ไม่เคยล้างตัวชี้
// emit ครั้งถัดไปจึงเขียนความว่างทับดราฟต์ของเกมที่เพิ่งเล่นจบ
// และเกมยังค้าง draft_locked = 1 อยู่ สถิติจึงนับเป็น "เกมที่ครบแล้ว" ที่ไม่มีฮีโร่เลย
// = อัตรา pick/ban ของทั้งทัวร์นาเมนต์เจือจางลงโดยไม่มีอะไรบอก
//
// เป็นฝาแฝดของกับดักที่ §9 เขียนไว้แล้วเรื่อง goLive ต้อง restoreDraft ก่อน
// ทางนั้นถูกอุดไปแล้ว ทางนี้ยังเปิดอยู่
test('resetting the match does not erase the draft already recorded for it', () => {
  const cup = twoTeamCup('Reset cup');
  const gameId = must(must(live.goLive(cup.matchId).live).gameId);
  playFullDraft(gameId, { bluePicks: [must(A)] });

  const before = must(getStores().games.get(gameId)).slots.length;
  assert.strictEqual(before, 18, 'the whole draft was recorded');

  // ทำแบบเดียวกับ POST /api/reset-state เป๊ะๆ
  const previous = liveState.getState();
  liveState.setState(carryOverSettings(sanitizeState(defaultState), previous));
  live.releaseLiveMatch();
  liveState.emitState();

  const after = must(getStores().games.get(gameId));
  assert.strictEqual(after.slots.length, 18, 'the recorded draft survives the reset');
  assert.strictEqual(after.draftLocked, true);

  const { stat } = statFor(must(A), { tournamentId: cup.tournamentId });
  assert.strictEqual(must(stat).picked, 1, 'and the statistics still see it');
});

// หยิบทีมจากทะเบียนมาซ้อมนอกรอบ ต้องไม่ไปเขียนทับดราฟต์ของคู่ในทัวร์นาเมนต์
//
// ไม่มีหน้าไหนล้างตัวชี้แมตช์ที่ออกอากาศเลย พอคนคุมงานจบคู่ของทัวร์นาเมนต์
// แล้วหยิบสองทีมจากทะเบียนมาซ้อมต่อ ตัวชี้ยังอยู่ที่เกมเดิม
// ดราฟต์ของแมตช์ซ้อมจึงถูกบันทึกทับดราฟต์จริงของคู่นั้น พร้อมชื่อทีมเดิมติดอยู่
test('a casual match built from the registry never overwrites a tournament draft', () => {
  const cup = twoTeamCup('Casual cup');
  const gameId = must(must(live.goLive(cup.matchId).live).gameId);
  playFullDraft(gameId, { bluePicks: [must(A)], redPicks: [must(B)] });

  const recorded = must(getStores().games.get(gameId)).slots.map((s) => s.hero).sort();

  // คนคุมงานตั้งแมตช์ซ้อมจากทะเบียน โดยไม่ได้ปิดคู่ที่ออกอากาศอยู่ก่อน
  const { teams } = getStores();
  const one = must(teams.create({ name: 'Casual One' }).team);
  const two = must(teams.create({ name: 'Casual Two' }).team);
  live.loadTeamIntoSide('teamBlue', one.id);
  live.loadTeamIntoSide('teamRed', two.id);

  const state = liveState.getState();
  state.teamBlue.picks = heroesData.heroes.slice(40, 45) as string[];
  state.teamRed.picks = heroesData.heroes.slice(45, 50) as string[];
  state.teamBlue.bans = heroesData.heroes.slice(50, 54) as string[];
  state.teamRed.bans = heroesData.heroes.slice(54, 58) as string[];
  liveState.emitState();

  const after = must(getStores().games.get(gameId));
  assert.deepStrictEqual(after.slots.map((s) => s.hero).sort(), recorded, 'the tournament draft is untouched');
  assert.strictEqual(after.blueName, cup.blue.name, 'and still belongs to the teams that played it');
});

// ---- การคำนวณล้วนๆ ----

test('toHeroStats ranks ban priority by first-phase bans alone', () => {
  const counts = [
    { hero: 'x', picked: 0, banned: 9, present: 9, earlyBans: 1, wins: 0, decided: 0 },
    { hero: 'y', picked: 0, banned: 2, present: 2, earlyBans: 2, wins: 0, decided: 0 },
    { hero: 'z', picked: 5, banned: 0, present: 5, earlyBans: 0, wins: 3, decided: 4 }
  ];
  const stats = analytics.toHeroStats(counts, 10);
  const by = (hero: string) => must(stats.find((s) => s.hero === hero));

  // y โดนแบนรวมน้อยกว่า x แต่โดนแบนเฟสแรกมากกว่า จึงมาก่อน
  assert.strictEqual(by('y').banPriority, 1);
  assert.strictEqual(by('x').banPriority, 2);
  assert.strictEqual(by('z').banPriority, null);

  assert.strictEqual(by('z').pickRate, 0.5);
  assert.strictEqual(by('z').winRate, 0.75, 'wins over decided games, not over picks');
  assert.strictEqual(by('x').presence, 0.9);
});

test('rates are zero rather than NaN when there are no games at all', () => {
  const stats = analytics.toHeroStats(
    [{ hero: 'x', picked: 0, banned: 0, present: 0, earlyBans: 0, wins: 0, decided: 0 }],
    0
  );
  const only = must(stats[0]);
  assert.strictEqual(only.pickRate, 0);
  assert.strictEqual(only.presence, 0);
  assert.strictEqual(only.winRate, null);
});
