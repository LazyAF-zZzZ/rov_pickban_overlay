// ประวัติพิค/แบนของทั้งทัวร์นาเมนต์
//
// คำถามที่เมื่อก่อนตอบไม่ได้: "รายการนี้เล่นอะไรกันมาบ้าง"
// games.forMatch ตอบทีละแมตช์ analytics ตอบเป็นตัวเลขรวม
// ส่วนนี่คือดราฟต์จริงทีละเกม เรียงจากใหม่ไปเก่า

import test from 'node:test';
import assert from 'node:assert';

import { openDatabase } from '../server/store/db';
import { createTeamStore } from '../server/store/teams';
import { createTournamentStore } from '../server/store/tournaments';
import { createMatchStore } from '../server/store/matches';
import { createGameStore } from '../server/store/games';
import { createDraftsStore } from '../server/store/drafts';
import { defaultState } from '../server/domain/match';
import { heroesData } from '../server/domain/heroes';
import { must } from './helpers';

const HEROES = heroesData.heroes;

function build() {
  const db = openDatabase(':memory:');
  const teams = createTeamStore(db);
  const tournaments = createTournamentStore(db, teams);
  const games = createGameStore(db);
  const matches = createMatchStore(db, tournaments, games);
  const drafts = createDraftsStore(db);

  const tournament = must(tournaments.create({
    name: 'Cup', format: 'single_elim', bestOf: 3
  }).tournament);
  const a = must(teams.create({ name: 'FW' }).team);
  const b = must(teams.create({ name: 'EA' }).team);
  tournaments.addTeam(tournament.id, a.id, 0);
  tournaments.addTeam(tournament.id, b.id, 1);
  must(matches.generate(tournament.id).matches);
  const match = must(matches.list(tournament.id).find((m) => m.teamAId && m.teamBId));

  return { db, teams, tournaments, games, matches, drafts, tournament, a, b, match };
}

// ดราฟต์หนึ่งเกม โดยอ่านฝั่งจากสำเนาแช่แข็ง ไม่ตั้งเอง
function draftGame(
  s: ReturnType<typeof build>, gameNo: number,
  bluePicks: string[], redPicks: string[],
  blueBans: string[] = [], redBans: string[] = [],
  winner: 'blue' | 'red' | null = null
) {
  const first = must(s.games.forMatch(s.match.id)[0]);
  const game = s.games.ensure(s.match.id, gameNo, {
    blueTeamId: first.blueTeamId, redTeamId: first.redTeamId,
    blueName: first.blueName, redName: first.redName
  });
  s.games.captureDraft(game.id, {
    ...defaultState,
    teamBlue: { ...defaultState.teamBlue, name: first.blueName, picks: bluePicks, bans: blueBans },
    teamRed: { ...defaultState.teamRed, name: first.redName, picks: redPicks, bans: redBans }
  });
  if (winner) s.games.setWinner(game.id, winner);
  return game;
}

test('only games with a recorded draft appear', () => {
  const s = build();

  // freeze() จองแถวเกมที่ 1 ไว้ตั้งแต่ตอนจับสาย ก่อนที่จะมีใครเล่น
  // แถวเปล่านั้นไม่ใช่ประวัติ มันคือที่ว่างที่รอถูกเติม
  assert.ok(s.games.forMatch(s.match.id).length > 0, 'the reserved row exists');
  assert.deepStrictEqual(s.drafts.forTournament(s.tournament.id), []);

  draftGame(s, 1, HEROES.slice(0, 5), HEROES.slice(5, 10));
  assert.strictEqual(s.drafts.forTournament(s.tournament.id).length, 1);
  s.db.close();
});

test('a game carries its picks, bans, sides and where it was played', () => {
  const s = build();
  draftGame(s, 1,
    HEROES.slice(0, 5), HEROES.slice(5, 10),
    HEROES.slice(20, 24), HEROES.slice(24, 28), 'blue');

  const game = must(s.drafts.forTournament(s.tournament.id)[0]);

  assert.strictEqual(game.gameNo, 1);
  assert.strictEqual(game.bracket, s.match.bracket);
  assert.strictEqual(game.round, s.match.round);
  assert.strictEqual(game.bestOf, 3);
  assert.ok(game.draftLocked, 'a full draft is locked');
  assert.ok(game.decided, 'and its winner was recorded');

  assert.strictEqual(game.blue.picks.length, 5, 'always one entry per pick slot');
  assert.strictEqual(game.blue.bans.length, 4);
  assert.deepStrictEqual(game.blue.picks, HEROES.slice(0, 5));
  assert.deepStrictEqual(game.red.bans, HEROES.slice(24, 28));
  assert.strictEqual(game.blue.won, true);
  assert.strictEqual(game.red.won, false);

  // ชื่อมาจากสำเนาแช่แข็ง = ชื่อ ณ วันที่ลงเล่น
  assert.ok(game.blue.name !== '', 'the side is named');
  s.db.close();
});

// ดราฟต์ที่ยังไม่ครบก็เป็นประวัติเหมือนกัน
// ต่างจาก analytics ที่นับเฉพาะ draft_locked = 1 เพราะตัวเลขรวมจะเพี้ยน
// แต่หน้าประวัติต้องแสดงสิ่งที่เกิดขึ้นจริง รวมถึงเกมที่ดราฟต์ค้างกลางคัน
test('a partial draft still shows up, marked as not locked', () => {
  const s = build();
  draftGame(s, 1, [must(HEROES[0]), null as unknown as string], []);

  const game = must(s.drafts.forTournament(s.tournament.id)[0]);
  assert.strictEqual(game.draftLocked, false);
  assert.strictEqual(game.blue.picks[0], HEROES[0]);
  assert.strictEqual(game.blue.picks[1], null, 'the empty slot stays empty, it does not shift up');
  s.db.close();
});

// ผู้ชนะรายเกมไม่มีทางเดาย้อนหลังได้ ต้องบอกตรงๆ ว่ายังไม่รู้
test('a game with no recorded winner says so rather than picking one', () => {
  const s = build();
  draftGame(s, 1, HEROES.slice(0, 5), HEROES.slice(5, 10));

  const game = must(s.drafts.forTournament(s.tournament.id)[0]);
  assert.strictEqual(game.decided, false);
  assert.strictEqual(game.blue.won, false);
  assert.strictEqual(game.red.won, false);
  s.db.close();
});

test('games come back newest first', () => {
  const s = build();
  draftGame(s, 1, HEROES.slice(0, 5), HEROES.slice(5, 10));
  draftGame(s, 2, HEROES.slice(10, 15), HEROES.slice(15, 20));
  draftGame(s, 3, HEROES.slice(20, 25), HEROES.slice(25, 30));

  const numbers = s.drafts.forTournament(s.tournament.id).map((g) => g.gameNo);
  assert.deepStrictEqual(numbers, [3, 2, 1], 'the most recent game reads first');
  s.db.close();
});

// ประวัติเป็นของทัวร์นาเมนต์นั้น ไม่ใช่ของทั้งเครื่อง
test('one tournament never sees another tournament drafts', () => {
  const s = build();
  draftGame(s, 1, HEROES.slice(0, 5), HEROES.slice(5, 10));

  const other = must(s.tournaments.create({
    name: 'Other Cup', format: 'single_elim', bestOf: 1
  }).tournament);
  s.tournaments.addTeam(other.id, s.a.id, 0);
  s.tournaments.addTeam(other.id, s.b.id, 1);
  must(s.matches.generate(other.id).matches);

  assert.strictEqual(s.drafts.forTournament(s.tournament.id).length, 1);
  assert.strictEqual(s.drafts.forTournament(other.id).length, 0);
  assert.deepStrictEqual(s.drafts.forTournament('nope'), []);
  s.db.close();
});

// ชื่อฮีโร่ต้องไม่ถูกกรองกับรายชื่อปัจจุบัน
//
// นี่คือประวัติ ฮีโร่ที่ถูกเปลี่ยนชื่อไฟล์ไปแล้วต้องยังปรากฏว่าเคยถูกเลือก
// กฎเดียวกับ restoreDraft และ game_slots (ดู CLAUDE.md)
test('a hero the app no longer knows is still shown as having been picked', () => {
  const s = build();
  const first = must(s.games.forMatch(s.match.id)[0]);
  const game = s.games.ensure(s.match.id, 1, {
    blueTeamId: first.blueTeamId, redTeamId: first.redTeamId,
    blueName: first.blueName, redName: first.redName
  });
  // เขียนช่องตรงๆ เลียนแบบดราฟต์เก่าที่อ้างชื่อไฟล์ที่ถูกเปลี่ยนไปแล้ว
  s.db.prepare(
    'INSERT INTO game_slots (game_id, side, kind, idx, hero) VALUES (?, ?, ?, ?, ?)'
  ).run(game.id, 'blue', 'pick', 0, 'a-hero-that-was-renamed');

  const back = must(s.drafts.forTournament(s.tournament.id)[0]);
  assert.strictEqual(back.blue.picks[0], 'a-hero-that-was-renamed');
  s.db.close();
});
