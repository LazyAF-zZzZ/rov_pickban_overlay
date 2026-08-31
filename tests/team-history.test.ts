// เทสต์ประวัติการแข่งของทีม
//
// ตั้ง env ก่อน import อะไรก็ตาม เพราะ config อ่านตอน import
// ถ้าตั้งทีหลังจะไปแตะ tournament.db ของผู้ใช้จริง
//
// เรื่องที่ตั้งใจจับมากที่สุดคือช่องคู่แข่งที่ว่าง ซึ่งมีสองความหมาย
// "ยังไม่รู้ว่าจะเจอใคร" กับ "เคยเจอ แล้วทีมนั้นถูกลบไปแล้ว"
// ถ้าแยกไม่ออก ประวัติของนัดที่เล่นจบไปแล้วจะกลายเป็นว่าไม่เคยมีคู่แข่ง

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-history-test-'));
process.env.ROV_USER_DATA_DIR = path.join(TMP, 'data');
process.env.ROV_USER_MEDIA_DIR = path.join(TMP, 'media');
process.env.CONTROL_TOKEN = '';

const { getStores } = require('../server/store/index') as typeof import('../server/store/index');
const { closeDatabase } = require('../server/store/db') as typeof import('../server/store/db');
const live = require('../server/services/live-match') as typeof import('../server/services/live-match');

// import type ถูกลบทิ้งตอนคอมไพล์ จึงไม่ทำให้ config ถูกโหลดก่อนตั้ง env
import type { Team } from '../server/domain/team';
import type { Match } from '../server/store/matches';
import { must } from './helpers';

test.after(() => {
  // ปิดฐานก่อนลบโฟลเดอร์ ไม่งั้น Windows ไม่ยอมให้ลบเพราะ WAL ยังเปิดอยู่
  closeDatabase();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ระบบเก็บเอง */ }
});

// HELPERS ------------------------------------------------------------

function makeTeams(names: string[]): Team[] {
  const { teams } = getStores();
  return names.map((name) => must(teams.create({ name }).team));
}

// ทัวร์นาเมนต์หนึ่งรายการที่จับคู่แล้ว เรียงตาม seed (ไม่สุ่ม) จะได้ทายผลได้
function cup(name: string, entrants: Team[], format = 'single_elim'): { id: string; matches: Match[] } {
  const { tournaments, matches } = getStores();
  const tournament = must(tournaments.create({ name, format, bestOf: 3 }).tournament);
  entrants.forEach((team, i) => tournaments.addTeam(tournament.id, team.id, i));
  return { id: tournament.id, matches: must(matches.generate(tournament.id).matches) };
}

function matchFor(list: Match[], teamId: string): Match | undefined {
  return list.find((m) => m.teamAId === teamId || m.teamBId === teamId);
}

// บันทึกผลโดยระบุว่า "ใครชนะ" ไม่ใช่ "ฝั่งไหนชนะ"
// ทีมอาจอยู่ฝั่ง A หรือ B ก็ได้ แล้วแต่ตอนจับสาย เทสต์ไม่ควรต้องรู้
function decide(match: Match, winnerId: string, winnerGames: number, loserGames: number): void {
  const { matches } = getStores();
  const winnerIsA = match.teamAId === winnerId;
  const result = matches.setResult(
    match.id,
    winnerIsA ? winnerGames : loserGames,
    winnerIsA ? loserGames : winnerGames
  );
  assert.ok(result.match, result.error ?? 'setResult failed');
}

// TESTS --------------------------------------------------------------

test('a team with no matches still answers, with an empty record', () => {
  const { history } = getStores();
  const [team] = makeTeams(['Nobody']);

  const result = history.forTeam(must(team).id);
  assert.deepStrictEqual(result.matches, []);
  assert.deepStrictEqual(result.tournaments, []);
  assert.strictEqual(result.record.played, 0);
  assert.strictEqual(result.record.tournaments, 0);
});

test('an unknown team id gives an empty history rather than throwing', () => {
  const result = getStores().history.forTeam('no-such-team');
  assert.strictEqual(result.matches.length, 0);
  assert.strictEqual(result.record.played, 0);
});

test('series wins and losses are counted apart from game wins and losses', () => {
  const { matches, history } = getStores();
  const [alpha, beta, gamma, delta] = makeTeams(['Alpha', 'Beta', 'Gamma', 'Delta']);
  const { id } = cup('Record cup', [must(alpha), must(beta), must(gamma), must(delta)]);

  const round1 = matches.list(id).filter((m) => m.round === 1);
  const alphaFirst = must(matchFor(round1, must(alpha).id));
  const other = must(round1.find((m) => m.id !== alphaFirst.id));

  decide(alphaFirst, must(alpha).id, 2, 1);       // ชนะซีรีส์ 2-1
  decide(other, must(other.teamAId), 2, 0);       // อีกคู่ต้องจบด้วย ไม่งั้นรอบชิงยังไม่มีคู่แข่ง

  const final = must(matches.list(id).find((m) => m.round === 2));
  const opponentId = final.teamAId === must(alpha).id ? final.teamBId : final.teamAId;
  decide(final, must(opponentId), 2, 1);          // อัลฟ่าแพ้รอบชิง 1-2

  const { record, matches: played } = history.forTeam(must(alpha).id);
  assert.strictEqual(record.played, 2, 'two series played');
  assert.strictEqual(record.won, 1);
  assert.strictEqual(record.lost, 1);
  assert.strictEqual(record.gamesWon, 3, '2 in the semi, 1 in the final');
  assert.strictEqual(record.gamesLost, 3, '1 in the semi, 2 in the final');
  assert.strictEqual(record.tournaments, 1);

  // เรียงรอบท้ายขึ้นก่อน คนเปิดดูอยากเห็นล่าสุด ไม่ใช่ไล่จากรอบแรก
  assert.strictEqual(played[0].round, 2, 'newest round first');
  assert.strictEqual(played[0].outcome, 'loss');
  assert.strictEqual(played[1].outcome, 'win');
  assert.strictEqual(played[1].score, 2);
  assert.strictEqual(played[1].opponentScore, 1);
});

test('a bye shows in the history but is not a match played', () => {
  const { matches, history } = getStores();
  const entrants = makeTeams(['Solo', 'Duo', 'Trio']);
  const { id } = cup('Bye cup', entrants);

  const bye = must(matches.list(id).find((m) => m.isBye));
  const luckyId = must(bye.winnerId);

  const { record, matches: played } = history.forTeam(luckyId);
  const byeRow = must(played.find((m) => m.matchId === bye.id));

  assert.strictEqual(byeRow.outcome, 'bye');
  assert.strictEqual(record.played, 0, 'a bye is not played');
  assert.strictEqual(record.won, 0, 'and it is not a win either');
  assert.strictEqual(record.gamesWon, 0);
});

test('history spans every tournament the team entered', () => {
  const { matches, history } = getStores();
  const [shared, rivalA, rivalB] = makeTeams(['Shared', 'Rival A', 'Rival B']);

  const spring = cup('Spring cup', [must(shared), must(rivalA)]);
  const summer = cup('Summer cup', [must(shared), must(rivalB)]);

  decide(must(matches.list(spring.id)[0]), must(shared).id, 2, 0);
  decide(must(matches.list(summer.id)[0]), must(rivalB).id, 2, 1);

  const { record, tournaments, matches: played } = history.forTeam(must(shared).id);

  assert.strictEqual(record.tournaments, 2);
  assert.strictEqual(record.played, 2);
  assert.strictEqual(record.won, 1);
  assert.strictEqual(record.lost, 1);

  const names = played.map((m) => m.tournamentName).sort();
  assert.deepStrictEqual(names, ['Spring cup', 'Summer cup'], 'both tournaments appear');
  assert.deepStrictEqual(
    tournaments.map((t) => t.name).sort(),
    ['Spring cup', 'Summer cup']
  );

  const springRow = must(played.find((m) => m.tournamentName === 'Spring cup'));
  assert.strictEqual(springRow.opponentName, 'Rival A', 'opponent read from the registry');
  assert.strictEqual(springRow.opponentGone, false);
});

// ---- ช่องคู่แข่งที่ว่าง มีสองความหมาย ต้องแยกออกจากกัน ----

test('an opponent who has not been decided yet is not a deleted team', () => {
  const { matches, history } = getStores();
  const entrants = makeTeams(['Pend 1', 'Pend 2', 'Pend 3', 'Pend 4']);
  const { id } = cup('Pending cup', entrants);

  const round1 = matches.list(id).filter((m) => m.round === 1);
  const first = must(matchFor(round1, must(entrants[0]).id));
  decide(first, must(entrants[0]).id, 2, 0);

  // เข้ารอบชิงแล้ว แต่คู่แข่งยังไม่รู้ เพราะอีกคู่ยังไม่ได้เล่น
  const { matches: played } = history.forTeam(must(entrants[0]).id);
  const final = must(played.find((m) => m.round === 2));

  assert.strictEqual(final.opponentId, null);
  assert.strictEqual(final.opponentName, null, 'nobody to name yet');
  assert.strictEqual(final.opponentGone, false, 'not decided is not the same as deleted');
  assert.strictEqual(final.outcome, null);
});

test('a deleted opponent still shows the name frozen on the game record', () => {
  const { teams, matches, history } = getStores();
  const [survivor, ghost] = makeTeams(['Survivor', 'Ghost Squad']);
  const { id } = cup('Ghost cup', [must(survivor), must(ghost)]);

  const match = must(matches.list(id)[0]);

  // เอาขึ้นจอด้วย เส้นทางนี้ต้องยังทำงานเหมือนเดิม
  // (นัดที่ไม่เคยขึ้นจอมีเทสต์ของตัวเองอยู่ถัดลงไป)
  const onAir = live.goLive(match.id);
  assert.ok(onAir.live, onAir.error ?? 'goLive failed');

  decide(match, must(survivor).id, 2, 0);

  assert.ok(teams.remove(must(ghost).id).ok, 'the opponent leaves the registry');
  assert.strictEqual(teams.get(must(ghost).id), null);

  const { record, matches: played } = history.forTeam(must(survivor).id);
  const row = must(played.find((m) => m.matchId === match.id));

  // ON DELETE SET NULL ทำให้ id หายไป แต่ตารางแข่งต้องไม่หายตาม
  assert.strictEqual(row.opponentId, null, 'the id is gone with the team');
  assert.strictEqual(row.opponentGone, true);
  assert.strictEqual(row.opponentName, 'Ghost Squad', 'the name survives on the game record');
  assert.strictEqual(row.outcome, 'win', 'and the result still stands');
  assert.strictEqual(record.won, 1);
});

// ช่องโหว่เดิมของ §8: คะแนนกรอกลงในสายได้โดยไม่ต้องเปิดแมตช์ขึ้นจอเลย
// เมื่อสำเนาแช่แข็งถูกเขียนตอนขึ้นจอที่เดียว นัดแบบนั้นจึงไม่มีแถวเกม
// พอลบคู่แข่งทีหลังก็ไม่มีชื่อให้ถอยไปอ่าน แถวนั้นกลายเป็น "ไม่เคยมีคู่แข่ง" ถาวร
// ตอนนี้การจับคู่เป็นตัวจองสำเนา นัดที่ไม่เคยขึ้นจอจึงกู้ชื่อได้เหมือนกัน
test('a match scored without ever going on air still remembers who played it', () => {
  const { teams, matches, history } = getStores();
  const [survivor, ghost] = makeTeams(['Paper Only', 'Vanished FC']);
  const { id } = cup('Paper cup', [must(survivor), must(ghost)]);

  const match = must(matches.list(id)[0]);
  decide(match, must(survivor).id, 2, 0);   // ไม่มี goLive ที่ไหนเลย

  assert.ok(teams.remove(must(ghost).id).ok);

  const row = must(history.forTeam(must(survivor).id).matches
    .find((m) => m.matchId === match.id));

  assert.strictEqual(row.opponentId, null, 'the id went with the team');
  assert.strictEqual(row.opponentGone, true);
  assert.strictEqual(row.opponentName, 'Vanished FC', 'the frozen name is still there');
  assert.strictEqual(row.outcome, 'win');
});

// นัดที่ยังไม่ได้เล่นก็ต้องกู้ได้ ไม่ใช่เฉพาะนัดที่จบแล้ว
// ทีมถูกลบกลางทัวร์นาเมนต์เกิดขึ้นจริง และแถวนั้นควรบอกว่า "เคยจะเจอใคร"
// ไม่ใช่กลายเป็นช่องว่างที่อ่านได้ว่า "ยังไม่รู้ว่าจะเจอใคร"
test('an opponent deleted before the match was played is still named, not blanked', () => {
  const { teams, matches, history } = getStores();
  const [waiting, quitter] = makeTeams(['Still Waiting', 'Withdrew United']);
  const { id } = cup('Withdrawal cup', [must(waiting), must(quitter)]);

  const match = must(matches.list(id)[0]);
  assert.ok(teams.remove(must(quitter).id).ok);

  const row = must(history.forTeam(must(waiting).id).matches
    .find((m) => m.matchId === match.id));

  assert.strictEqual(row.opponentId, null);
  assert.strictEqual(row.opponentGone, true, 'gone, not undecided');
  assert.strictEqual(row.opponentName, 'Withdrew United');
  assert.strictEqual(row.outcome, null, 'and it was never played');
});

// แก้ผลรอบก่อนหน้าใหม่ ทีมที่เข้ารอบก็เปลี่ยน สำเนาที่จองไว้ต้องเปลี่ยนตาม
// ไม่งั้นรอบถัดไปจะจำคู่ที่ไม่เคยเกิดขึ้นจริงไว้ แล้วเอาไปตอบตอนมีทีมถูกลบ
test('reversing an earlier result reseats the pairing frozen for the next round', () => {
  const { matches, games } = getStores();
  const { id } = cup('Reseat cup', makeTeams(['Re A', 'Re B', 'Re C', 'Re D']));

  const round1 = matches.list(id).filter((m) => m.round === 1);
  const first = must(round1[0]);
  const other = must(round1[1]);
  const sideA = must(first.teamAId);
  const sideB = must(first.teamBId);

  decide(first, sideA, 2, 0);
  decide(other, must(other.teamAId), 2, 0);

  const finalId = must(matches.list(id).find((m) => m.round === 2)).id;
  const before = must(games.forMatch(finalId)[0]);
  assert.ok(
    [before.blueTeamId, before.redTeamId].includes(sideA),
    'the winner of the first match is seated in the final'
  );

  // กลับผลคู่แรก อีกทีมเข้ารอบแทน
  decide(first, sideB, 2, 0);

  const after = must(games.forMatch(finalId)[0]);
  const seated = [after.blueTeamId, after.redTeamId];
  assert.strictEqual(after.id, before.id, 'the same row, rewritten rather than duplicated');
  assert.ok(seated.includes(sideB), 'and it names who actually advanced');
  assert.ok(!seated.includes(sideA), 'the team that no longer advances is not left behind');
});

test('summaries cover every team in one call', () => {
  const { history } = getStores();
  const [winner, loser] = makeTeams(['Summary W', 'Summary L']);
  const { id } = cup('Summary cup', [must(winner), must(loser)]);

  const match = must(getStores().matches.list(id)[0]);
  decide(match, must(winner).id, 2, 0);

  const byId = new Map(history.summaries().map((s) => [s.teamId, s]));

  const w = must(byId.get(must(winner).id));
  assert.strictEqual(w.won, 1);
  assert.strictEqual(w.lost, 0);
  assert.strictEqual(w.tournaments, 1);

  const l = must(byId.get(must(loser).id));
  assert.strictEqual(l.won, 0);
  assert.strictEqual(l.lost, 1);

  // ทีมที่ไม่เคยลงทัวร์นาเมนต์ไหนเลยไม่ต้องมีแถว หน้าเว็บถือว่าไม่มี = ศูนย์
  const [idle] = makeTeams(['Never entered']);
  assert.strictEqual(byId.get(must(idle).id), undefined);
});
