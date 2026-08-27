// สถิติ pick/ban อ่านจากดราฟต์ที่บันทึกไว้
//
// คำนวณใหม่ทุกครั้งที่อ่าน ไม่เก็บตัวนับสะสมไว้
// 300 เกม x 18 ช่อง = 5,400 แถว ซึ่ง SQLite รวมให้เสร็จในเวลาไม่ถึงมิลลิวินาที
// ตัวนับสะสมจะเร็วกว่าก็จริง แต่ต้องคอยแก้ให้ตรงทุกครั้งที่ดราฟต์เปลี่ยน
// และดราฟต์ถูกเขียนทับทั้งชุดทุกครั้งที่มีคนแตะ (ดู games.captureDraft)
// ตัวนับที่หลุดจากความจริงแล้วไม่มีใครรู้ แย่กว่าการคำนวณใหม่ที่ช้ากว่านิดหน่อย
//
// นับเฉพาะเกมที่ดราฟต์ล็อกแล้ว (draft_locked = 1)
// ถ้านับเกมที่ดราฟต์ค้างกลางคันด้วย ตัวหารจะโตขึ้นก่อนที่ตัวเศษจะตามมา
// อัตราของฮีโร่ทุกตัวจะร่วงพร้อมกันระหว่างที่ดราฟต์กำลังดำเนินอยู่

import type { DatabaseSync } from 'node:sqlite';
import type { HeroCounts } from '../domain/analytics';
import { FIRST_BAN_PHASE_MAX_INDEX } from '../domain/analytics';

export interface AnalyticsScope {
  tournamentId?: string | null;
  teamId?: string | null;
}

export interface AnalyticsRaw {
  counts: HeroCounts[];
  games: number;
  decidedGames: number;
}

interface CountRow {
  hero: string;
  picked: number;
  banned: number;
  present: number;
  early_bans: number;
  wins: number;
  decided: number;
}

export interface AnalyticsStore {
  read(scope?: AnalyticsScope): AnalyticsRaw;
}

export function createAnalyticsStore(db: DatabaseSync): AnalyticsStore {
  // ประกอบ SQL จากชิ้นส่วนที่เขียนตายไว้เท่านั้น
  // ค่าจากผู้ใช้เข้าทาง ? เสมอ ไม่มีการต่อสตริงกับ id ที่รับมา
  function where(scope: AnalyticsScope): { joins: string; slotFilter: string; gameFilter: string; params: string[] } {
    const params: string[] = [];
    let joins = '';
    let gameFilter = '';
    let slotFilter = '';

    if (scope.tournamentId) {
      joins = ' JOIN matches m ON m.id = g.match_id';
      gameFilter += ' AND m.tournament_id = ?';
    }

    // มองจากมุมของทีมเดียว: นับเฉพาะช่องฝั่งที่ทีมนั้นเล่นอยู่
    // ไม่งั้นจะกลายเป็นสถิติของทั้งสองทีมในเกมที่ทีมนี้ลงเล่น ซึ่งไม่ได้ตอบอะไร
    if (scope.teamId) {
      gameFilter += ' AND (g.blue_team_id = ? OR g.red_team_id = ?)';
      slotFilter = ` AND ((g.blue_team_id = ? AND s.side = 'blue')`
        + ` OR (g.red_team_id = ? AND s.side = 'red'))`;
    }

    if (scope.tournamentId) params.push(scope.tournamentId);
    if (scope.teamId) params.push(scope.teamId, scope.teamId);

    return { joins, slotFilter, gameFilter, params };
  }

  return {
    read(scope = {}) {
      const { joins, slotFilter, gameFilter, params } = where(scope);

      // ตัวหาร: จำนวนเกมที่ล็อกแล้วในขอบเขตนี้
      const totals = db.prepare(
        `SELECT COUNT(*) AS games,
                SUM(CASE WHEN g.winner IS NOT NULL THEN 1 ELSE 0 END) AS decided
           FROM games g${joins}
          WHERE g.draft_locked = 1${gameFilter}`
      ).get(...params) as { games: number; decided: number | null };

      // COUNT(DISTINCT game_id) ไม่ใช่ COUNT(*)
      // ฮีโร่ตัวเดียวลงได้ครั้งเดียวต่อเกมอยู่แล้ว แต่การนับแบบ distinct
      // ทำให้ข้อมูลที่เพี้ยนมาจากข้างนอกไม่ดันตัวเลขให้เกินจำนวนเกมจริง
      const slotParams = scope.teamId
        ? [...params, scope.teamId, scope.teamId]
        : params;

      const rows = db.prepare(
        `SELECT s.hero AS hero,
                COUNT(DISTINCT CASE WHEN s.kind = 'pick' THEN s.game_id END) AS picked,
                COUNT(DISTINCT CASE WHEN s.kind = 'ban'  THEN s.game_id END) AS banned,
                COUNT(DISTINCT s.game_id) AS present,
                COUNT(DISTINCT CASE WHEN s.kind = 'ban' AND s.idx <= ${FIRST_BAN_PHASE_MAX_INDEX}
                                    THEN s.game_id END) AS early_bans,
                COUNT(DISTINCT CASE WHEN s.kind = 'pick' AND g.winner = s.side
                                    THEN s.game_id END) AS wins,
                COUNT(DISTINCT CASE WHEN s.kind = 'pick' AND g.winner IS NOT NULL
                                    THEN s.game_id END) AS decided
           FROM game_slots s
           JOIN games g ON g.id = s.game_id${joins}
          WHERE g.draft_locked = 1${gameFilter}${slotFilter}
          GROUP BY s.hero`
      ).all(...slotParams) as unknown as CountRow[];

      return {
        games: totals.games || 0,
        decidedGames: totals.decided || 0,
        counts: rows.map((row) => ({
          hero: row.hero,
          picked: row.picked,
          banned: row.banned,
          present: row.present,
          earlyBans: row.early_bans,
          wins: row.wins,
          decided: row.decided
        }))
      };
    }
  };
}
