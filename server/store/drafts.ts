// ประวัติพิค/แบนของทั้งทัวร์นาเมนต์ อ่านอย่างเดียว
//
// มองจาก "ทัวร์นาเมนต์ลงไปหาทุกดราฟต์ที่เคยเกิดขึ้น" ซึ่งไม่มีที่ไหนตอบให้อยู่แล้ว
//
//   games.forMatch()  ตอบทีละแมตช์ ต้องยิงทีละคู่แล้วมาต่อกันเอง
//   analytics         ตอบเป็นตัวเลขรวมรายฮีโร่ ไม่ใช่ดราฟต์ที่เกิดขึ้นจริงทีละเกม
//   matchup           ตอบเฉพาะคู่สองทีมที่ระบุ
//
// สิ่งที่หน้านี้ต้องการคือ "เกิดอะไรขึ้นบ้างในรายการนี้" เรียงตามเวลา
// ซึ่งเป็นคำถามที่คนพากย์กับคนวิเคราะห์ถามตลอด และเมื่อก่อนตอบไม่ได้เลย
//
// นับเฉพาะเกมที่มีดราฟต์จริง ไม่ใช่ทุกแถวในตาราง games
// games.freeze() จองแถวเกมที่ 1 ไว้ตั้งแต่ตอนจับสาย ก่อนที่จะมีใครเล่น
// แถวเปล่าพวกนั้นไม่ใช่ประวัติ มันคือที่ว่างที่รอถูกเติม

import type { DatabaseSync } from 'node:sqlite';

export interface DraftSide {
  teamId: string | null;
  /** ชื่อ ณ วันที่ลงเล่น จากสำเนาแช่แข็ง ไม่ใช่ชื่อปัจจุบัน */
  name: string;
  picks: (string | null)[];
  bans: (string | null)[];
  won: boolean;
}

export interface DraftGame {
  gameId: string;
  matchId: string;
  gameNo: number;
  bracket: string;
  round: number;
  bestOf: number;
  /** ผู้ชนะรายเกมถูกบันทึกไว้หรือยัง ไม่ได้บันทึก = ไม่รู้ว่าใครชนะเกมนี้ */
  decided: boolean;
  draftLocked: boolean;
  blue: DraftSide;
  red: DraftSide;
}

export interface DraftsStore {
  forTournament(tournamentId: string): DraftGame[];
}

interface Row { [key: string]: unknown }

const PICK_SLOTS = 5;
const BAN_SLOTS = 4;

export function createDraftsStore(db: DatabaseSync): DraftsStore {
  const q = {
    // เรียงใหม่สุดก่อน คนเปิดหน้ามาดู "เมื่อกี้เล่นอะไรกัน" ไม่ได้มาไล่ตั้งแต่เกมแรก
    games: db.prepare(
      `SELECT g.id, g.match_id, g.game_no, g.blue_team_id, g.red_team_id,
              g.blue_name, g.red_name, g.draft_locked, g.winner,
              m.bracket, m.round, m.best_of
         FROM games g
         JOIN matches m ON m.id = g.match_id
        WHERE m.tournament_id = ?
          AND EXISTS (SELECT 1 FROM game_slots s WHERE s.game_id = g.id)
        ORDER BY g.started_at DESC, g.game_no DESC`
    ),
    slots: db.prepare(
      `SELECT s.game_id, s.side, s.kind, s.idx, s.hero
         FROM game_slots s
         JOIN games g ON g.id = s.game_id
         JOIN matches m ON m.id = g.match_id
        WHERE m.tournament_id = ?`
    )
  };

  function emptySide(teamId: string | null, name: string): DraftSide {
    return {
      teamId,
      name,
      picks: Array.from({ length: PICK_SLOTS }, () => null),
      bans: Array.from({ length: BAN_SLOTS }, () => null),
      won: false
    };
  }

  return {
    forTournament(tournamentId) {
      const rows = q.games.all(tournamentId) as unknown as Row[];

      // ดึงช่องทั้งหมดครั้งเดียวแล้วแจกเข้าเกม ไม่ใช่ยิงต่อเกม
      // ทัวร์นาเมนต์หนึ่งมีได้เป็นร้อยเกม การยิงต่อเกมคือหลายร้อย query ต่อการเปิดหน้าหนึ่งครั้ง
      const byGame = new Map<string, Row[]>();
      (q.slots.all(tournamentId) as unknown as Row[]).forEach((s) => {
        const list = byGame.get(String(s.game_id)) || [];
        list.push(s);
        byGame.set(String(s.game_id), list);
      });

      return rows.map((r) => {
        const gameId = String(r.id);
        const winner = r.winner === null ? null : String(r.winner);

        const blue = emptySide(
          r.blue_team_id === null ? null : String(r.blue_team_id),
          String(r.blue_name || '')
        );
        const red = emptySide(
          r.red_team_id === null ? null : String(r.red_team_id),
          String(r.red_name || '')
        );
        blue.won = winner === 'blue';
        red.won = winner === 'red';

        // ชื่อฮีโร่ส่งดิบๆ ไม่กรองกับรายชื่อฮีโร่ปัจจุบัน
        // นี่คือประวัติ ฮีโร่ที่ถูกเปลี่ยนชื่อไฟล์ไปแล้วต้องยังปรากฏว่าเคยถูกเลือก
        // (กฎเดียวกับ restoreDraft ใน services/live-match.ts)
        (byGame.get(gameId) || []).forEach((s) => {
          const side = String(s.side) === 'blue' ? blue : red;
          const list = String(s.kind) === 'ban' ? side.bans : side.picks;
          const idx = Number(s.idx);
          if (idx >= 0 && idx < list.length) list[idx] = String(s.hero);
        });

        return {
          gameId,
          matchId: String(r.match_id),
          gameNo: Number(r.game_no),
          bracket: String(r.bracket || 'main'),
          round: Number(r.round || 0),
          bestOf: Number(r.best_of || 0),
          decided: winner !== null,
          draftLocked: Number(r.draft_locked) === 1,
          blue,
          red
        };
      });
    }
  };
}
