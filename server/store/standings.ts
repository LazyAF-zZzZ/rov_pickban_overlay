// ตารางคะแนนของทัวร์นาเมนต์หนึ่ง อ่านจากตารางแข่งที่บันทึกไว้แล้ว
//
// กติกาการเรียงอยู่ใน domain/standings.ts ทั้งหมด ไฟล์นี้แค่หยิบแถวมาป้อน
// และเติมชื่อทีมให้ ตัวคำนวณจึงยังทดสอบได้โดยไม่ต้องมีฐานข้อมูล
//
// คำนวณใหม่ทุกครั้งที่อ่าน ไม่เก็บตารางสะสมไว้ เหตุผลเดียวกับ analytics:
// ผลแมตช์แก้ย้อนหลังได้ตลอด ตัวเลขที่เก็บไว้แล้วหลุดจากความจริงโดยไม่มีใครรู้
// แย่กว่าการคำนวณใหม่ที่ช้ากว่านิดหน่อย

import type { DatabaseSync } from 'node:sqlite';
import type { StandingsMatch, StandingsGroup } from '../domain/standings';
import { buildStandings } from '../domain/standings';
import { isKnockoutBracket } from '../domain/bracket';

export interface NamedStandingRow {
  teamId: string;
  name: string;
  played: number;
  won: number;
  lost: number;
  gamesWon: number;
  gamesLost: number;
  gameDiff: number;
  points: number;
  rank: number;
  tied: boolean;
}

export interface NamedStandingsGroup {
  bracket: string;
  remaining: number;
  rows: NamedStandingRow[];
}

export interface StandingsStore {
  forTournament(tournamentId: string): NamedStandingsGroup[];
  /** แถวดิบ ไม่มีชื่อ ใช้ตอนเลื่อนชั้นซึ่งสนใจแค่ id */
  rawForTournament(tournamentId: string): StandingsGroup[];
}

interface Row { [key: string]: unknown }

export function createStandingsStore(db: DatabaseSync): StandingsStore {
  const q = {
    matches: db.prepare(
      `SELECT bracket, team_a_id, team_b_id, status, score_a, score_b, winner_id, is_bye
         FROM matches WHERE tournament_id = ?`
    ),
    // ชื่อจากทะเบียน และชื่อสำรองจากสำเนาแช่แข็งของเกม
    // ทีมที่ถูกลบออกจากทะเบียนแล้วยังต้องมีชื่อในตาราง ไม่ใช่ช่องว่าง
    names: db.prepare('SELECT id, name FROM teams'),
    frozen: db.prepare(
      `SELECT g.blue_team_id, g.red_team_id, g.blue_name, g.red_name
         FROM games g JOIN matches m ON m.id = g.match_id
        WHERE m.tournament_id = ?`
    )
  };

  // สายน็อกเอาต์ไม่ใช่กลุ่ม ต้องไม่โผล่ในตารางคะแนน
  //
  // กลุ่มถูกสร้างจาก "ชื่อสายที่พบในตารางแข่ง" พอวางสายน็อกเอาต์ต่อท้ายรอบแบ่งกลุ่ม
  // ในทัวร์นาเมนต์เดียวกัน มันจะกลายเป็นอีกกลุ่มหนึ่งทันที
  // (เห็นมาแล้ว: กระดานขึ้นห้ากลุ่มทั้งที่รายการมีสี่กลุ่ม)
  // และการเลื่อนชั้นรอบต่อไปก็จะไปติดที่ "กลุ่ม playoff ยังแข่งไม่จบ"
  function read(tournamentId: string): StandingsMatch[] {
    return (q.matches.all(tournamentId) as unknown as Row[])
      .filter((r) => !isKnockoutBracket(String(r.bracket || 'main')))
      .map((r) => ({
      bracket: String(r.bracket || 'main'),
      teamAId: r.team_a_id === null ? null : String(r.team_a_id),
      teamBId: r.team_b_id === null ? null : String(r.team_b_id),
      status: String(r.status || 'pending'),
      scoreA: Number(r.score_a || 0),
      scoreB: Number(r.score_b || 0),
      winnerId: r.winner_id === null ? null : String(r.winner_id),
      isBye: Number(r.is_bye) === 1
    }));
  }

  return {
    rawForTournament(tournamentId) {
      return buildStandings(read(tournamentId));
    },

    forTournament(tournamentId) {
      const groups = buildStandings(read(tournamentId));

      const names = new Map<string, string>();
      (q.frozen.all(tournamentId) as unknown as Row[]).forEach((r) => {
        if (r.blue_team_id && r.blue_name) names.set(String(r.blue_team_id), String(r.blue_name));
        if (r.red_team_id && r.red_name) names.set(String(r.red_team_id), String(r.red_name));
      });
      // ทะเบียนทับสำเนาแช่แข็ง ชื่อปัจจุบันสำคัญกว่าชื่อ ณ วันที่ลงเล่น
      // สำหรับตารางที่ยังแข่งอยู่ (ต่างจากหน้าประวัติที่ต้องการชื่อ ณ ตอนนั้น)
      (q.names.all() as unknown as Row[]).forEach((r) => {
        names.set(String(r.id), String(r.name));
      });

      return groups.map((group) => ({
        bracket: group.bracket,
        remaining: group.remaining,
        rows: group.rows.map((row) => ({ ...row, name: names.get(row.teamId) || '' }))
      }));
    }
  };
}
