// เกมแต่ละเกมในซีรีส์ พร้อมดราฟต์ที่บันทึกไว้
//
// หลักการที่สำคัญที่สุดของไฟล์นี้: บันทึกดราฟต์ "ระหว่างเล่น" ไม่ใช่ตอนจบ
//
// ทุกวันนี้กด RESET MATCH หรือโหลดพรีเซ็ตทีเดียว pick/ban ที่อยู่บนจอหายหมด
// ถ้ารอให้คนกดเซฟตอนจบ วันไหนลืมกดก็คือไม่มีข้อมูลเกมนั้นตลอดไป
// จึงมิเรอร์ทุกครั้งที่ดราฟต์เปลี่ยน แล้วสถิติแบบเรียลไทม์ก็ได้มาฟรีๆ
// เพราะข้อมูลถูกเขียนไว้แล้วตั้งแต่แรก ไม่ต้องมีขั้นตอน "ปิดงาน"

import type { DatabaseSync } from 'node:sqlite';
import { newId } from '../domain/ids';
import type { GameState } from '../domain/match';

export interface GameSlot {
  side: 'blue' | 'red';
  kind: 'pick' | 'ban';
  idx: number;
  hero: string;
}

export interface Game {
  id: string;
  matchId: string;
  gameNo: number;
  blueTeamId: string | null;
  redTeamId: string | null;
  blueName: string;
  redName: string;
  draftLocked: boolean;
  winner: 'blue' | 'red' | null;
  slots: GameSlot[];
}

interface GameRow {
  id: string; match_id: string; game_no: number;
  blue_team_id: string | null; red_team_id: string | null;
  blue_name: string; red_name: string;
  draft_locked: number; winner: string | null;
}

interface SlotRow { side: string; kind: string; idx: number; hero: string }

// ดราฟต์ครบ = แบนครบทั้งสองฝั่ง และเลือกครบทั้งสองฝั่ง
function isDraftComplete(state: GameState): boolean {
  return (['teamBlue', 'teamRed'] as const).every((team) => (
    state[team].picks.every(Boolean) && state[team].bans.every(Boolean)
  ));
}

function stateToSlots(state: GameState): GameSlot[] {
  const slots: GameSlot[] = [];
  ([['blue', 'teamBlue'], ['red', 'teamRed']] as const).forEach(([side, team]) => {
    state[team].picks.forEach((hero, idx) => {
      if (hero) slots.push({ side, kind: 'pick', idx, hero });
    });
    state[team].bans.forEach((hero, idx) => {
      if (hero) slots.push({ side, kind: 'ban', idx, hero });
    });
  });
  return slots;
}

export interface GameStore {
  get(id: string): Game | null;
  forMatch(matchId: string): Game[];
  ensure(matchId: string, gameNo: number, snapshot: {
    blueTeamId: string | null; redTeamId: string | null;
    blueName: string; redName: string;
  }): Game;
  freeze(matchId: string, teamAId: string, teamBId: string): Game | null;
  captureDraft(gameId: string, state: GameState): Game | null;
  setWinner(gameId: string, winner: 'blue' | 'red' | null): Game | null;
}

export function createGameStore(db: DatabaseSync): GameStore {
  const q = {
    insert: db.prepare(
      `INSERT INTO games (id, match_id, game_no, blue_team_id, red_team_id,
                          blue_name, red_name, draft_locked, winner, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`
    ),
    byId: db.prepare('SELECT * FROM games WHERE id = ?'),
    byMatchNo: db.prepare('SELECT * FROM games WHERE match_id = ? AND game_no = ?'),
    byMatch: db.prepare('SELECT * FROM games WHERE match_id = ? ORDER BY game_no'),
    slotsFor: db.prepare('SELECT side, kind, idx, hero FROM game_slots WHERE game_id = ? ORDER BY kind, side, idx'),
    clearSlots: db.prepare('DELETE FROM game_slots WHERE game_id = ?'),
    insertSlot: db.prepare('INSERT INTO game_slots (game_id, side, kind, idx, hero) VALUES (?, ?, ?, ?, ?)'),
    setLocked: db.prepare('UPDATE games SET draft_locked = ?, updated_at = ? WHERE id = ?'),
    setWinner: db.prepare('UPDATE games SET winner = ?, updated_at = ? WHERE id = ?'),

    // freeze() ต้องอ่านชื่อทีมเอง ไฟล์นี้จึงแตะตาราง teams ตรงๆ หนึ่งที่
    // ทางเลือกคือให้คนเรียกส่งชื่อมาด้วย แต่คนเรียกคือ matches.ts ซึ่งก็ต้องไปอ่านเองอยู่ดี
    // แล้วจะมีสองที่ที่รู้ว่า "สำเนาแช่แข็งประกอบด้วยอะไร" ซึ่งเป็นของไฟล์นี้
    teamName: db.prepare('SELECT name FROM teams WHERE id = ?'),
    countSlots: db.prepare('SELECT COUNT(*) AS n FROM game_slots WHERE game_id = ?'),
    reseat: db.prepare(
      `UPDATE games SET blue_team_id = ?, red_team_id = ?, blue_name = ?, red_name = ?,
                        updated_at = ? WHERE id = ?`
    )
  };

  function hydrate(row: GameRow): Game {
    const slots = (q.slotsFor.all(row.id) as unknown as SlotRow[]).map((s) => ({
      side: s.side as 'blue' | 'red',
      kind: s.kind as 'pick' | 'ban',
      idx: s.idx,
      hero: s.hero
    }));
    return {
      id: row.id,
      matchId: row.match_id,
      gameNo: row.game_no,
      blueTeamId: row.blue_team_id,
      redTeamId: row.red_team_id,
      blueName: row.blue_name,
      redName: row.red_name,
      draftLocked: row.draft_locked === 1,
      winner: (row.winner as 'blue' | 'red' | null) ?? null,
      slots
    };
  }

  const store: GameStore = {
    get(id) {
      const row = q.byId.get(id) as GameRow | undefined;
      return row ? hydrate(row) : null;
    },

    forMatch(matchId) {
      return (q.byMatch.all(matchId) as unknown as GameRow[]).map(hydrate);
    },

    // เกมเดิมมีอยู่แล้วก็ใช้ตัวเดิม ไม่สร้างซ้ำ
    // กดเปิดแมตช์เดิมอีกรอบจึงกลับไปต่อของเดิม ไม่ใช่เริ่มใหม่แล้วทิ้งดราฟต์เก่า
    ensure(matchId, gameNo, snapshot) {
      const existing = q.byMatchNo.get(matchId, gameNo) as GameRow | undefined;
      if (existing) return hydrate(existing);

      const id = newId('game');
      const now = Date.now();
      q.insert.run(
        id, matchId, gameNo,
        snapshot.blueTeamId, snapshot.redTeamId,
        snapshot.blueName, snapshot.redName,
        now, now
      );
      return hydrate(q.byId.get(id) as unknown as GameRow);
    },

    // จองสำเนาแช่แข็งไว้ตั้งแต่รู้ว่าใครเจอใคร ไม่ต้องรอให้แมตช์ขึ้นจอ
    //
    // เดิมสำเนาถูกเขียนตอน goLive() ที่เดียว คู่ที่กรอกคะแนนใส่ในสายโดยไม่เคยเปิดขึ้นจอ
    // จึงไม่มีแถว games เลยสักแถว พอลบทีมคู่แข่งออกจากทะเบียนทีหลัง
    // matches.team_b_id กลายเป็น NULL (ON DELETE SET NULL) แล้วไม่เหลือชื่อให้ถอยไปอ่าน
    // ประวัติของอีกทีมจะเหลือแค่ "ไม่รู้ว่าเจอใคร" ตลอดไป กู้ไม่ได้อีกเลย
    //
    // อัปเดตชื่อและคู่ให้ใหม่ได้ ตราบใดที่เกมนั้นยัง "ไม่ถูกแตะ" คือไม่มีดราฟต์และไม่มีผู้ชนะ
    // จำเป็นเพราะแก้คะแนนรอบก่อนหน้าใหม่ ทีมที่เข้ารอบก็เปลี่ยน คู่ที่จองไว้จะกลายเป็นของผิด
    // แต่พอมีดราฟต์แล้วห้ามแตะ นั่นคือเกมที่เล่นไปจริง การเขียนทับชื่อคือการปลอมข้อมูล
    freeze(matchId, teamAId, teamBId) {
      const blue = q.teamName.get(teamAId) as { name: string } | undefined;
      const red = q.teamName.get(teamBId) as { name: string } | undefined;
      if (!blue || !red) return null;

      const existing = q.byMatchNo.get(matchId, 1) as GameRow | undefined;
      if (!existing) {
        return store.ensure(matchId, 1, {
          blueTeamId: teamAId, redTeamId: teamBId,
          blueName: blue.name, redName: red.name
        });
      }

      const same = existing.blue_team_id === teamAId
        && existing.red_team_id === teamBId
        && existing.blue_name === blue.name
        && existing.red_name === red.name;
      if (same) return hydrate(existing);

      const untouched = existing.winner === null
        && existing.draft_locked !== 1
        && (q.countSlots.get(existing.id) as { n: number }).n === 0;
      if (!untouched) return hydrate(existing);

      q.reseat.run(teamAId, teamBId, blue.name, red.name, Date.now(), existing.id);
      return store.get(existing.id);
    },

    // เขียนทับช่องทั้งหมดของเกมนี้ด้วยสิ่งที่อยู่บนจอตอนนี้
    // ถูกเรียกทุกครั้งที่ดราฟต์เปลี่ยน จึงต้องถูกและเร็ว
    // ช่องมีไม่เกิน 18 ช่อง การลบแล้วเขียนใหม่ถูกกว่าการไล่เทียบทีละช่อง
    captureDraft(gameId, state) {
      const row = q.byId.get(gameId) as GameRow | undefined;
      if (!row) return null;

      const slots = stateToSlots(state);
      const now = Date.now();

      db.exec('BEGIN');
      try {
        q.clearSlots.run(gameId);
        slots.forEach((s) => q.insertSlot.run(gameId, s.side, s.kind, s.idx, s.hero));
        // ล็อกเมื่อครบ และไม่ปลดล็อกเองถ้าคนลบ pick ออกทีหลัง
        // ปลดล็อกอัตโนมัติจะทำให้เกมหลุดออกจากสถิติแบบเงียบๆ
        if (isDraftComplete(state) && row.draft_locked !== 1) {
          q.setLocked.run(1, now, gameId);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      return store.get(gameId);
    },

    setWinner(gameId, winner) {
      if (!q.byId.get(gameId)) return null;
      q.setWinner.run(winner, Date.now(), gameId);
      return store.get(gameId);
    }
  };

  return store;
}
