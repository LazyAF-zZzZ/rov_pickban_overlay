// ตารางคะแนน สำหรับรูปแบบที่แข่งพบกันหมด (พบกันหมด และแบ่งกลุ่ม)
//
// รูปแบบพวกนี้ไม่มีสายให้ดูว่าใครไปต่อ ตารางคะแนนคือตัวการแข่งขันเอง
// ก่อนหน้านี้แอพสร้างคู่ให้ครบแล้วปล่อยมือ คนจัดต้องมานั่งนับคะแนนเองบนกระดาษ
//
// ทั้งไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ รับรายการแมตช์เข้ามาแล้วคืนตาราง
// ไม่รู้จักฐานข้อมูล เทสต์จึงเขียนสถานการณ์ตรงๆ ได้โดยไม่ต้องเปิดเซิร์ฟเวอร์

export interface StandingsMatch {
  bracket: string;
  teamAId: string | null;
  teamBId: string | null;
  status: string;
  scoreA: number;
  scoreB: number;
  winnerId: string | null;
  isBye: boolean;
}

export interface StandingRow {
  teamId: string;
  played: number;
  won: number;
  lost: number;
  /** เกมที่ชนะรวมทุกนัด ใช้ตัดสินตอนคะแนนเท่ากัน */
  gamesWon: number;
  gamesLost: number;
  gameDiff: number;
  points: number;
  /** อันดับในกลุ่ม เริ่มที่ 1 ทีมที่เสมอกันทุกอย่างได้อันดับเดียวกัน */
  rank: number;
  /** อันดับนี้ยังตัดสินไม่ได้ เพราะมีทีมอื่นเท่ากันทุกตัวชี้วัด */
  tied: boolean;
}

export interface StandingsGroup {
  bracket: string;
  rows: StandingRow[];
  /** นัดที่ยังไม่ได้เล่นในกลุ่มนี้ ตารางยังไม่นิ่งจนกว่าจะเป็นศูนย์ */
  remaining: number;
}

// ชนะได้ 3 แพ้ได้ 0
//
// ไม่มีเสมอในเกมนี้ ระบบ 3-0 กับ 1-0 จึงเรียงเหมือนกันเป๊ะ
// เลือก 3 แต้มเพราะเป็นเลขที่คนดูกีฬาคุ้นตา และเผื่อไว้ถ้าวันหลังมีกติกาที่นับเสมอ
export const WIN_POINTS = 3;
export const LOSS_POINTS = 0;

function blankRow(teamId: string): StandingRow {
  return {
    teamId,
    played: 0, won: 0, lost: 0,
    gamesWon: 0, gamesLost: 0, gameDiff: 0,
    points: 0, rank: 0, tied: false
  };
}

// ลำดับการตัดสิน: แต้ม -> ผลต่างเกม -> เกมที่ชนะ -> จำนวนนัดที่ชนะ
//
// ไม่ตัดสินด้วยผลเจอกันเอง (head-to-head) ตั้งใจ
// มันฟังดูยุติธรรมกว่า แต่พอสามทีมวนกันเป็นวงกลม (A ชนะ B ชนะ C ชนะ A)
// กติกานั้นตัดสินอะไรไม่ได้เลย แล้วโปรแกรมจะต้องเดา ซึ่งแย่กว่าการบอกตรงๆ
// ว่า "เท่ากัน ตัดสินเองนะ" เพราะคนจัดมีกติกาของรายการตัวเองอยู่แล้ว
function compareRows(a: StandingRow, b: StandingRow): number {
  if (a.points !== b.points) return b.points - a.points;
  if (a.gameDiff !== b.gameDiff) return b.gameDiff - a.gameDiff;
  if (a.gamesWon !== b.gamesWon) return b.gamesWon - a.gamesWon;
  return b.won - a.won;
}

function sameStrength(a: StandingRow, b: StandingRow): boolean {
  return compareRows(a, b) === 0;
}

// สร้างตารางของกลุ่มเดียว
//
// teamIds คือทีมที่ "อยู่ในกลุ่มนี้" ไม่ใช่ทีมที่เคยลงเล่น
// ทีมที่ยังไม่ได้เล่นสักนัดต้องมีแถวของตัวเองอยู่ในตารางด้วย ไม่ใช่หายไป
export function buildGroup(
  bracket: string,
  teamIds: readonly string[],
  matches: readonly StandingsMatch[]
): StandingsGroup {
  const rows = new Map<string, StandingRow>();
  teamIds.forEach((id) => rows.set(id, blankRow(id)));

  const ofBracket = matches.filter((m) => m.bracket === bracket && !m.isBye);
  let remaining = 0;

  ofBracket.forEach((match) => {
    const { teamAId, teamBId } = match;
    if (!teamAId || !teamBId) return;

    // ทีมที่โผล่ในแมตช์แต่ไม่ได้อยู่ในรายชื่อที่ส่งมา ยังต้องนับ
    // (ทีมถูกถอดออกจากทัวร์นาเมนต์หลังจับสายแล้ว แต่นัดที่เล่นไปแล้วยังจริงอยู่)
    if (!rows.has(teamAId)) rows.set(teamAId, blankRow(teamAId));
    if (!rows.has(teamBId)) rows.set(teamBId, blankRow(teamBId));

    if (match.status !== 'complete' || !match.winnerId) {
      remaining += 1;
      return;
    }

    const a = rows.get(teamAId) as StandingRow;
    const b = rows.get(teamBId) as StandingRow;

    a.played += 1;
    b.played += 1;
    a.gamesWon += match.scoreA;
    a.gamesLost += match.scoreB;
    b.gamesWon += match.scoreB;
    b.gamesLost += match.scoreA;

    // ผู้ชนะที่ชี้ไปยังทีมที่ถูกลบออกจากทะเบียนแล้ว ยังนับให้ฝั่งที่เหลือแพ้ได้
    // (ดู history.ts ค่านั้นตั้งใจให้ค้างไว้)
    if (match.winnerId === teamAId) { a.won += 1; b.lost += 1; }
    else if (match.winnerId === teamBId) { b.won += 1; a.lost += 1; }
    else { a.lost += 1; b.lost += 1; }
  });

  const list = [...rows.values()];
  list.forEach((row) => {
    row.gameDiff = row.gamesWon - row.gamesLost;
    row.points = row.won * WIN_POINTS + row.lost * LOSS_POINTS;
  });
  list.sort(compareRows);

  // อันดับแบบแข่งขัน: เท่ากันได้อันดับเดียวกัน แล้วข้ามเลขถัดไป
  // 1, 1, 3 ไม่ใช่ 1, 1, 2 — คนอ่านตารางกีฬาคาดหวังแบบนี้
  list.forEach((row, index) => {
    const previous = list[index - 1];
    row.rank = previous && sameStrength(previous, row) ? previous.rank : index + 1;
  });

  // ทำเครื่องหมายว่าแถวไหนยังตัดสินไม่ได้ เพื่อให้หน้าจอบอกคนจัดได้ตรงๆ
  // ว่าต้องไปใช้กติกาของรายการตัวเอง ไม่ใช่ให้โปรแกรมเดาแทน
  list.forEach((row, index) => {
    const before = list[index - 1];
    const after = list[index + 1];
    row.tied = Boolean((before && sameStrength(before, row)) || (after && sameStrength(after, row)));
  });

  return { bracket, rows: list, remaining };
}

// ทุกกลุ่มของทัวร์นาเมนต์
//
// membership บอกว่าทีมไหนอยู่กลุ่มไหน อ่านจากแมตช์ที่จับไว้แล้ว
// ไม่ได้คำนวณการแบ่งกลุ่มซ้ำ เพราะการแบ่งเกิดขึ้นครั้งเดียวตอนจับสาย
// และทีมอาจถูกเพิ่ม/ถอดหลังจากนั้น การคำนวณใหม่จะให้คำตอบคนละอย่างกับสายที่เล่นอยู่จริง
export function groupsOf(matches: readonly StandingsMatch[]): Map<string, string[]> {
  const members = new Map<string, Set<string>>();

  matches.forEach((match) => {
    if (!members.has(match.bracket)) members.set(match.bracket, new Set());
    const set = members.get(match.bracket) as Set<string>;
    if (match.teamAId) set.add(match.teamAId);
    if (match.teamBId) set.add(match.teamBId);
  });

  const out = new Map<string, string[]>();
  [...members.keys()].sort().forEach((bracket) => {
    out.set(bracket, [...(members.get(bracket) as Set<string>)]);
  });
  return out;
}

export function buildStandings(matches: readonly StandingsMatch[]): StandingsGroup[] {
  const groups = groupsOf(matches);
  return [...groups.entries()].map(([bracket, teamIds]) => buildGroup(bracket, teamIds, matches));
}

// ---- การเลื่อนชั้นเข้ารอบน็อกเอาต์ ------------------------------------

export interface PromotionResult {
  teamIds: string[];
  error?: undefined;
}
export interface PromotionError {
  error: string;
  teamIds?: undefined;
}

// เอาทีมอันดับ 1..perGroup ของทุกกลุ่มมาเรียงเป็นสายเดียว
//
// เรียงแบบสลับกลุ่ม: ที่ 1 ของทุกกลุ่มก่อน แล้วค่อยที่ 2 ของทุกกลุ่ม
// เพื่อให้ตอนจับสายน็อกเอาต์ หัวกลุ่มไม่เจอกันเองตั้งแต่รอบแรก
// (singleElimination จับคู่หัวกับท้ายของรายการที่ได้รับ)
//
// ปฏิเสธเมื่ออันดับที่ตัดยังไม่นิ่ง ดีกว่าเลื่อนทีมผิดขึ้นไปแล้วมารู้ทีหลัง
// ตอนที่สายถูกจับไปแล้วและมีคนเล่นไปแล้วหนึ่งนัด
export function promoteFromGroups(
  groups: readonly StandingsGroup[],
  perGroup: number
): PromotionResult | PromotionError {
  if (groups.length === 0) return { error: 'There are no groups to promote from' };
  const take = Math.trunc(perGroup);
  if (!Number.isFinite(take) || take < 1) return { error: 'Promote at least one team per group' };

  const unfinished = groups.filter((g) => g.remaining > 0);
  if (unfinished.length > 0) {
    const names = unfinished.map((g) => g.bracket).join(', ');
    return { error: `Group ${names} still has matches to play` };
  }

  const tooSmall = groups.find((g) => g.rows.length < take);
  if (tooSmall) {
    return { error: `Group ${tooSmall.bracket} has only ${tooSmall.rows.length} teams` };
  }

  // ตำแหน่งสุดท้ายที่ได้ไปต่อ ต้องไม่เสมอกับตำแหน่งแรกที่ตกรอบ
  const undecided = groups.find((g) => {
    const lastIn = g.rows[take - 1];
    const firstOut = g.rows[take];
    return Boolean(lastIn && firstOut && sameStrength(lastIn, firstOut));
  });
  if (undecided) {
    return {
      error: `Group ${undecided.bracket} is tied on the cut line - record the tiebreak first`
    };
  }

  const teamIds: string[] = [];
  for (let position = 0; position < take; position += 1) {
    groups.forEach((group) => {
      const row = group.rows[position];
      if (row) teamIds.push(row.teamId);
    });
  }

  if (teamIds.length < 2) return { error: 'A playoff needs at least two teams' };
  return { teamIds };
}
