// ตารางแข่ง อ่าน/เขียนฐานข้อมูล
//
// การสร้างสายเป็นการ "แทนที่ทั้งชุด" ไม่ใช่การเติม
// สร้างใหม่ = ลบของเดิมทิ้งหมดแล้ววางชุดใหม่ ในทรานแซกชันเดียว
// จึงไม่มีสถานะครึ่งๆ ที่มีสายเก่าปนสายใหม่

import type { DatabaseSync } from 'node:sqlite';
import { newId } from '../domain/ids';
import type { BestOf } from '../domain/tournament';
import { seriesWinner } from '../domain/bracket';
import type { PlannedMatch, Rng } from '../domain/bracket';
import { generateMatches, shuffle } from '../domain/bracket';
import type { TournamentStore } from './tournaments';
import type { GameStore } from './games';

export type MatchStatus = 'pending' | 'live' | 'complete';

export interface Match {
  id: string;
  tournamentId: string;
  bracket: string;
  round: number;
  slot: number;
  teamAId: string | null;
  teamBId: string | null;
  bestOf: BestOf;
  status: MatchStatus;
  scoreA: number;
  scoreB: number;
  winnerId: string | null;
  isBye: boolean;
  nextRound: number | null;
  nextSlot: number | null;
  nextSide: number | null;
  nextBracket: string | null;
  loserRound: number | null;
  loserSlot: number | null;
  loserSide: number | null;
  loserBracket: string | null;
}

export type MatchResult = { match: Match; error?: undefined } | { error: string; match?: undefined };
export type GenerateOutcome =
  | { matches: Match[]; error?: undefined }
  | { error: string; matches?: undefined };

interface MatchRow {
  id: string; tournament_id: string; bracket: string; round: number; slot: number;
  team_a_id: string | null; team_b_id: string | null; best_of: number;
  status: string; score_a: number; score_b: number; winner_id: string | null;
  is_bye: number; next_round: number | null; next_slot: number | null; next_side: number | null;
  next_bracket: string | null;
  loser_round: number | null; loser_slot: number | null; loser_side: number | null;
  loser_bracket: string | null;
}

function rowToMatch(row: MatchRow): Match {
  return {
    id: row.id,
    tournamentId: row.tournament_id,
    bracket: row.bracket,
    round: row.round,
    slot: row.slot,
    teamAId: row.team_a_id,
    teamBId: row.team_b_id,
    bestOf: row.best_of as BestOf,
    status: row.status as MatchStatus,
    scoreA: row.score_a,
    scoreB: row.score_b,
    winnerId: row.winner_id,
    isBye: row.is_bye === 1,
    nextRound: row.next_round,
    nextSlot: row.next_slot,
    nextSide: row.next_side,
    nextBracket: row.next_bracket,
    loserRound: row.loser_round,
    loserSlot: row.loser_slot,
    loserSide: row.loser_side,
    loserBracket: row.loser_bracket
  };
}

export interface MatchStore {
  list(tournamentId: string): Match[];
  get(id: string): Match | null;
  generate(tournamentId: string, options?: { randomise?: boolean; rng?: Rng }): GenerateOutcome;
  clear(tournamentId: string): void;
  setResult(id: string, scoreA: unknown, scoreB: unknown): MatchResult;
}

// games เป็นพารามิเตอร์บังคับ ไม่ใช่ตัวเลือก
// สำเนาแช่แข็งคือสิ่งเดียวที่กู้ชื่อคู่แข่งที่ถูกลบไปแล้วได้
// ถ้าใส่หรือไม่ใส่ก็ได้ วันหนึ่งจะมีคนสร้าง store โดยไม่ใส่ แล้วช่องโหว่เดิมก็กลับมาเงียบๆ
export function createMatchStore(
  db: DatabaseSync,
  tournaments: TournamentStore,
  games: GameStore
): MatchStore {
  const q = {
    insert: db.prepare(
      `INSERT INTO matches
       (id, tournament_id, bracket, round, slot, team_a_id, team_b_id, best_of,
        status, score_a, score_b, winner_id, is_bye,
        next_round, next_slot, next_side, next_bracket,
        loser_round, loser_slot, loser_side, loser_bracket, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    clear: db.prepare('DELETE FROM matches WHERE tournament_id = ?'),
    byTournament: db.prepare(
      'SELECT * FROM matches WHERE tournament_id = ? ORDER BY bracket, round, slot'
    ),
    byId: db.prepare('SELECT * FROM matches WHERE id = ?'),
    atPosition: db.prepare(
      'SELECT * FROM matches WHERE tournament_id = ? AND bracket = ? AND round = ? AND slot = ?'
    ),
    setResult: db.prepare(
      'UPDATE matches SET score_a = ?, score_b = ?, winner_id = ?, status = ? WHERE id = ?'
    ),
    setSide: db.prepare('UPDATE matches SET team_a_id = ? WHERE id = ?'),
    setSideB: db.prepare('UPDATE matches SET team_b_id = ? WHERE id = ?')
  };

  const findRow = (id: string) => q.byId.get(id) as MatchRow | undefined;

  // จองสำเนาแช่แข็งของคู่นี้ทันทีที่รู้ครบว่าใครเจอใคร
  //
  // เรียกทุกจุดที่ช่องทีมของแมตช์เปลี่ยน: ตอนสร้างสาย ตอนดันผู้ชนะเข้ารอบ
  // และตอนบันทึกผลอีกครั้ง จุดสุดท้ายมีไว้ให้สายที่สร้างไว้ก่อนหน้านี้ได้สำเนาย้อนหลังด้วย
  //
  // บายไม่ต้องจอง ไม่มีใครลงเล่น และ §6 ของแผนถือว่าบายไม่นับเป็นนัด
  function freezePairing(row: MatchRow | undefined): void {
    if (!row || row.is_bye === 1) return;
    if (!row.team_a_id || !row.team_b_id) return;
    games.freeze(row.id, row.team_a_id, row.team_b_id);
  }

  // ส่งทีมไปยังคู่ปลายทางที่วางไว้ตอนสร้างสาย
  // ใช้ทั้งกับผู้ชนะ และกับผู้แพ้ที่ตกลงไปสายแพ้ในแบบแพ้สองครั้งคัดออก
  //
  // bracket ต้องอ่านจากปลายทาง ไม่ใช่จากคู่ต้นทาง
  // ผู้แพ้จากสายชนะไปโผล่คนละสาย ถ้าใช้ bracket ของต้นทางจะไปผิดที่
  function sendTo(
    tournamentId: string,
    dest: { bracket: string | null; round: number | null; slot: number | null; side: number | null },
    teamId: string
  ): void {
    if (dest.round === null || dest.slot === null || dest.side === null) return;
    const next = q.atPosition.get(
      tournamentId, dest.bracket ?? 'main', dest.round, dest.slot
    ) as MatchRow | undefined;
    if (!next) return;
    if (dest.side === 0) q.setSide.run(teamId, next.id);
    else q.setSideB.run(teamId, next.id);

    // อ่านแถวใหม่ ไม่ใช้ next ที่อ่านมาก่อนเขียน ค่าในนั้นยังเป็นของเก่า
    freezePairing(findRow(next.id));
  }

  function advance(match: Match, winnerId: string): void {
    sendTo(match.tournamentId, {
      bracket: match.nextBracket, round: match.nextRound,
      slot: match.nextSlot, side: match.nextSide
    }, winnerId);
  }

  function dropLoser(match: Match, loserId: string): void {
    sendTo(match.tournamentId, {
      bracket: match.loserBracket, round: match.loserRound,
      slot: match.loserSlot, side: match.loserSide
    }, loserId);
  }

  // รอบชิงแบบต้องชนะสองครั้ง
  //
  // แชมป์สายชนะ (ฝั่ง A) ยังไม่เคยแพ้ใครเลย ถ้าชนะนัดแรกก็จบ
  // นัดตัดสินไม่ต้องเล่น จึงล้างทีมออกจากนัดนั้นเพื่อไม่ให้กดผลได้
  //
  // ถ้าแชมป์สายแพ้ (ฝั่ง B) ชนะ = ต่างฝ่ายต่างแพ้คนละครั้ง เสมอกัน
  // ต้องเล่นนัดตัดสิน ซึ่ง advance/dropLoser เติมทีมให้เรียบร้อยแล้ว
  function settleGrandFinal(match: Match, winnerId: string): void {
    if (match.bracket !== 'grand' || match.round !== 1) return;

    const reset = q.atPosition.get(match.tournamentId, 'grand', 2, 0) as MatchRow | undefined;
    if (!reset) return;

    const winnersBracketChampWon = winnerId === match.teamAId;
    if (winnersBracketChampWon) {
      q.setSide.run(null, reset.id);
      q.setSideB.run(null, reset.id);
    }
  }

  const store: MatchStore = {
    list(tournamentId) {
      return (q.byTournament.all(tournamentId) as unknown as MatchRow[]).map(rowToMatch);
    },

    get(id) {
      const row = findRow(id);
      return row ? rowToMatch(row) : null;
    },

    clear(tournamentId) {
      q.clear.run(tournamentId);
    },

    generate(tournamentId, options = {}) {
      const tournament = tournaments.get(tournamentId);
      if (!tournament) return { error: 'Tournament not found' };

      const seeded = tournaments.teams(tournamentId);
      if (seeded.length < 2) return { error: 'Add at least two teams before drawing matches' };

      // สุ่ม = ไม่สนลำดับวาง / ไม่สุ่ม = เรียงตาม seed ที่ตั้งไว้
      const ids = seeded.map((t) => t.id);
      const ordered = options.randomise ? shuffle(ids, options.rng) : ids;

      const plan = generateMatches({ format: tournament.format, teamIds: ordered });
      if (plan.error !== undefined) return { error: plan.error };

      const now = Date.now();
      db.exec('BEGIN');
      try {
        // แทนที่ทั้งชุด ไม่ใช่เติมต่อ
        q.clear.run(tournamentId);
        (plan.matches as PlannedMatch[]).forEach((m) => {
          q.insert.run(
            newId('match'), tournamentId, m.bracket, m.round, m.slot,
            m.teamAId, m.teamBId, tournament.bestOf,
            m.isBye ? 'complete' : 'pending',
            m.winnerId, m.isBye ? 1 : 0,
            m.winnerTo?.round ?? null, m.winnerTo?.slot ?? null,
            m.winnerTo?.side ?? null, m.winnerTo?.bracket ?? null,
            m.loserTo?.round ?? null, m.loserTo?.slot ?? null,
            m.loserTo?.side ?? null, m.loserTo?.bracket ?? null, now
          );
        });
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        return { error: `Could not draw matches: ${(error as Error).message}` };
      }

      // บายรู้ผู้ชนะตั้งแต่ต้น ดันเข้ารอบถัดไปให้เลย
      // ทำหลัง COMMIT เพราะต้องอ่าน id ของคู่ถัดไปที่เพิ่งเขียนลงไป
      store.list(tournamentId)
        .filter((m) => m.isBye && m.winnerId)
        .forEach((m) => advance(m, m.winnerId as string));

      // จองสำเนาของทุกคู่ที่รู้ทั้งสองฝั่งแล้ว ทำหลังดันบายเข้ารอบ
      // เพราะคู่รอบสองที่ได้ทีมจากบายทั้งสองข้างก็ครบตั้งแต่ตอนนี้เหมือนกัน
      (q.byTournament.all(tournamentId) as unknown as MatchRow[]).forEach(freezePairing);

      return { matches: store.list(tournamentId) };
    },

    setResult(id, scoreA, scoreB) {
      const row = findRow(id);
      if (!row) return { error: 'Match not found' };
      const match = rowToMatch(row);

      if (match.isBye) return { error: 'A bye has no result to record' };
      if (!match.teamAId || !match.teamBId) {
        return { error: 'Both teams must be known before recording a result' };
      }

      // สายที่สร้างไว้ก่อนฟีเจอร์นี้จะยังไม่มีสำเนา จองให้ตรงนี้ก่อนบันทึกผล
      // เป็นจังหวะสุดท้ายที่ยังอ่านชื่อจากทะเบียนได้ครบทั้งสองฝั่ง
      freezePairing(row);

      const need = Math.floor(match.bestOf / 2) + 1;
      const a = Math.max(0, Math.min(need, Math.trunc(Number(scoreA)) || 0));
      const b = Math.max(0, Math.min(need, Math.trunc(Number(scoreB)) || 0));
      if (a === need && b === need) {
        return { error: `Both teams cannot reach ${need} wins in a Bo${match.bestOf}` };
      }

      const decided = seriesWinner(match.bestOf, a, b);
      const winnerId = decided === 'a' ? match.teamAId : decided === 'b' ? match.teamBId : null;
      const status: MatchStatus = winnerId ? 'complete' : (a + b > 0 ? 'live' : 'pending');

      q.setResult.run(a, b, winnerId, status, id);
      const updated = rowToMatch(findRow(id) as MatchRow);

      if (winnerId) {
        const loserId = winnerId === updated.teamAId ? updated.teamBId : updated.teamAId;
        advance(updated, winnerId);
        if (loserId) dropLoser(updated, loserId);
        settleGrandFinal(updated, winnerId);
      }

      return { match: updated };
    }
  };

  return store;
}
