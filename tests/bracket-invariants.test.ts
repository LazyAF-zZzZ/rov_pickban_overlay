// ตรวจกฎที่ต้องจริงเสมอ หลังลำดับคำสั่งที่สุ่มขึ้นมา
//
// ต่างจากเทสต์อื่นในโปรเจกต์ตรงที่ไม่ได้เขียนสถานการณ์ไว้ล่วงหน้า
// แต่สุ่มลำดับคำสั่งที่คนคุมงานทำได้จริง แล้วตรวจ "กฎที่ห้ามผิด" หลังทุกก้าว
//
// เทคนิคนี้หาเจอสองอย่างที่การอ่านโค้ดไม่เจอ ตอนรันแบบยาว (60 ทัวร์นาเมนต์
// x 25 ก้าว ต่อเมล็ด) และทั้งคู่เป็นความเสียหายแบบเงียบ:
//
//   1. แก้ผลรอบก่อนหน้าแล้วผลของรอบถัดไปไม่ถูกล้าง
//      รอบชิงกลายเป็น "DELTA พบ BRAVO ผู้ชนะคือ ALPHA" โดยที่ ALPHA ตกรอบแรกไปแล้ว
//   2. ย่อความยาวซีรีส์ของคู่ที่ดราฟต์ไปแล้ว ทำให้เกมที่เกินกติกาค้างอยู่ในฐาน
//
// สำคัญ: ไฟล์นี้ไม่ใช่ "ตัวเฝ้า" ของสองข้อนั้น
//
// ตัวเฝ้าจริงคือเทสต์ที่เขียนสถานการณ์ไว้ตรงๆ ใน match-store.test.ts กับ
// tournament-store.test.ts ซึ่งพิสูจน์แล้วว่าตกเมื่อถอดตัวแก้ออก
// ส่วนไฟล์นี้ลองแล้วว่ายังไม่เดินไปเจอสองสถานการณ์นั้นด้วยเมล็ดชุดนี้
// ในขนาดที่รันอยู่ตอนนี้ (เอาตัวแก้ออกแล้วมันยังเขียวอยู่)
//
// หน้าที่ของมันคือเป็น "แหอวน" สำหรับความพังที่ยังไม่มีใครรู้จัก
// ไม่ใช่การยืนยันบั๊กที่รู้แล้ว อย่าเอามันมาแทนเทสต์ที่เขียนสถานการณ์ชัดๆ
// และถ้าวันหนึ่งเมล็ดไหนทำให้ตก ให้แปลงสถานการณ์นั้นเป็นเทสต์ประจำอีกตัวทันที
//
// เมล็ดสุ่มตายตัว เทสต์จึงเป็นแบบเดิมทุกครั้ง ไม่ใช่เทสต์ที่แดงสลับเขียวเอง

import test from 'node:test';
import assert from 'node:assert';

import { openDatabase } from '../server/store/db';
import { createTeamStore } from '../server/store/teams';
import { createTournamentStore } from '../server/store/tournaments';
import { createMatchStore } from '../server/store/matches';
import { createGameStore } from '../server/store/games';
import { winsNeeded } from '../server/domain/bracket';
import { defaultState } from '../server/domain/match';
import { heroesData } from '../server/domain/heroes';
import { must } from './helpers';

const FORMATS = ['single_elim', 'double_elim', 'round_robin'];
const SERIES = [1, 3, 5, 7];
const HEROES = heroesData.heroes;

// ตัวสุ่มของตัวเอง ไม่ใช้ Math.random เพราะต้องทำซ้ำได้
function rngFrom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function checkInvariants(
  matches: ReturnType<typeof createMatchStore>,
  games: ReturnType<typeof createGameStore>,
  tournamentId: string,
  where: string
): void {
  const list = matches.list(tournamentId);
  const seen = new Set<string>();

  list.forEach((m) => {
    const at = `${m.bracket}/${m.round}/${m.slot}`;
    assert.ok(!seen.has(at), `${where}: two matches sit at ${at}`);
    seen.add(at);

    const need = winsNeeded(m.bestOf);
    assert.ok(m.scoreA <= need && m.scoreB <= need, `${where}: ${at} scored past the cap`);
    assert.ok(!(m.scoreA === need && m.scoreB === need), `${where}: ${at} has two winners`);

    // ผู้ชนะที่ชี้ไปยังทีมที่ถูกลบออกจากทะเบียนแล้วเป็นเรื่องที่ตั้งใจ
    // (history.ts ใช้ค่านั้นบอกว่าทีมที่เหลืออยู่แพ้นัดนั้น) จึงตรวจเฉพาะตอนที่
    // ทั้งสองช่องยังมีทีมอยู่จริง ซึ่งเป็นกรณีที่ผู้ชนะต้องเป็นหนึ่งในนั้นเสมอ
    if (m.winnerId && m.teamAId && m.teamBId) {
      assert.ok(
        m.winnerId === m.teamAId || m.winnerId === m.teamBId,
        `${where}: ${at} is ${m.status} with a winner who is not one of its two teams`
      );
    }

    const numbers = games.forMatch(m.id).map((g) => g.gameNo);
    assert.strictEqual(new Set(numbers).size, numbers.length, `${where}: ${at} has a repeated game number`);
    numbers.forEach((n) => assert.ok(
      n >= 1 && n <= m.bestOf,
      `${where}: ${at} keeps game ${n} in a Bo${m.bestOf}`
    ));

    games.forMatch(m.id).forEach((g) => {
      if (g.draftLocked) assert.strictEqual(g.slots.length, 18, `${where}: ${at} locked a partial draft`);
      g.slots.forEach((s) => assert.ok(
        s.side === 'blue' || s.side === 'red',
        `${where}: ${at} recorded a slot on side "${s.side}"`
      ));
    });
  });
}

function runSeed(seed: number): number {
  const rnd = rngFrom(seed);
  const pick = <T>(items: T[]): T => must(items[Math.floor(rnd() * items.length)]);
  const upTo = (n: number) => Math.floor(rnd() * n);

  const db = openDatabase(':memory:');
  const teams = createTeamStore(db);
  const tournaments = createTournamentStore(db, teams);
  const games = createGameStore(db);
  const matches = createMatchStore(db, tournaments, games);

  let steps = 0;

  for (let round = 0; round < 30; round += 1) {
    const format = pick(FORMATS);
    const bestOf = pick(SERIES);
    const tournament = must(tournaments.create({ name: `Cup ${round}`, format, bestOf }).tournament);

    const roster: string[] = [];
    const teamCount = 2 + upTo(7);
    for (let i = 0; i < teamCount; i += 1) {
      const team = must(teams.create({ name: `T${round}-${i}` }).team);
      roster.push(team.id);
      tournaments.addTeam(tournament.id, team.id, i);
    }

    if (matches.generate(tournament.id).error !== undefined) continue;
    checkInvariants(matches, games, tournament.id, `seed ${seed} cup ${round} after the draw`);

    for (let step = 0; step < 22; step += 1) {
      const playable = matches.list(tournament.id)
        .filter((m) => !m.isBye && m.teamAId && m.teamBId);
      if (playable.length === 0) break;

      const match = pick(playable);
      const need = winsNeeded(match.bestOf);
      const action = upTo(10);
      steps += 1;

      if (action < 3) {
        // แก้ผลของคู่ที่ "จบไปแล้ว" ให้กลับด้าน
        //
        // เล็งเข้าท่านี้ไว้ก่อน แทนที่จะหวังให้การสุ่มเดินมาเจอเอง
        // มันคือการกระทำที่พาบั๊กออกมา (พิมพ์คะแนนผิดแล้วมาแก้ทีหลัง) และเป็น
        // สิ่งที่คนคุมงานทำจริงบ่อยๆ ตอนลองตัดตัวแก้ออกแล้วรันด้วยส่วนผสมที่สุ่ม
        // ล้วนๆ เทสต์ผ่านหมดทุกเมล็ด ซึ่งแปลว่าเทสต์นั้นไม่ได้เฝ้าอะไรเลย
        const all = matches.list(tournament.id);
        const decidedAt = (bracket: string | null, round: number | null, slot: number | null) => (
          round !== null && slot !== null && all.some((m) => (
            m.bracket === (bracket ?? 'main') && m.round === round && m.slot === slot
            && m.status === 'complete'
          ))
        );

        // เล็งไปที่คู่ที่ "จบแล้ว และคู่ปลายทางก็จบแล้ว" ก่อนเสมอถ้ามี
        // สถานการณ์นั้นต้องเรียงกันพอดีสามชั้น (ปิดคู่ป้อนทั้งสอง ปิดคู่ปลายทาง
        // แล้วค่อยย้อนกลับมาแก้คู่ป้อน) การสุ่มล้วนๆ แทบไม่เดินไปถึง
        const feeders = all.filter((m) => (
          m.status === 'complete' && m.teamAId && m.teamBId && !m.isBye
          && (decidedAt(m.nextBracket, m.nextRound, m.nextSlot)
            || decidedAt(m.loserBracket, m.loserRound, m.loserSlot))
        ));
        const decided = feeders.length > 0
          ? feeders
          : all.filter((m) => m.status === 'complete' && m.teamAId && m.teamBId && !m.isBye);
        if (decided.length > 0) {
          const fix = pick(decided);
          matches.setResult(fix.id, fix.scoreB, fix.scoreA);
        }
      } else if (action < 5) {
        // กรอกผล รวมถึงค่าที่เกินกติกาและการถอยผลกลับเป็น 0-0
        matches.setResult(match.id, upTo(need + 2), upTo(need + 2));
      } else if (action < 7) {
        // ดราฟต์ลงเกมหนึ่งของคู่นี้ โดยไม่แตะคะแนน
        const gameNo = 1 + upTo(match.bestOf);
        const frozen = games.ensure(match.id, gameNo, {
          blueTeamId: match.teamAId, redTeamId: match.teamBId,
          blueName: 'blue', redName: 'red'
        });
        games.captureDraft(frozen.id, {
          ...defaultState,
          teamBlue: { ...defaultState.teamBlue, name: 'blue', picks: [pick(HEROES), null, null, null, null] },
          teamRed: { ...defaultState.teamRed, name: 'red' }
        });
      } else if (action < 8) {
        teams.remove(pick(roster));
      } else {
        tournaments.update(tournament.id, {
          name: `Cup ${round}`, format, bestOf: pick(SERIES), status: 'active', note: ''
        });
      }

      checkInvariants(matches, games, tournament.id, `seed ${seed} cup ${round} step ${step} action ${action}`);
    }
  }

  db.close();
  return steps;
}

// เมล็ดเหล่านี้เคยจับบั๊กได้จริงตอนหาครั้งแรก เก็บไว้เป็นชุดประจำ
[1, 7, 99, 555, 12345, 424242, 8675309, 20260906].forEach((seed) => {
  test(`bracket invariants hold through a random run (seed ${seed})`, () => {
    const steps = runSeed(seed);
    assert.ok(steps > 40, `seed ${seed} only managed ${steps} operations - the run stopped early`);
  });
});
