// สองทีมนี้เคยเจอกันมาแล้วยังไง
//
// ข้อมูลทั้งหมดถูกเก็บอยู่แล้วตั้งแต่ Phase 5 แต่ไม่เคยถูกเอามาใช้บนอากาศ
// สิ่งที่ต้องถูกที่สุดคือ "ฝั่งไหนเป็นของใคร" เพราะฝั่งบนจอสลับได้ตลอด
// สลับผิดทีเดียว = สถิติของทั้งสองทีมสลับกันบนจอ โดยไม่มีอะไรบอกว่าผิด

import test from 'node:test';
import assert from 'node:assert';

import { openDatabase } from '../server/store/db';
import { createTeamStore } from '../server/store/teams';
import { createTournamentStore } from '../server/store/tournaments';
import { createMatchStore } from '../server/store/matches';
import { createGameStore } from '../server/store/games';
import { createMatchupStore } from '../server/store/matchup';
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
  const matchup = createMatchupStore(db);
  return { db, teams, tournaments, games, matches, matchup };
}

// เล่นซีรีส์หนึ่งระหว่างสองทีม พร้อมดราฟต์ครบทุกเกม
//
// ฝั่งน้ำเงิน/แดงของเกมถูกตรึงไว้ตั้งแต่ตอนจับสายโดย games.freeze() ไม่ใช่เรา
// เทสต์จึงต้องอ่านว่าใครเป็นน้ำเงินจริงๆ แล้วค่อยแปลงผู้ชนะที่ระบุเป็น "id ทีม"
// ให้เป็น blue/red ตามนั้น ไม่ใช่ตั้งเอง ไม่งั้นดราฟต์ถูกบันทึกสลับฝั่ง
// (captureDraft ตอบ swapped ให้ถูกอยู่แล้ว แต่ผู้ชนะที่เราตั้งเองจะกลับด้าน)
function playSeries(
  s: ReturnType<typeof build>,
  matchId: string,
  winners: string[],
  picksBy: Record<string, string[]>,
  bansBy: Record<string, string[]> = {}
) {
  const first = must(s.games.forMatch(matchId)[0]);
  const blueId = String(first.blueTeamId);
  const redId = String(first.redTeamId);

  winners.forEach((winnerId, index) => {
    const game = s.games.ensure(matchId, index + 1, {
      blueTeamId: blueId, redTeamId: redId,
      blueName: first.blueName, redName: first.redName
    });
    s.games.captureDraft(game.id, {
      ...defaultState,
      teamBlue: {
        ...defaultState.teamBlue, name: first.blueName,
        picks: picksBy[blueId] ?? [], bans: bansBy[blueId] ?? []
      },
      teamRed: {
        ...defaultState.teamRed, name: first.redName,
        picks: picksBy[redId] ?? [], bans: bansBy[redId] ?? []
      }
    });
    s.games.setWinner(game.id, winnerId === blueId ? 'blue' : 'red');
  });
}

function fixture(s: ReturnType<typeof build>, name: string, x: string, y: string) {
  const tournament = must(s.tournaments.create({
    name, format: 'single_elim', bestOf: 3
  }).tournament);
  s.tournaments.addTeam(tournament.id, x, 0);
  s.tournaments.addTeam(tournament.id, y, 1);
  // วางคู่ที่ต้องการตรงๆ แทนการหวังว่าการจับสายจะจับให้
  must(s.matches.drawPlayoffs(tournament.id, [x, y]).matches);
  return must(s.matches.list(tournament.id).find((m) => m.teamAId && m.teamBId));
}

function setup() {
  const s = build();
  const fw = must(s.teams.create({ name: 'FW' }).team);
  const ea = must(s.teams.create({ name: 'EA' }).team);
  const other = must(s.teams.create({ name: 'OTHER' }).team);
  return { s, fw, ea, other };
}

test('two teams that have never met report an honest zero', () => {
  const { s, fw, ea } = setup();
  const result = s.matchup.between(fw.id, ea.id);

  assert.strictEqual(result.seriesPlayed, 0);
  assert.strictEqual(result.gamesPlayed, 0);
  assert.deepStrictEqual(result.meetings, []);
  assert.strictEqual(result.a.name, 'FW', 'names still come back');
  assert.strictEqual(result.b.name, 'EA');
  assert.deepStrictEqual(result.a.topPicks, []);
  s.db.close();
});

test('the head to head counts series and games for the right side', () => {
  const { s, fw, ea } = setup();
  const match = fixture(s, 'Cup', fw.id, ea.id);

  // FW ชนะสองในสาม ระบุด้วย id ทีม ไม่ใช่ฝั่งของจอ
  playSeries(s, match.id, [fw.id, ea.id, fw.id], {
    [fw.id]: HEROES.slice(0, 5), [ea.id]: HEROES.slice(5, 10)
  }, {
    [fw.id]: HEROES.slice(20, 24), [ea.id]: HEROES.slice(24, 28)
  });
  const fwIsSideA = match.teamAId === fw.id;
  must(s.matches.setResult(match.id, fwIsSideA ? 2 : 1, fwIsSideA ? 1 : 2).match);

  const result = s.matchup.between(fw.id, ea.id);
  assert.strictEqual(result.gamesPlayed, 3);
  assert.strictEqual(result.a.gamesWon, 2, 'FW won two games');
  assert.strictEqual(result.b.gamesWon, 1, 'EA won one');
  assert.strictEqual(result.seriesPlayed, 1);
  assert.strictEqual(result.a.seriesWon, 1);
  assert.strictEqual(result.b.seriesWon, 0);
  s.db.close();
});

// ข้อที่สำคัญที่สุด: ถามกลับด้าน ต้องได้คำตอบกลับด้านเป๊ะๆ
test('asking with the teams the other way round mirrors every number', () => {
  const { s, fw, ea } = setup();
  const match = fixture(s, 'Cup', fw.id, ea.id);

  playSeries(s, match.id, [fw.id, fw.id], {
    [fw.id]: HEROES.slice(0, 5), [ea.id]: HEROES.slice(5, 10)
  });
  const fwIsSideA = match.teamAId === fw.id;
  must(s.matches.setResult(match.id, fwIsSideA ? 2 : 0, fwIsSideA ? 0 : 2).match);

  const forward = s.matchup.between(fw.id, ea.id);
  const backward = s.matchup.between(ea.id, fw.id);

  assert.strictEqual(forward.a.gamesWon, backward.b.gamesWon);
  assert.strictEqual(forward.b.gamesWon, backward.a.gamesWon);
  assert.strictEqual(forward.a.seriesWon, backward.b.seriesWon);
  assert.deepStrictEqual(forward.a.topPicks, backward.b.topPicks);
  assert.strictEqual(must(forward.meetings[0]).scoreA, must(backward.meetings[0]).scoreB,
    'the scoreline flips with the question');
  s.db.close();
});

test('top picks and bans are only the ones used against this opponent', () => {
  const { s, fw, ea, other } = setup();

  playSeries(s, fixture(s, 'Cup', fw.id, ea.id).id, [fw.id], {
    [fw.id]: HEROES.slice(0, 5), [ea.id]: HEROES.slice(5, 10)
  }, {
    [fw.id]: HEROES.slice(20, 24), [ea.id]: HEROES.slice(24, 28)
  });

  // เกมกับทีมอื่น ใช้ฮีโร่คนละชุด ต้องไม่โผล่ในสถิติของคู่ FW-EA
  playSeries(s, fixture(s, 'Other Cup', fw.id, other.id).id, [fw.id], {
    [fw.id]: HEROES.slice(40, 45), [other.id]: HEROES.slice(45, 50)
  });

  const result = s.matchup.between(fw.id, ea.id);
  const picked = result.a.topPicks.map((h) => h.hero);
  assert.ok(picked.includes(must(HEROES[0])), 'what FW took against EA is here');
  assert.ok(!picked.includes(must(HEROES[40])), 'heroes from another fixture are not counted');

  const banned = result.a.topBans.map((h) => h.hero);
  assert.ok(banned.includes(must(HEROES[20])));
  s.db.close();
});

// ฝั่งบนจอสลับได้ระหว่างซีรีส์ สำเนาแช่แข็งเก็บฝั่งจริงไว้
// ถ้าอ่านจากฝั่งของแมตช์แทนฝั่งของเกม สถิติของสองทีมจะสลับกัน
test('a side swap between games does not swap the two teams statistics', () => {
  const { s, fw, ea } = setup();
  const match = fixture(s, 'Cup', fw.id, ea.id);

  // เกมที่ 1 ตามที่สายจับไว้ FW ชนะ
  playSeries(s, match.id, [fw.id], {
    [fw.id]: HEROES.slice(0, 5), [ea.id]: HEROES.slice(5, 10)
  }, {
    [fw.id]: HEROES.slice(20, 24), [ea.id]: HEROES.slice(24, 28)
  });

  // เกมที่ 2 สลับฝั่งบนจอ แล้ว FW ชนะอีก
  const first = must(s.games.forMatch(match.id)[0]);
  const fwWasBlue = String(first.blueTeamId) === fw.id;
  const game2 = s.games.ensure(match.id, 2, {
    blueTeamId: fwWasBlue ? ea.id : fw.id,
    redTeamId: fwWasBlue ? fw.id : ea.id,
    blueName: fwWasBlue ? 'EA' : 'FW',
    redName: fwWasBlue ? 'FW' : 'EA'
  });
  s.games.captureDraft(game2.id, {
    ...defaultState,
    teamBlue: {
      ...defaultState.teamBlue, name: fwWasBlue ? 'EA' : 'FW',
      picks: fwWasBlue ? HEROES.slice(5, 10) : HEROES.slice(0, 5),
      bans: fwWasBlue ? HEROES.slice(24, 28) : HEROES.slice(20, 24)
    },
    teamRed: {
      ...defaultState.teamRed, name: fwWasBlue ? 'FW' : 'EA',
      picks: fwWasBlue ? HEROES.slice(0, 5) : HEROES.slice(5, 10),
      bans: fwWasBlue ? HEROES.slice(20, 24) : HEROES.slice(24, 28)
    }
  });
  s.games.setWinner(game2.id, fwWasBlue ? 'red' : 'blue');   // FW ชนะ ไม่ว่าอยู่ฝั่งไหน

  const result = s.matchup.between(fw.id, ea.id);
  assert.strictEqual(result.a.gamesWon, 2, 'FW won both, on different sides of the screen');
  assert.strictEqual(result.b.gamesWon, 0);

  // และฮีโร่ยังถูกนับให้ทีมที่หยิบจริง ไม่ใช่ให้ฝั่งของจอ
  const fwPicked = result.a.topPicks.find((h) => h.hero === HEROES[0]);
  assert.strictEqual(must(fwPicked).count, 2, 'FW took it in both games');
  assert.ok(!result.b.topPicks.some((h) => h.hero === HEROES[0]), 'and it is not credited to EA');
  s.db.close();
});

// ทีมที่ถูกลบออกจากทะเบียนแล้วยังต้องมีชื่อขึ้นจอ
test('a team deleted from the registry keeps the name it played under', () => {
  const { s, fw, ea } = setup();
  playSeries(s, fixture(s, 'Cup', fw.id, ea.id).id, [fw.id], {
    [fw.id]: HEROES.slice(0, 5), [ea.id]: HEROES.slice(5, 10)
  });

  s.teams.remove(ea.id);

  const result = s.matchup.between(fw.id, ea.id);
  assert.strictEqual(result.b.name, 'EA', 'read off the frozen copy, not left blank');
  assert.strictEqual(result.a.name, 'FW');
  s.db.close();
});
