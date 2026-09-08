// สองทีมนี้เคยเจอกันมาแล้วยังไง อ่านอย่างเดียว
//
// ข้อมูลทั้งหมดนี้ถูกเก็บอยู่แล้วตั้งแต่ Phase 5 (ดราฟต์รายเกม + ผู้ชนะรายเกม)
// แต่ไม่เคยถูกเอามาใช้บนอากาศเลย ทั้งที่มันคือสิ่งที่คนพากย์พูดถึงก่อนเริ่มคู่:
// เจอกันมากี่ครั้ง ใครนำ ครั้งก่อนใครชนะ แต่ละฝั่งชอบหยิบตัวไหน และแบนอะไรใส่กัน
//
// มองจาก "สองทีม" ไม่ใช่จากทีมเดียวแบบ history.ts และไม่ใช่จากฮีโร่แบบ analytics.ts
// จึงแยกไฟล์ ไม่ยัดเข้าไปในสองตัวนั้น
//
// นับเฉพาะเกมที่ดราฟต์ล็อกแล้ว (draft_locked = 1) เหมือน analytics
// ไม่งั้นเกมที่กำลังดราฟต์ค้างอยู่ตอนนี้จะถูกนับเป็นเจอกันอีกครั้งหนึ่ง

import type { DatabaseSync } from 'node:sqlite';

export interface MatchupHero {
  hero: string;
  count: number;
}

export interface MatchupSide {
  teamId: string;
  /** ชื่อ ณ ตอนนี้จากทะเบียน ถ้าทีมถูกลบไปแล้วจะเป็นชื่อจากสำเนาแช่แข็ง */
  name: string;
  seriesWon: number;
  gamesWon: number;
  topPicks: MatchupHero[];
  topBans: MatchupHero[];
}

export interface MatchupMeeting {
  tournamentName: string;
  bracket: string;
  round: number;
  scoreA: number;
  scoreB: number;
  /** id ของทีมที่ชนะซีรีส์นั้น null = ยังไม่จบ */
  winnerId: string | null;
}

export interface Matchup {
  a: MatchupSide;
  b: MatchupSide;
  seriesPlayed: number;
  gamesPlayed: number;
  meetings: MatchupMeeting[];
}

export interface MatchupStore {
  between(teamAId: string, teamBId: string, limit?: number): Matchup;
}

interface Row { [key: string]: unknown }

const MAX_MEETINGS = 20;
const TOP_HEROES = 5;

export function createMatchupStore(db: DatabaseSync): MatchupStore {
  const q = {
    // ซีรีส์ที่สองทีมนี้เจอกัน ไม่ว่าใครจะเป็นฝั่ง A
    meetings: db.prepare(
      `SELECT m.id, m.bracket, m.round, m.score_a, m.score_b, m.winner_id,
              m.team_a_id, m.status, t.name AS tournament_name
         FROM matches m
         JOIN tournaments t ON t.id = m.tournament_id
        WHERE m.is_bye = 0
          AND ((m.team_a_id = ? AND m.team_b_id = ?) OR (m.team_a_id = ? AND m.team_b_id = ?))
        ORDER BY m.created_at DESC`
    ),

    // ฮีโร่ที่ทีมหนึ่งหยิบหรือแบน "ในเกมที่เจอกับอีกทีมนี้เท่านั้น"
    //
    // เทียบด้วย blue_team_id / red_team_id ของสำเนาแช่แข็ง ไม่ใช่ของแมตช์
    // เพราะฝั่งบนจอสลับได้ และ game_slots.side เก็บตามสำเนา ไม่ใช่ตามจอ
    heroes: db.prepare(
      `SELECT s.hero AS hero, COUNT(*) AS n
         FROM game_slots s
         JOIN games g ON g.id = s.game_id
        WHERE g.draft_locked = 1
          AND s.kind = ?
          AND ((g.blue_team_id = ? AND g.red_team_id = ?) OR (g.red_team_id = ? AND g.blue_team_id = ?))
          AND ((g.blue_team_id = ? AND s.side = 'blue') OR (g.red_team_id = ? AND s.side = 'red'))
        GROUP BY s.hero
        ORDER BY n DESC, s.hero ASC
        LIMIT ?`
    ),

    // เกมที่เล่นจบไปแล้วระหว่างสองทีมนี้ พร้อมว่าฝั่งไหนชนะ
    games: db.prepare(
      `SELECT g.blue_team_id, g.red_team_id, g.winner, g.blue_name, g.red_name
         FROM games g
        WHERE g.draft_locked = 1
          AND ((g.blue_team_id = ? AND g.red_team_id = ?) OR (g.red_team_id = ? AND g.blue_team_id = ?))`
    ),

    name: db.prepare('SELECT name FROM teams WHERE id = ?')
  };

  // ชื่อทีม: ทะเบียนก่อน แล้วค่อยตกไปที่สำเนาแช่แข็ง
  // ทีมที่ถูกลบออกจากทะเบียนแล้วยังต้องมีชื่อขึ้นจอ ไม่ใช่ช่องว่าง
  // (เหตุผลเดียวกับ history.ts)
  function nameOf(teamId: string, games: Row[]): string {
    const row = q.name.get(teamId) as Row | undefined;
    if (row && row.name) return String(row.name);

    const frozen = games.find((g) => (
      String(g.blue_team_id) === teamId || String(g.red_team_id) === teamId
    ));
    if (!frozen) return '';
    return String(String(frozen.blue_team_id) === teamId ? frozen.blue_name : frozen.red_name);
  }

  function topHeroes(kind: 'pick' | 'ban', teamId: string, otherId: string): MatchupHero[] {
    const rows = q.heroes.all(
      kind, teamId, otherId, teamId, otherId, teamId, teamId, TOP_HEROES
    ) as unknown as Row[];
    return rows.map((r) => ({ hero: String(r.hero), count: Number(r.n) }));
  }

  return {
    between(teamAId, teamBId, limit = MAX_MEETINGS) {
      const games = q.games.all(teamAId, teamBId, teamAId, teamBId) as unknown as Row[];

      let gamesWonA = 0;
      let gamesWonB = 0;
      games.forEach((g) => {
        if (!g.winner) return;
        const winnerIsBlue = g.winner === 'blue';
        const winnerId = winnerIsBlue ? String(g.blue_team_id) : String(g.red_team_id);
        if (winnerId === teamAId) gamesWonA += 1;
        else if (winnerId === teamBId) gamesWonB += 1;
      });

      const rows = q.meetings.all(teamAId, teamBId, teamBId, teamAId) as unknown as Row[];
      const meetings: MatchupMeeting[] = rows.slice(0, Math.max(1, limit)).map((r) => {
        // คะแนนในตารางเก็บตามฝั่ง A/B ของแมตช์นั้น ไม่ใช่ตามทีมที่ผู้เรียกถาม
        // ต้องกลับด้านให้ตรงกับ a/b ที่ส่งเข้ามา ไม่งั้นสกอร์บนจอสลับกัน
        const aWasSideA = String(r.team_a_id) === teamAId;
        return {
          tournamentName: String(r.tournament_name || ''),
          bracket: String(r.bracket || 'main'),
          round: Number(r.round || 0),
          scoreA: Number(aWasSideA ? r.score_a : r.score_b),
          scoreB: Number(aWasSideA ? r.score_b : r.score_a),
          winnerId: r.winner_id === null ? null : String(r.winner_id)
        };
      });

      const decided = meetings.filter((m) => m.winnerId !== null);

      return {
        a: {
          teamId: teamAId,
          name: nameOf(teamAId, games),
          seriesWon: decided.filter((m) => m.winnerId === teamAId).length,
          gamesWon: gamesWonA,
          topPicks: topHeroes('pick', teamAId, teamBId),
          topBans: topHeroes('ban', teamAId, teamBId)
        },
        b: {
          teamId: teamBId,
          name: nameOf(teamBId, games),
          seriesWon: decided.filter((m) => m.winnerId === teamBId).length,
          gamesWon: gamesWonB,
          topPicks: topHeroes('pick', teamBId, teamAId),
          topBans: topHeroes('ban', teamBId, teamAId)
        },
        seriesPlayed: decided.length,
        gamesPlayed: gamesWonA + gamesWonB,
        meetings
      };
    }
  };
}
