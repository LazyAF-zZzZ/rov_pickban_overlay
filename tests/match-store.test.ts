// เทสต์การสร้างสายและบันทึกผล ผ่าน store จริงบนฐานใน ':memory:'
//
// ต่อจาก bracket.test.ts ที่ทดสอบตัวอัลกอริทึมล้วนๆ
// ไฟล์นี้ทดสอบว่าเมื่อเก็บลงฐานแล้วผู้ชนะเดินไปรอบถัดไปถูกต้องจริง

import test from 'node:test';
import assert from 'node:assert';

import { openDatabase } from '../server/store/db';
import { createTeamStore } from '../server/store/teams';
import { createTournamentStore } from '../server/store/tournaments';
import { createMatchStore } from '../server/store/matches';
import { createGameStore } from '../server/store/games';
import type { Match } from '../server/store/matches';
import { must } from './helpers';

function stores(format = 'single_elim', bestOf = 3, teamCount = 4) {
  const db = openDatabase(':memory:');
  const teams = createTeamStore(db);
  const tournaments = createTournamentStore(db, teams);
  const games = createGameStore(db);
  const matches = createMatchStore(db, tournaments, games);

  const tournament = must(tournaments.create({ name: 'Cup', format, bestOf }).tournament);
  const ids: string[] = [];
  for (let i = 0; i < teamCount; i += 1) {
    const team = must(teams.create({ name: `Team ${i + 1}` }).team);
    ids.push(team.id);
    tournaments.addTeam(tournament.id, team.id, i);
  }
  return { db, teams, tournaments, matches, tournament, ids };
}

const round = (list: Match[], r: number) => list.filter((m) => m.round === r);

test('drawing a bracket stores it and a redraw replaces it rather than piling up', () => {
  const { matches, tournament } = stores('single_elim', 3, 4);

  const first = must(matches.generate(tournament.id).matches);
  assert.strictEqual(first.length, 3, 'two semis and a final');

  const second = must(matches.generate(tournament.id).matches);
  assert.strictEqual(second.length, 3, 'redrawing replaces, never appends');
  assert.notStrictEqual(second[0]?.id, first[0]?.id, 'a redraw is a fresh set of matches');
});

test('a bracket cannot be drawn with fewer than two teams', () => {
  const { matches, tournament } = stores('single_elim', 3, 1);
  const result = matches.generate(tournament.id);
  assert.ok(result.error);
  assert.match(result.error as string, /at least two teams/i);
});

// ---- TEST GOAL 2: Bo3 / Bo5 ต้องตัดสินเหมือนกัน ----

test('a Bo3 is only complete at two wins, and the winner moves on', () => {
  const { matches, tournament } = stores('single_elim', 3, 4);
  const drawn = must(matches.generate(tournament.id).matches);
  const semi = must(round(drawn, 1)[0]);

  const midway = must(matches.setResult(semi.id, 1, 0).match);
  assert.strictEqual(midway.status, 'live', '1-0 in a Bo3 is not finished');
  assert.strictEqual(midway.winnerId, null);

  const done = must(matches.setResult(semi.id, 2, 1).match);
  assert.strictEqual(done.status, 'complete');
  assert.strictEqual(done.winnerId, semi.teamAId);

  const final = must(matches.list(tournament.id).find((m) => m.round === 2));
  assert.strictEqual(final.teamAId, semi.teamAId, 'the winner was carried into the final');
});

test('a Bo5 needs three wins, not two', () => {
  const { matches, tournament } = stores('single_elim', 5, 4);
  const drawn = must(matches.generate(tournament.id).matches);
  const semi = must(round(drawn, 1)[0]);

  assert.strictEqual(must(matches.setResult(semi.id, 2, 2).match).status, 'live', '2-2 is not a Bo5 result');
  assert.strictEqual(must(matches.setResult(semi.id, 2, 2).match).winnerId, null);

  const done = must(matches.setResult(semi.id, 3, 2).match);
  assert.strictEqual(done.status, 'complete');
  assert.strictEqual(done.winnerId, semi.teamAId);
});

test('a score that both teams could not reach is refused', () => {
  const { matches, tournament } = stores('single_elim', 3, 4);
  const drawn = must(matches.generate(tournament.id).matches);
  const semi = must(round(drawn, 1)[0]);

  const bad = matches.setResult(semi.id, 2, 2);
  assert.ok(bad.error, 'nobody can win 2-2 in a Bo3');
  assert.match(bad.error as string, /cannot reach/i);
});

test('scores are clamped to what the series allows', () => {
  const { matches, tournament } = stores('single_elim', 3, 4);
  const drawn = must(matches.generate(tournament.id).matches);
  const semi = must(round(drawn, 1)[0]);

  const capped = must(matches.setResult(semi.id, 99, 0).match);
  assert.strictEqual(capped.scoreA, 2, 'a Bo3 cannot be won 99-0');
  assert.strictEqual(capped.status, 'complete');
});

// ---- BYES ----

test('byes are stored complete and their team is already in the next round', () => {
  const { matches, tournament, ids } = stores('single_elim', 3, 5);
  const drawn = must(matches.generate(tournament.id).matches);

  const byes = drawn.filter((m) => m.isBye);
  assert.strictEqual(byes.length, 3, 'five teams in an eight bracket');
  byes.forEach((m) => {
    assert.strictEqual(m.status, 'complete');
    assert.ok(m.winnerId);
  });

  // ทีมวางอันดับหนึ่งได้บาย ต้องไปโผล่ในรอบสองแล้ว
  const roundTwo = round(drawn, 2);
  const placed = roundTwo.flatMap((m) => [m.teamAId, m.teamBId]).filter(Boolean);
  assert.ok(placed.includes(must(ids[0])), 'the top seed is waiting in round two');

  // และรอบสองต้องไม่มีคู่ไหนถูกทำเครื่องหมายว่าเป็นบาย
  roundTwo.forEach((m) => assert.strictEqual(m.isBye, false));
});

test('a bye has no result to record', () => {
  const { matches, tournament } = stores('single_elim', 3, 5);
  const drawn = must(matches.generate(tournament.id).matches);
  const bye = must(drawn.find((m) => m.isBye));
  const result = matches.setResult(bye.id, 2, 0);
  assert.ok(result.error);
  assert.match(result.error as string, /bye/i);
});

test('a result cannot be recorded before both teams are known', () => {
  const { matches, tournament } = stores('single_elim', 3, 4);
  const drawn = must(matches.generate(tournament.id).matches);
  const final = must(drawn.find((m) => m.round === 2));
  const result = matches.setResult(final.id, 2, 0);
  assert.ok(result.error, 'the final has nobody in it yet');
  assert.match(result.error as string, /both teams/i);
});

// ---- ROUND ROBIN ----

test('a round robin stores every pairing once and nobody twice per round', () => {
  const { matches, tournament } = stores('round_robin', 3, 6);
  const drawn = must(matches.generate(tournament.id).matches);

  assert.strictEqual(drawn.length, (6 * 5) / 2, 'fifteen matches for six teams');

  const byRound = new Map<number, Set<string>>();
  drawn.forEach((m) => {
    if (!byRound.has(m.round)) byRound.set(m.round, new Set());
    const seen = byRound.get(m.round) as Set<string>;
    [m.teamAId, m.teamBId].forEach((id) => {
      if (!id) return;
      assert.ok(!seen.has(id), `${id} plays twice in round ${m.round}`);
      seen.add(id);
    });
  });
  assert.strictEqual(byRound.size, 5, 'six teams play five rounds');

  // พบกันหมดไม่มีรอบถัดไป ผู้ชนะไม่ต้องเดินไปไหน
  drawn.forEach((m) => assert.strictEqual(m.nextRound, null));
});

test('a round robin result completes without advancing anyone', () => {
  const { matches, tournament } = stores('round_robin', 3, 4);
  const drawn = must(matches.generate(tournament.id).matches);
  const first = must(drawn[0]);
  const done = must(matches.setResult(first.id, 2, 0).match);
  assert.strictEqual(done.status, 'complete');
  assert.strictEqual(done.winnerId, first.teamAId);
});

// ---- TEAM DELETION ----

test('deleting a team empties its slots but keeps the schedule', () => {
  const { matches, teams, tournament, ids } = stores('round_robin', 3, 4);
  const drawn = must(matches.generate(tournament.id).matches);
  const before = drawn.length;

  teams.remove(must(ids[0]));

  const after = matches.list(tournament.id);
  assert.strictEqual(after.length, before, 'the schedule survives a deleted team');
  const stillReferenced = after.some((m) => m.teamAId === ids[0] || m.teamBId === ids[0]);
  assert.strictEqual(stillReferenced, false, 'the deleted team is cleared from its slots');
});

test('deleting a tournament takes its matches with it', () => {
  const { matches, tournaments, tournament } = stores('round_robin', 3, 4);
  must(matches.generate(tournament.id).matches);
  tournaments.remove(tournament.id);
  assert.strictEqual(matches.list(tournament.id).length, 0);
});
