// รอบแบ่งกลุ่มต่อเข้ารอบน็อกเอาต์ ในทัวร์นาเมนต์เดียวกัน
//
// สิ่งที่ต้องถูกที่สุด: การวางสายน็อกเอาต์ต้องไม่แตะรอบแบ่งกลุ่ม
// แมตช์ในกลุ่มคือที่มาของทีมที่กำลังถูกวาง และดราฟต์ทั้งหมดของรอบนั้น
// ผูกอยู่กับแมตช์พวกนั้นแบบ CASCADE ล้างทิ้งทีเดียวหายทั้งรอบ

import test from 'node:test';
import assert from 'node:assert';

import { openDatabase } from '../server/store/db';
import { createTeamStore } from '../server/store/teams';
import { createTournamentStore } from '../server/store/tournaments';
import { createMatchStore, PLAYOFF_BRACKET } from '../server/store/matches';
import { createGameStore } from '../server/store/games';
import { createStandingsStore } from '../server/store/standings';
import { promoteFromGroups } from '../server/domain/standings';
import { defaultState } from '../server/domain/match';
import { heroesData } from '../server/domain/heroes';
import { must } from './helpers';

function build(teamCount = 16) {
  const db = openDatabase(':memory:');
  const teams = createTeamStore(db);
  const tournaments = createTournamentStore(db, teams);
  const games = createGameStore(db);
  const matches = createMatchStore(db, tournaments, games);
  const standings = createStandingsStore(db);

  const tournament = must(tournaments.create({
    name: 'Group Cup', format: 'group_stage', bestOf: 3
  }).tournament);

  const ids: string[] = [];
  for (let i = 0; i < teamCount; i += 1) {
    const team = must(teams.create({ name: `T${i + 1}` }).team);
    ids.push(team.id);
    tournaments.addTeam(tournament.id, team.id, i);
  }
  must(matches.generate(tournament.id).matches);
  return { db, teams, tournaments, games, matches, standings, tournament, ids };
}

// เล่นทุกนัดในกลุ่มให้จบ โดยให้ทีมที่ seed สูงกว่าชนะเสมอ
// ผลจึงคาดเดาได้ และอันดับในกลุ่มไม่มีทางเสมอกันที่เส้นตัด
function playOutGroups(s: ReturnType<typeof build>) {
  const order = new Map(s.ids.map((id, i) => [id, i]));
  s.matches.list(s.tournament.id)
    .filter((m) => m.bracket !== PLAYOFF_BRACKET && !m.isBye && m.teamAId && m.teamBId)
    .forEach((m) => {
      const aBetter = (order.get(m.teamAId as string) ?? 0) < (order.get(m.teamBId as string) ?? 0);
      s.matches.setResult(m.id, aBetter ? 2 : 0, aBetter ? 0 : 2);
    });
}

test('a group stage really does produce groups, and standings read them', () => {
  const s = build();
  const brackets = [...new Set(s.matches.list(s.tournament.id).map((m) => m.bracket))].sort();
  assert.ok(brackets.length >= 2, `expected group brackets, got ${brackets.join(',')}`);

  playOutGroups(s);
  const groups = s.standings.forTournament(s.tournament.id);
  assert.strictEqual(groups.length, brackets.length);
  groups.forEach((g) => {
    assert.strictEqual(g.remaining, 0, `group ${g.bracket} is finished`);
    assert.ok(g.rows.length >= 2);
    assert.ok(g.rows.every((r) => r.name !== ''), 'every row carries a team name');
  });
  s.db.close();
});

// ข้อที่สำคัญที่สุดของไฟล์นี้
test('drawing the playoff leaves the group stage and its drafts untouched', () => {
  const s = build();
  playOutGroups(s);

  // ดราฟต์จริงหนึ่งเกมในรอบแบ่งกลุ่ม
  const groupMatch = must(s.matches.list(s.tournament.id)
    .find((m) => m.bracket !== PLAYOFF_BRACKET && m.status === 'complete'));
  // ชื่อต้องมาจากสำเนาแช่แข็งที่ freeze() จองไว้ตอนจับสาย ไม่ใช่ตั้งขึ้นมาเอง
  // captureDraft เทียบชื่อบนกระดานกับสำเนา ไม่ตรงกันเมื่อไหร่มันตอบ 'different'
  // แล้วปฏิเสธการบันทึก ซึ่งเป็นด่านกันการเขียนทับดราฟต์ของเกมอื่น
  const frozen = must(s.games.forMatch(groupMatch.id)[0]);
  s.games.captureDraft(frozen.id, {
    ...defaultState,
    teamBlue: { ...defaultState.teamBlue, name: frozen.blueName, picks: heroesData.heroes.slice(0, 5) },
    teamRed: { ...defaultState.teamRed, name: frozen.redName }
  });

  const groupsBefore = s.matches.list(s.tournament.id)
    .filter((m) => m.bracket !== PLAYOFF_BRACKET)
    .map((m) => `${m.bracket}/${m.round}/${m.slot}:${m.scoreA}-${m.scoreB}:${m.status}`).sort();
  const draftBefore = s.games.forMatch(groupMatch.id).flatMap((g) => g.slots).length;
  assert.ok(draftBefore > 0, 'there really is a draft to lose');

  const promotion = promoteFromGroups(s.standings.rawForTournament(s.tournament.id), 2);
  const result = s.matches.drawPlayoffs(s.tournament.id, must(promotion.teamIds));
  assert.ok(result.matches, result.error ?? 'the playoff was drawn');

  const groupsAfter = s.matches.list(s.tournament.id)
    .filter((m) => m.bracket !== PLAYOFF_BRACKET)
    .map((m) => `${m.bracket}/${m.round}/${m.slot}:${m.scoreA}-${m.scoreB}:${m.status}`).sort();

  assert.deepStrictEqual(groupsAfter, groupsBefore, 'the group stage is exactly as it was');
  assert.strictEqual(
    s.games.forMatch(groupMatch.id).flatMap((g) => g.slots).length, draftBefore,
    'and the draft recorded in the group stage is still there'
  );
  s.db.close();
});

test('the playoff lands in its own bracket, and its winners advance inside it', () => {
  const s = build();
  playOutGroups(s);
  const promotion = promoteFromGroups(s.standings.rawForTournament(s.tournament.id), 2);
  must(s.matches.drawPlayoffs(s.tournament.id, must(promotion.teamIds)).matches);

  const playoff = s.matches.list(s.tournament.id).filter((m) => m.bracket === PLAYOFF_BRACKET);
  assert.strictEqual(playoff.length, 7, 'eight teams means four, then two, then the final');

  // ปลายทางต้องชี้กลับมาที่สายน็อกเอาต์ ไม่ใช่ไปโผล่ในกลุ่ม
  playoff.filter((m) => m.nextRound !== null).forEach((m) => {
    assert.strictEqual(m.nextBracket, PLAYOFF_BRACKET,
      `${m.round}/${m.slot} sends its winner to bracket ${m.nextBracket}`);
  });

  const semi = must(playoff.find((m) => m.round === 1 && m.teamAId && m.teamBId));
  const winner = semi.teamAId as string;
  must(s.matches.setResult(semi.id, 2, 0).match);

  const final = must(s.matches.list(s.tournament.id)
    .find((m) => m.bracket === PLAYOFF_BRACKET && m.round === 2
      && (m.teamAId === winner || m.teamBId === winner)));
  assert.ok(
    final.teamAId === winner || final.teamBId === winner,
    'the winner moved into the next round of the playoff'
  );
  s.db.close();
});

test('redrawing the playoff replaces it, but not once it has been played', () => {
  const s = build();
  playOutGroups(s);
  const ids = must(promoteFromGroups(s.standings.rawForTournament(s.tournament.id), 2).teamIds);

  must(s.matches.drawPlayoffs(s.tournament.id, ids).matches);
  const firstDraw = s.matches.list(s.tournament.id).filter((m) => m.bracket === PLAYOFF_BRACKET);

  // วางซ้ำตอนยังไม่มีใครเล่น = แทนที่ ไม่ใช่วางซ้อน
  must(s.matches.drawPlayoffs(s.tournament.id, ids).matches);
  const secondDraw = s.matches.list(s.tournament.id).filter((m) => m.bracket === PLAYOFF_BRACKET);
  assert.strictEqual(secondDraw.length, firstDraw.length, 'no duplicate playoff matches');

  // พอมีผลแล้ว ต้องปฏิเสธ ไม่ใช่ลบผลของคนที่เล่นไปแล้วทิ้งเงียบๆ
  const semi = must(secondDraw.find((m) => m.round === 1 && m.teamAId && m.teamBId));
  must(s.matches.setResult(semi.id, 2, 0).match);

  const refused = s.matches.drawPlayoffs(s.tournament.id, ids);
  assert.strictEqual(refused.matches, undefined);
  assert.match(String(refused.error), /results already/i);
  s.db.close();
});

test('a playoff draw refuses input it cannot make a bracket from', () => {
  const s = build();
  assert.match(String(s.matches.drawPlayoffs(s.tournament.id, []).error), /at least two/i);
  assert.match(String(s.matches.drawPlayoffs(s.tournament.id, [must(s.ids[0])]).error), /at least two/i);
  assert.match(
    String(s.matches.drawPlayoffs(s.tournament.id, [must(s.ids[0]), must(s.ids[0])]).error),
    /same team/i
  );
  assert.match(String(s.matches.drawPlayoffs('nope', s.ids).error), /not found/i);
  s.db.close();
});

// จำนวนทีมที่ไม่ใช่กำลังสอง ต้องได้บาย ไม่ใช่สายที่ขาด
test('an odd number of promoted teams gets byes rather than a broken bracket', () => {
  const s = build();
  playOutGroups(s);
  const ids = must(promoteFromGroups(s.standings.rawForTournament(s.tournament.id), 3).teamIds);
  assert.strictEqual(ids.length, 12);

  must(s.matches.drawPlayoffs(s.tournament.id, ids).matches);
  const playoff = s.matches.list(s.tournament.id).filter((m) => m.bracket === PLAYOFF_BRACKET);

  const byes = playoff.filter((m) => m.isBye);
  assert.strictEqual(byes.length, 4, 'twelve teams in a sixteen slot bracket means four byes');
  byes.forEach((m) => assert.ok(m.winnerId, 'a bye already has its winner'));

  // และผู้ชนะบายต้องถูกดันเข้ารอบสองแล้ว
  const round2 = playoff.filter((m) => m.round === 2);
  const seated = round2.flatMap((m) => [m.teamAId, m.teamBId]).filter(Boolean);
  assert.ok(seated.length >= 2, 'the bye winners are already standing in round 2');
  s.db.close();
});

// สายน็อกเอาต์ไม่ใช่กลุ่ม
//
// ตารางคะแนนสร้างกลุ่มจากชื่อสายที่พบในตารางแข่ง พอวางสายน็อกเอาต์ต่อท้าย
// ในทัวร์นาเมนต์เดียวกัน มันโผล่เป็นอีกกลุ่มหนึ่งทันที
// เห็นบนกระดานออกอากาศจริง: ขึ้นห้ากลุ่มทั้งที่รายการมีสี่กลุ่ม
// และการเลื่อนชั้นครั้งต่อไปก็จะติดที่ "กลุ่ม playoff ยังแข่งไม่จบ"
test('the playoff bracket never shows up as another group', () => {
  const s = build();
  playOutGroups(s);

  const before = s.standings.forTournament(s.tournament.id);
  const ids = must(promoteFromGroups(s.standings.rawForTournament(s.tournament.id), 2).teamIds);
  must(s.matches.drawPlayoffs(s.tournament.id, ids).matches);

  const after = s.standings.forTournament(s.tournament.id);
  assert.strictEqual(after.length, before.length, 'the same groups, no extra one');
  assert.ok(
    !after.some((g) => g.bracket === PLAYOFF_BRACKET),
    'the knockout bracket is not a group'
  );

  // และการเลื่อนชั้นอีกครั้งต้องยังทำงาน ไม่ใช่ติดว่ากลุ่มใหม่ยังแข่งไม่จบ
  const again = promoteFromGroups(s.standings.rawForTournament(s.tournament.id), 2);
  assert.ok(again.teamIds, again.error ?? 'promotion still works after a playoff exists');
  s.db.close();
});
