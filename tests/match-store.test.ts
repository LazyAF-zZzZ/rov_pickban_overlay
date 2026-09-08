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
  assert.match(result.error as string, /at least 2 teams/i);
});

// เพดานล่างของแต่ละรูปแบบไม่เท่ากัน เช็คแค่ "สองทีม" ไม่พอ
//
// แพ้สองครั้งคัดออกที่มีสามทีม เคยผ่านการตรวจแล้วได้สายเปล่ากลับมา
// พร้อมสถานะสำเร็จ ทั้งที่สายเดิมถูกลบทิ้งไปแล้ว ซึ่งอ่านไม่ออกเลยว่าเกิดอะไรขึ้น
test('a format that needs more than two teams says so instead of drawing nothing', () => {
  ([['double_elim', 3], ['double_elim', 2], ['group_stage', 3]] as const).forEach(([format, count]) => {
    const { matches, tournament } = stores(format, 3, count);
    const result = matches.generate(tournament.id);
    assert.ok(result.error, `${format} with ${count} teams should be refused`);
    assert.match(result.error as string, /at least 4 teams/i);
    assert.strictEqual(matches.list(tournament.id).length, 0, 'nothing half-drawn is left behind');
  });
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

// แก้ผลที่กรอกผิด ต้องถอนคนที่เคยถูกดันเข้ารอบออกด้วย
//
// เดิมถอนไม่ออก: advance() ถูกเรียกเฉพาะตอนมีผู้ชนะ พอแก้ 2-0 กลับเป็น 1-1
// รอบถัดไปยังมีทีมเดิมนั่งอยู่ ทั้งที่รอบก่อนหน้ายังไม่มีผู้ชนะ
// สายจะโชว์ทีมที่ยังไม่ได้ผ่านเข้ารอบ และถ้าอีกช่องมีคนอยู่แล้ว คู่นั้นจะกดขึ้นจอได้เลย
test('undoing a recorded result takes the team back out of the next round', () => {
  const { matches, tournament } = stores('single_elim', 3, 4);
  const drawn = must(matches.generate(tournament.id).matches);
  const semi = must(round(drawn, 1)[0]);
  const finalOf = () => must(matches.list(tournament.id).find((m) => m.round === 2));

  must(matches.setResult(semi.id, 2, 0).match);
  assert.strictEqual(finalOf().teamAId, semi.teamAId, 'the winner reached the final');

  must(matches.setResult(semi.id, 1, 1).match);
  assert.strictEqual(finalOf().teamAId, null, 'an unfinished semi puts nobody in the final');

  // แก้เป็นอีกฝั่งชนะ ต้องเป็นคนใหม่ที่เข้ารอบ ไม่ใช่คนเดิมค้างอยู่
  must(matches.setResult(semi.id, 0, 2).match);
  assert.strictEqual(finalOf().teamAId, semi.teamBId, 'the corrected winner replaces the old one');
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

// แก้ผลรอบก่อนหน้า ต้องล้างผลของรอบถัดไปที่เล่นด้วยคนละคู่
//
// เจอด้วยการสุ่มลำดับคำสั่งแล้วตรวจ invariant ทุกก้าว ไม่ใช่ด้วยการอ่านโค้ด
//
// clearDestinations ถอนทีมออกจากช่องปลายทางให้แล้ว แต่ไม่เคยแตะ "ผล" ของคู่นั้น
// คู่ที่เล่นไปแล้วจึงเก็บคะแนนกับผู้ชนะเดิมไว้ ทั้งที่มีทีมอื่นมานั่งแทน
//
// ที่วัดได้จริงในสายสี่ทีม: ALPHA ชนะ DELTA แล้วชนะ BRAVO ในรอบชิง
// พอแก้ผลรอบแรกเป็น DELTA ชนะ รอบชิงกลายเป็น "DELTA พบ BRAVO ผู้ชนะคือ ALPHA"
// ทีมที่ตกรอบแรกไปแล้วยังเป็นแชมป์อยู่ในฐานข้อมูล
test('correcting an earlier result clears the results it invalidates', () => {
  const { matches, tournament, ids } = stores('single_elim', 1, 4);
  must(matches.generate(tournament.id).matches);

  const firstRound = matches.list(tournament.id).filter((m) => m.round === 1);
  const a = must(firstRound[0]);
  const b = must(firstRound[1]);
  must(matches.setResult(a.id, 1, 0).match);
  must(matches.setResult(b.id, 1, 0).match);

  const finalId = must(matches.list(tournament.id).find((m) => m.round === 2)).id;
  const beforeFinal = must(matches.get(finalId));
  const championSlot = beforeFinal.teamAId;
  must(matches.setResult(finalId, 1, 0).match);
  assert.strictEqual(must(matches.get(finalId)).winnerId, championSlot, 'the final was won');

  // คนคุมงานพบว่ากรอกผลคู่แรกกลับด้าน
  must(matches.setResult(a.id, 0, 1).match);

  const after = must(matches.get(finalId));
  assert.notStrictEqual(after.teamAId, championSlot, 'someone else advanced');
  assert.strictEqual(after.winnerId, null, 'the final it never played must not keep a winner');
  assert.strictEqual(after.status, 'pending');
  assert.deepStrictEqual([after.scoreA, after.scoreB], [0, 0]);
});

// และต้องไม่ล้างเวลาที่ไม่มีอะไรเปลี่ยน
//
// setResult ล้างช่องปลายทางแล้วเติมกลับทุกครั้งที่มีผู้ชนะเดิมอยู่ แม้ค่าจะเหมือนเดิม
// ถ้าเงื่อนไขการล้างผลผูกกับ "clearDestinations ถูกเรียกไหม" แทนที่จะเป็น
// "ผู้ชนะเปลี่ยนตัวไหม" การกดบันทึกผลเดิมซ้ำจะลบผลของทั้งสายที่อยู่ถัดไปทิ้ง
test('re-saving the same result leaves the rest of the bracket alone', () => {
  const { matches, tournament } = stores('single_elim', 1, 4);
  must(matches.generate(tournament.id).matches);

  const firstRound = matches.list(tournament.id).filter((m) => m.round === 1);
  must(matches.setResult(must(firstRound[0]).id, 1, 0).match);
  must(matches.setResult(must(firstRound[1]).id, 1, 0).match);

  const finalId = must(matches.list(tournament.id).find((m) => m.round === 2)).id;
  must(matches.setResult(finalId, 1, 0).match);
  const champion = must(matches.get(finalId)).winnerId;

  must(matches.setResult(must(firstRound[0]).id, 1, 0).match);   // ค่าเดิมเป๊ะ

  const after = must(matches.get(finalId));
  assert.strictEqual(after.winnerId, champion, 'nothing moved, so nothing should be lost');
  assert.strictEqual(after.status, 'complete');
});

// ถอยผลกลับเป็น "ยังไม่จบ" ก็ต้องล้างถัดไปเหมือนกัน
test('undoing a result also clears what it had fed', () => {
  const { matches, tournament } = stores('single_elim', 1, 4);
  must(matches.generate(tournament.id).matches);

  const firstRound = matches.list(tournament.id).filter((m) => m.round === 1);
  must(matches.setResult(must(firstRound[0]).id, 1, 0).match);
  must(matches.setResult(must(firstRound[1]).id, 1, 0).match);
  const finalId = must(matches.list(tournament.id).find((m) => m.round === 2)).id;
  must(matches.setResult(finalId, 1, 0).match);

  must(matches.setResult(must(firstRound[0]).id, 0, 0).match);

  const after = must(matches.get(finalId));
  assert.strictEqual(after.status, 'pending');
  assert.strictEqual(after.winnerId, null);
});

// สายแพ้สองครั้งคัดออกมีสองทางออกต่อคู่ ทั้งผู้ชนะและผู้แพ้ต้องถูกไล่ล้างทั้งคู่
test('the cascade follows the losers bracket too', () => {
  const { matches, tournament } = stores('double_elim', 1, 4);
  must(matches.generate(tournament.id).matches);

  const all = () => matches.list(tournament.id);
  // เล่นให้จบทั้งสายเท่าที่จับคู่ได้
  for (let pass = 0; pass < 6; pass += 1) {
    all().filter((m) => !m.isBye && m.teamAId && m.teamBId && m.status !== 'complete')
      .forEach((m) => matches.setResult(m.id, 1, 0));
  }
  const completedBefore = all().filter((m) => m.status === 'complete').length;
  assert.ok(completedBefore >= 3, 'the bracket really was played out');

  // แก้ผลคู่แรกสุดกลับด้าน
  const first = must(all().filter((m) => m.bracket === 'main' && m.round === 1)[0]);
  must(matches.setResult(first.id, 0, 1).match);

  // ทุกคู่ที่ยังบอกว่าจบแล้ว ต้องมีผู้ชนะที่เป็นหนึ่งในสองทีมของตัวเองจริงๆ
  all().forEach((m) => {
    if (m.status !== 'complete' || !m.winnerId) return;
    if (!m.teamAId || !m.teamBId) return;
    assert.ok(
      m.winnerId === m.teamAId || m.winnerId === m.teamBId,
      `${m.bracket}/${m.round}/${m.slot} kept a winner who is not in the match`
    );
  });
});
