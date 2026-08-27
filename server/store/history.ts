// ประวัติการแข่งของทีมหนึ่ง อ่านอย่างเดียว ไม่มีการเขียน
//
// เขียนแยกจาก matches.ts เพราะมองคนละทาง
// matches.ts มองจากทัวร์นาเมนต์ลงไปหาคู่แข่ง ("ทัวร์นาเมนต์นี้มีคู่ไหนบ้าง")
// ไฟล์นี้มองจากทีมออกไปหาทุกทัวร์นาเมนต์ ("ทีมนี้เคยเจอใครมาบ้าง")
// รวมไว้ที่เดียวกันจะได้ store ที่ทำสองอย่างและ query ที่อ่านยากทั้งคู่
//
// สำคัญ: ชื่อคู่แข่งมีสองแหล่ง และต้องใช้ให้ถูกทาง
// ปกติอ่านจากทะเบียนทีม (ชื่อ "ตอนนี้") แต่ถ้าคู่แข่งถูกลบออกจากทะเบียนไปแล้ว
// team_b_id จะกลายเป็น NULL (ON DELETE SET NULL) แล้วชื่อจะหายไปทั้งหมด
// ตรงนั้นจึงตกไปอ่านสำเนาแช่แข็งบน games แทน ซึ่งเก็บชื่อ ณ วันที่ลงเล่นจริง
// นี่คือเหตุผลที่ §4 ของแผนให้เก็บทั้งสองอย่าง ไม่ใช่แค่ id

import type { DatabaseSync } from 'node:sqlite';
import type { BestOf, TournamentFormat, TournamentStatus } from '../domain/tournament';
import type { MatchStatus } from './matches';

// null = ยังไม่จบ ยังตัดสินไม่ได้
export type MatchOutcome = 'win' | 'loss' | 'bye' | null;

export interface HistoryMatch {
  matchId: string;
  tournamentId: string;
  tournamentName: string;
  bracket: string;
  round: number;
  bestOf: BestOf;
  status: MatchStatus;
  isBye: boolean;
  opponentId: string | null;
  // null = ยังไม่รู้ว่าใคร (คู่ในรอบถัดไปที่ยังไม่มีใครขึ้นมา)
  opponentName: string | null;
  // true = เคยมีคู่แข่งจริง แต่ทีมนั้นถูกลบออกจากทะเบียนไปแล้ว
  // ชื่อที่เห็นมาจากสำเนาแช่แข็งบน games ไม่ใช่จากทะเบียน จึงกดเข้าไปดูโปรไฟล์ไม่ได้
  opponentGone: boolean;
  score: number;
  opponentScore: number;
  outcome: MatchOutcome;
}

export interface TeamRecord {
  played: number;
  won: number;
  lost: number;
  gamesWon: number;
  gamesLost: number;
  tournaments: number;
}

export interface TeamTournament {
  id: string;
  name: string;
  status: TournamentStatus;
  format: TournamentFormat;
  seed: number;
}

export interface TeamHistory {
  record: TeamRecord;
  tournaments: TeamTournament[];
  matches: HistoryMatch[];
}

// สรุปสั้นๆ ของทุกทีมพร้อมกัน สำหรับหน้ารายชื่อทีม
// ไม่ใช่ forTeam() ยิงทีละทีม เพราะทะเบียนอาจมีหลายร้อยทีม
export interface TeamSummary {
  teamId: string;
  tournaments: number;
  won: number;
  lost: number;
}

interface HistoryRow {
  id: string;
  tournament_id: string;
  tournament_name: string;
  bracket: string;
  round: number;
  slot: number;
  team_a_id: string | null;
  team_b_id: string | null;
  team_a_name: string | null;
  team_b_name: string | null;
  best_of: number;
  status: string;
  score_a: number;
  score_b: number;
  winner_id: string | null;
  is_bye: number;
}

interface TournamentRow {
  id: string;
  name: string;
  status: string;
  format: string;
  seed: number;
}

interface SnapshotRow {
  blue_team_id: string | null;
  red_team_id: string | null;
  blue_name: string;
  red_name: string;
}

export interface HistoryStore {
  forTeam(teamId: string): TeamHistory;
  summaries(): TeamSummary[];
}

export function createHistoryStore(db: DatabaseSync): HistoryStore {
  const q = {
    // เรียงจากทัวร์นาเมนต์ล่าสุดก่อน และในทัวร์นาเมนต์เดียวกันเอารอบท้ายขึ้นก่อน
    // คนเปิดหน้าโปรไฟล์มาดู "ล่าสุดเป็นยังไง" ไม่ได้มาไล่อ่านตั้งแต่รอบแรก
    matches: db.prepare(
      `SELECT m.id, m.tournament_id, m.bracket, m.round, m.slot,
              m.team_a_id, m.team_b_id, m.best_of, m.status,
              m.score_a, m.score_b, m.winner_id, m.is_bye,
              t.name AS tournament_name,
              ta.name AS team_a_name, tb.name AS team_b_name
         FROM matches m
         JOIN tournaments t ON t.id = m.tournament_id
         LEFT JOIN teams ta ON ta.id = m.team_a_id
         LEFT JOIN teams tb ON tb.id = m.team_b_id
        WHERE m.team_a_id = ? OR m.team_b_id = ?
        ORDER BY t.created_at DESC, m.bracket, m.round DESC, m.slot`
    ),

    tournaments: db.prepare(
      `SELECT t.id, t.name, t.status, t.format, tt.seed
         FROM tournament_teams tt
         JOIN tournaments t ON t.id = tt.tournament_id
        WHERE tt.team_id = ?
        ORDER BY t.created_at DESC`
    ),

    // เกมแรกของแมตช์ก็พอ ทุกเกมในซีรีส์เดียวกันแช่แข็งทีมชุดเดียวกัน
    snapshot: db.prepare(
      `SELECT blue_team_id, red_team_id, blue_name, red_name
         FROM games WHERE match_id = ? ORDER BY game_no LIMIT 1`
    ),

    // แพ้ชนะของทุกทีมในคิวรีเดียว ไม่ใช่ยิงทีละทีม
    //
    // ทีมหนึ่งอยู่ได้ทั้งฝั่ง A และฝั่ง B จึงต้อง UNION ALL สองด้านให้เป็นแถวเดียวกัน
    // ก่อนค่อย GROUP BY ตรงๆ ไม่งั้นต้องเขียน CASE ซ้อนกันจนอ่านไม่ออก
    //
    // บายไม่นับ (is_bye = 0) เพราะไม่ได้ลงเล่นจริง
    // ทีมที่ได้บายบ่อยจะดูมีสถิติสวยกว่าความจริงถ้านับรวม
    winLoss: db.prepare(
      `SELECT team_id,
              SUM(CASE WHEN won = 1 THEN 1 ELSE 0 END) AS won,
              SUM(CASE WHEN won = 0 THEN 1 ELSE 0 END) AS lost
         FROM (
           SELECT team_a_id AS team_id,
                  CASE WHEN winner_id = team_a_id THEN 1 ELSE 0 END AS won
             FROM matches
            WHERE status = 'complete' AND is_bye = 0
              AND winner_id IS NOT NULL AND team_a_id IS NOT NULL
           UNION ALL
           SELECT team_b_id AS team_id,
                  CASE WHEN winner_id = team_b_id THEN 1 ELSE 0 END AS won
             FROM matches
            WHERE status = 'complete' AND is_bye = 0
              AND winner_id IS NOT NULL AND team_b_id IS NOT NULL
         )
        GROUP BY team_id`
    ),

    entryCounts: db.prepare(
      'SELECT team_id, COUNT(*) AS n FROM tournament_teams GROUP BY team_id'
    )
  };

  // ชื่อคู่แข่งจากสำเนาแช่แข็ง ใช้เมื่อทีมนั้นถูกลบออกจากทะเบียนไปแล้ว
  //
  // เทียบด้วย id ของ "เรา" ไม่ใช่เดาจากฝั่ง
  // ถึง goLive จะวางฝั่ง A เป็นน้ำเงินเสมอ แต่การผูกกับ id ทำให้ไม่ต้องเชื่อข้อนั้น
  function frozenOpponentName(matchId: string, teamId: string): string | null {
    const row = q.snapshot.get(matchId) as SnapshotRow | undefined;
    if (!row) return null;
    if (row.blue_team_id === teamId) return row.red_name || null;
    if (row.red_team_id === teamId) return row.blue_name || null;
    return null;
  }

  function toHistoryMatch(row: HistoryRow, teamId: string): HistoryMatch {
    const weAreA = row.team_a_id === teamId;
    const opponentId = weAreA ? row.team_b_id : row.team_a_id;
    const registryName = weAreA ? row.team_b_name : row.team_a_name;
    const score = weAreA ? row.score_a : row.score_b;
    const opponentScore = weAreA ? row.score_b : row.score_a;
    const isBye = row.is_bye === 1;
    const status = row.status as MatchStatus;

    // ช่องว่างมีสองความหมาย ต้องแยกให้ออก
    // คู่ที่ยังไม่จบ = ยังไม่รู้ว่าจะเจอใคร
    // คู่ที่จบไปแล้วแต่ช่องว่าง = เคยเจอใครสักคน แล้วคนนั้นถูกลบทีหลัง
    let opponentName = registryName;
    let opponentGone = false;
    if (!opponentId && !isBye && status === 'complete') {
      opponentName = frozenOpponentName(row.id, teamId);
      opponentGone = true;
    }

    const outcome: MatchOutcome = isBye
      ? 'bye'
      : status === 'complete' && row.winner_id
        ? (row.winner_id === teamId ? 'win' : 'loss')
        : null;

    return {
      matchId: row.id,
      tournamentId: row.tournament_id,
      tournamentName: row.tournament_name,
      bracket: row.bracket,
      round: row.round,
      bestOf: row.best_of as BestOf,
      status,
      isBye,
      opponentId,
      opponentName,
      opponentGone,
      score,
      opponentScore,
      outcome
    };
  }

  return {
    forTeam(teamId) {
      const matches = (q.matches.all(teamId, teamId) as unknown as HistoryRow[])
        .map((row) => toHistoryMatch(row, teamId));

      const tournaments = (q.tournaments.all(teamId) as unknown as TournamentRow[])
        .map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status as TournamentStatus,
          format: row.format as TournamentFormat,
          seed: row.seed
        }));

      // บายไม่นับเป็นนัดที่ลงเล่น เพราะไม่ได้ลงเล่นจริง
      // นับรวมจะทำให้ทีมที่บ่อยๆ ได้บายดูเหมือนมีสถิติชนะสวยกว่าความจริง
      const record: TeamRecord = {
        played: 0,
        won: 0,
        lost: 0,
        gamesWon: 0,
        gamesLost: 0,
        tournaments: tournaments.length
      };

      matches.forEach((match) => {
        if (match.isBye) return;
        record.gamesWon += match.score;
        record.gamesLost += match.opponentScore;
        if (match.outcome === 'win') {
          record.played += 1;
          record.won += 1;
        } else if (match.outcome === 'loss') {
          record.played += 1;
          record.lost += 1;
        }
      });

      return { record, tournaments, matches };
    },

    summaries() {
      const merged = new Map<string, TeamSummary>();
      const at = (teamId: string): TeamSummary => {
        let row = merged.get(teamId);
        if (!row) {
          row = { teamId, tournaments: 0, won: 0, lost: 0 };
          merged.set(teamId, row);
        }
        return row;
      };

      (q.entryCounts.all() as unknown as { team_id: string; n: number }[])
        .forEach((row) => { at(row.team_id).tournaments = row.n; });

      (q.winLoss.all() as unknown as { team_id: string; won: number; lost: number }[])
        .forEach((row) => {
          const summary = at(row.team_id);
          summary.won = row.won;
          summary.lost = row.lost;
        });

      return [...merged.values()];
    }
  };
}
