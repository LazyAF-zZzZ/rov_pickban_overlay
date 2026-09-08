// การจับคู่และสร้างตารางแข่ง
//
// ไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ล้วน ไม่แตะฐานข้อมูล ไม่สุ่มเอง
// ตัวสุ่มรับเข้ามาเป็นพารามิเตอร์ เทสต์จึงส่งตัวสุ่มแบบกำหนดผลได้เข้ามา
// แล้วตรวจผลลัพธ์ที่แน่นอนได้ ไม่ใช่ "รันหลายรอบแล้วหวังว่าจะไม่พัง"
//
// กฎที่ห้ามพังเด็ดขาด: ในหนึ่งรอบ ทีมเดียวห้ามลงแข่งเกินหนึ่งคู่
// แบบพบกันหมดใช้วิธี circle method ซึ่งกฎนี้เป็นจริงโดยโครงสร้าง
// ไม่ใช่ด้วยการสุ่มใหม่จนกว่าจะไม่ชน

import type { BestOf, TournamentFormat } from './tournament';

// ปลายทางของทีมหนึ่งทีมหลังจบคู่ ใช้ทั้งกับผู้ชนะและผู้แพ้
export interface Destination {
  bracket: string;
  round: number;
  slot: number;
  side: 0 | 1;
}

export interface PlannedMatch {
  // 'main'   = สายชนะ (หรือสายเดียวในแบบแพ้คัดออก)
  // 'losers' = สายแพ้ (เฉพาะแพ้สองครั้งคัดออก)
  // 'grand'  = รอบชิงระหว่างแชมป์สองสาย
  // หรือชื่อกลุ่ม ('A', 'B', ...) ตอนแบ่งสาย
  bracket: string;
  round: number;      // เริ่มที่ 1
  slot: number;       // ลำดับในรอบนั้น เริ่มที่ 0
  teamAId: string | null;
  teamBId: string | null;
  // ผู้ชนะไปไหนต่อ null = จบสาย
  winnerTo: Destination | null;
  // ผู้แพ้ไปไหนต่อ มีเฉพาะแพ้สองครั้งคัดออก
  // null = ตกรอบ (แพ้ครั้งที่สอง หรือกติกาแพ้ครั้งเดียวตกรอบ)
  loserTo: Destination | null;
  // คู่ที่มีทีมเดียว = บาย ผู้ชนะรู้ผลตั้งแต่ยังไม่แข่ง
  isBye: boolean;
  winnerId: string | null;
}

export type Rng = () => number;

// Fisher-Yates สลับที่ ตัวสุ่มรับเข้ามาเพื่อให้เทสต์กำหนดผลได้
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

// จำนวนเกมที่ต้องชนะถึงจะจบซีรีส์ Bo3 = 2, Bo5 = 3
export function winsNeeded(bestOf: BestOf): number {
  return Math.floor(bestOf / 2) + 1;
}

// ซีรีส์จบหรือยัง และใครชนะ
export function seriesWinner(
  bestOf: BestOf,
  scoreA: number,
  scoreB: number
): 'a' | 'b' | null {
  const need = winsNeeded(bestOf);
  if (scoreA >= need && scoreA > scoreB) return 'a';
  if (scoreB >= need && scoreB > scoreA) return 'b';
  return null;
}

// ---- ROUND ROBIN ----------------------------------------------------
//
// circle method: ตรึงทีมแรกไว้ แล้วหมุนที่เหลือทีละตำแหน่งในแต่ละรอบ
// ทีมจำนวนคี่เติมช่องว่างเข้าไปหนึ่งช่อง ใครจับคู่กับช่องว่างคือได้พักรอบนั้น
//
// ผลลัพธ์: n-1 รอบ (n คู่) ทุกคู่เจอกันครั้งเดียวพอดี
// และในแต่ละรอบทีมหนึ่งโผล่ได้ครั้งเดียว ซึ่งเป็นจริงจากตัวโครงสร้างเอง
export function roundRobinRounds(teamIds: readonly string[]): (readonly [string, string])[][] {
  const list: (string | null)[] = teamIds.slice();
  if (list.length % 2 === 1) list.push(null); // ช่องพัก

  const n = list.length;
  if (n < 2) return [];

  const rounds: (readonly [string, string])[][] = [];
  let arr = list.slice();

  for (let r = 0; r < n - 1; r += 1) {
    const pairs: (readonly [string, string])[] = [];
    for (let i = 0; i < n / 2; i += 1) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      // สลับฝั่งตามรอบ ทีมเดิมจะได้ไม่อยู่ฝั่งน้ำเงินทุกนัด
      if (a !== null && a !== undefined && b !== null && b !== undefined) {
        pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
      }
    }
    rounds.push(pairs);

    // หมุน: ตรึง arr[0] เอาตัวท้ายมาไว้ตำแหน่งที่ 1
    arr = [arr[0] as string | null, arr[n - 1] as string | null, ...arr.slice(1, n - 1)];
  }

  return rounds;
}

// ---- SINGLE ELIMINATION ---------------------------------------------

// ลำดับ seed มาตรฐานของสายขนาด size (ต้องเป็นกำลังของสอง)
// 8 ทีม -> [1,8,5,4,3,6,7,2] คือ 1 เจอ 8, 5 เจอ 4, ...
// ทำให้ทีมวางอันดับต้นๆ ไม่เจอกันเองจนกว่าจะรอบท้ายๆ
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2 + 1;
    const grown: number[] = [];
    order.forEach((seed) => {
      grown.push(seed, next - seed);
    });
    order = grown;
  }
  return order;
}

function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

// สร้างสายแพ้คัดออก teamIds เรียงตามลำดับวาง (คนแรก = seed 1)
// ทีมไม่ครบกำลังสอง ช่องที่เหลือเป็นบาย และบายตกกับทีมวางอันดับต้น
export function singleElimination(teamIds: readonly string[]): PlannedMatch[] {
  if (teamIds.length < 2) return [];

  const size = nextPowerOfTwo(teamIds.length);
  const order = seedOrder(size);
  // order เก็บเป็นเลข seed เริ่มที่ 1 แปลงเป็น index แล้วดึงทีม (เกินมา = บาย)
  const positioned = order.map((seed) => teamIds[seed - 1] ?? null);

  const matches: PlannedMatch[] = [];
  const totalRounds = Math.log2(size);

  // ค่า null ในสองบริบทนี้ไม่เหมือนกัน และเคยทำให้เกิดบั๊กมาแล้ว:
  //   รอบแรก null = ไม่มีทีมในช่องนั้นจริงๆ (ทีมไม่ครบกำลังสอง) -> เป็นบาย
  //   รอบหลัง null = ยังไม่รู้ว่าใครชนะมา                        -> ไม่ใช่บาย
  // ถ้าเหมารวมว่า null คือบายเหมือนกันหมด ทีมที่ได้บายรอบแรกจะถูกดันเข้ารอบ
  // ต่อไปเรื่อยๆ โดยไม่ต้องแข่งเลย เพราะคู่ต่อสู้ยัง null อยู่
  // สรุป: บายเกิดได้เฉพาะรอบแรกเท่านั้น
  let previousWinners: (string | null)[] = [];

  for (let round = 1; round <= totalRounds; round += 1) {
    const slots = size / 2 ** round;
    const winners: (string | null)[] = [];
    const isFirst = round === 1;
    const isFinal = round === totalRounds;

    for (let slot = 0; slot < slots; slot += 1) {
      const source = isFirst ? positioned : previousWinners;
      const teamAId = source[slot * 2] ?? null;
      const teamBId = source[slot * 2 + 1] ?? null;

      const isBye = isFirst && (teamAId === null) !== (teamBId === null);
      const winnerId = isBye ? (teamAId ?? teamBId) : null;

      matches.push({
        bracket: 'main',
        round,
        slot,
        teamAId,
        teamBId,
        winnerTo: isFinal ? null : {
          bracket: 'main',
          round: round + 1,
          slot: Math.floor(slot / 2),
          side: (slot % 2) as 0 | 1
        },
        // แพ้ครั้งเดียวตกรอบ ไม่ต้องส่งผู้แพ้ไปไหน
        loserTo: null,
        isBye,
        winnerId
      });

      // บายรู้ผู้ชนะทันที ส่งต่อให้รอบถัดไปได้เลย ไม่ต้องให้คนกดผ่าน
      // นัดจริงส่ง null ไป แปลว่า "รอผลอยู่"
      winners.push(winnerId);
    }

    previousWinners = winners;
  }

  // ช่องที่ว่างทั้งคู่ในรอบแรก (ไม่เกิดขึ้นเมื่อ size เป็นกำลังสองถัดไปของ n
  // เพราะจะมีทีมอย่างน้อยหนึ่งทีมต่อคู่เสมอ) กันไว้เผื่อ
  return matches.filter((m) => !(isFirstRoundEmpty(m)));
}

function isFirstRoundEmpty(m: PlannedMatch): boolean {
  return m.round === 1 && m.teamAId === null && m.teamBId === null;
}

// ---- DOUBLE ELIMINATION ---------------------------------------------
//
// สองสายเดินคู่กัน แพ้ในสายชนะแล้วตกลงไปสายแพ้ ไม่ใช่ตกรอบทันที
// แพ้ในสายแพ้อีกครั้งถึงจะตกรอบจริง
//
// โครงของสายแพ้ สำหรับสายขนาด S และสายชนะ W = log2(S) รอบ:
//   สายแพ้มี 2(W-1) รอบ สลับกันสองแบบ
//   รอบคี่  = จับผู้ชนะในสายแพ้มาเจอกันเอง (ลดจำนวนคนลงครึ่งหนึ่ง)
//   รอบคู่  = ผู้ชนะสายแพ้ เจอ ผู้แพ้ที่เพิ่งตกลงมาจากสายชนะ
// รอบที่ 1 พิเศษหน่อย เพราะจับผู้แพ้จากสายชนะรอบแรกมาเจอกันเองเลย
//
// รอบชิงใช้กติกา "ต้องชนะสองครั้ง": แชมป์สายชนะยังไม่เคยแพ้ใคร
// ถ้าแพ้ในรอบชิงนัดแรกก็เพิ่งแพ้ครั้งแรก จึงต้องเล่นนัดตัดสินอีกนัด
// นัดนั้นจะถูกใช้ก็ต่อเมื่อแชมป์สายแพ้ชนะนัดแรกเท่านั้น

const WINNERS = 'main';
const LOSERS = 'losers';
const GRAND = 'grand';

// จำนวนคู่ในสายแพ้รอบที่ r (นับจาก 1)
function losersRoundSize(size: number, round: number): number {
  const k = Math.ceil(round / 2);      // คู่รอบคี่กับรอบคู่ถัดไปมีขนาดเท่ากัน
  return size / 2 ** (k + 1);
}

export function doubleElimination(teamIds: readonly string[]): PlannedMatch[] {
  if (teamIds.length < 4) return [];

  const size = nextPowerOfTwo(teamIds.length);
  const wbRounds = Math.log2(size);
  const lbRounds = 2 * (wbRounds - 1);

  // สายชนะเหมือนแพ้คัดออกทุกอย่าง ต่างแค่ผู้แพ้มีที่ไป
  const matches: PlannedMatch[] = singleElimination(teamIds).map((m) => ({ ...m }));

  matches.forEach((m) => {
    if (m.isBye) return;             // บายไม่มีผู้แพ้ให้ส่งไปไหน

    if (m.round === 1) {
      // ผู้แพ้รอบแรกจับคู่กันเองในสายแพ้รอบ 1
      m.loserTo = { bracket: LOSERS, round: 1, slot: Math.floor(m.slot / 2), side: (m.slot % 2) as 0 | 1 };
      return;
    }

    // ผู้แพ้จากสายชนะรอบ r (r >= 2) ตกลงไปสายแพ้รอบคู่ที่ 2(r-1)
    const lbRound = 2 * (m.round - 1);
    const count = losersRoundSize(size, lbRound);
    // สลับลำดับในรอบเว้นรอบ เพื่อไม่ให้เจอคนที่เพิ่งเขี่ยตัวเองตกซ้ำทันที
    const flip = (m.round % 2) === 0;
    const slot = flip ? count - 1 - m.slot : m.slot;
    m.loserTo = { bracket: LOSERS, round: lbRound, slot, side: 1 };
  });

  // สายแพ้
  for (let round = 1; round <= lbRounds; round += 1) {
    const count = losersRoundSize(size, round);
    const isLast = round === lbRounds;
    const isMinor = round === 1 || round % 2 === 1;   // จับกันเองในสายแพ้

    for (let slot = 0; slot < count; slot += 1) {
      matches.push({
        bracket: LOSERS,
        round,
        slot,
        teamAId: null,
        teamBId: null,
        winnerTo: isLast
          ? { bracket: GRAND, round: 1, slot: 0, side: 1 }
          : isMinor
            // รอบคี่ -> รอบคู่ถัดไป ขนาดเท่ากัน ไปช่องเดิม ฝั่งซ้าย
            ? { bracket: LOSERS, round: round + 1, slot, side: 0 }
            // รอบคู่ -> รอบคี่ถัดไป ยุบลงครึ่งหนึ่ง
            : { bracket: LOSERS, round: round + 1, slot: Math.floor(slot / 2), side: (slot % 2) as 0 | 1 },
        // แพ้ในสายแพ้ = แพ้ครั้งที่สอง ตกรอบ
        loserTo: null,
        isBye: false,
        winnerId: null
      });
    }
  }

  // แชมป์สายชนะเข้ารอบชิงโดยตรง
  const wbFinal = matches.find((m) => m.bracket === WINNERS && m.round === wbRounds);
  if (wbFinal) wbFinal.winnerTo = { bracket: GRAND, round: 1, slot: 0, side: 0 };

  // รอบชิง นัดแรก
  matches.push({
    bracket: GRAND,
    round: 1,
    slot: 0,
    teamAId: null,   // แชมป์สายชนะ
    teamBId: null,   // แชมป์สายแพ้
    // ทั้งผู้ชนะและผู้แพ้ไปนัดตัดสิน ตัวที่ตัดสินว่าจะได้เล่นจริงไหมคือ store
    // ถ้าแชมป์สายชนะชนะนัดแรก ก็จบ นัดตัดสินไม่ถูกใช้
    winnerTo: { bracket: GRAND, round: 2, slot: 0, side: 0 },
    loserTo: { bracket: GRAND, round: 2, slot: 0, side: 1 },
    isBye: false,
    winnerId: null
  });

  // นัดตัดสิน เล่นเฉพาะตอนแชมป์สายแพ้ชนะนัดแรก
  matches.push({
    bracket: GRAND,
    round: 2,
    slot: 0,
    teamAId: null,
    teamBId: null,
    winnerTo: null,
    loserTo: null,
    isBye: false,
    winnerId: null
  });

  return collapseStarvedLosers(matches);
}

// คู่ในสายแพ้ที่ไม่มีใครป้อน เกิดจากบายในสายชนะรอบแรก
//
// ทีมไม่ครบกำลังสอง คู่รอบแรกของสายชนะบางคู่จึงเป็นบาย ซึ่งไม่มีผู้แพ้ให้ส่งลงสายแพ้
// ช่องที่รอผู้แพ้จากคู่พวกนั้นว่างตลอดกาล คู่นั้นไม่มีวันแข่ง แล้วทั้งสายแพ้กับรอบชิง
// ก็ค้างตามกันหมด (5 ทีม เคยค้าง 8 คู่จาก 15 = จบทัวร์นาเมนต์ไม่ได้เลย)
//
// จึงยุบทิ้ง ไม่ใช่ปล่อยว่างไว้:
//   ไม่มีใครป้อนเลย   -> ลบคู่นั้นทิ้ง
//   มีคนป้อนคนเดียว   -> คนนั้นผ่านเข้ารอบถัดไปเลย ต่อท่อตรงไปยังปลายทางของคู่ที่ลบ
//
// ต้องวนจนกว่าจะไม่มีอะไรเปลี่ยน เพราะการลบคู่หนึ่งทำให้คู่ที่มันเคยป้อนเหลือคนป้อนน้อยลงตามกัน
// ต่อท่อก่อนแล้วค่อยลบเสมอ ปลายทางจึงไม่มีทางชี้ไปยังคู่ที่ไม่มีอยู่แล้ว
//
// แตะเฉพาะสายแพ้ สายชนะไม่มีปัญหานี้ (รอบแรกมีทีมอยู่แล้ว รอบหลังมีผู้ชนะป้อนครบสองทางเสมอ)
// และรอบชิงนัดตัดสินตั้งใจให้มีคนป้อนสองทางจากคู่เดียวกัน จะยุบไม่ได้
function collapseStarvedLosers(matches: PlannedMatch[]): PlannedMatch[] {
  const key = (bracket: string, round: number, slot: number) => `${bracket}#${round}#${slot}`;
  const DEST_FIELDS = ['winnerTo', 'loserTo'] as const;
  type DestField = typeof DEST_FIELDS[number];

  let list = matches;

  // ลบได้อย่างมากเท่าจำนวนคู่ที่มี วนเกินกว่านั้นแปลว่าตรรกะข้างในผิด
  for (let guard = 0; guard <= matches.length; guard += 1) {
    // ใครป้อนช่องไหนบ้าง สร้างใหม่ทุกรอบ เพราะรอบก่อนเพิ่งย้ายปลายทางไป
    const feeders = new Map<string, { match: PlannedMatch; field: DestField }[]>();
    list.forEach((match) => {
      DEST_FIELDS.forEach((field) => {
        const dest = match[field];
        if (!dest) return;
        const at = key(dest.bracket, dest.round, dest.slot);
        const found = feeders.get(at);
        if (found) found.push({ match, field });
        else feeders.set(at, [{ match, field }]);
      });
    });

    const starved = list.find((match) => (
      match.bracket === LOSERS
      && (feeders.get(key(match.bracket, match.round, match.slot))?.length ?? 0) < 2
    ));
    if (!starved) return list;

    const incoming = feeders.get(key(starved.bracket, starved.round, starved.slot)) ?? [];
    const only = incoming[0];
    // เหลือคนเดียว ไม่มีใครให้แข่งด้วย ส่งข้ามไปที่ที่ผู้ชนะของคู่นี้ควรไปเลย
    if (incoming.length === 1 && only) only.match[only.field] = starved.winnerTo;

    list = list.filter((match) => match !== starved);
  }

  return list;
}

// ---- GROUP STAGE ----------------------------------------------------

const GROUP_NAMES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// แบ่งทีมลงกลุ่มแบบงูสวัด (1,2,3,4 / 4,3,2,1) เพื่อให้แต่ละกลุ่มแข็งใกล้กัน
// แล้วแต่ละกลุ่มแข่งพบกันหมดภายในกลุ่ม
export function groupStage(teamIds: readonly string[], groupCount: number): PlannedMatch[] {
  const groups: string[][] = Array.from({ length: groupCount }, () => []);

  teamIds.forEach((id, index) => {
    const row = Math.floor(index / groupCount);
    const position = index % groupCount;
    const target = row % 2 === 0 ? position : groupCount - 1 - position;
    (groups[target] as string[]).push(id);
  });

  const matches: PlannedMatch[] = [];
  groups.forEach((members, groupIndex) => {
    const name = GROUP_NAMES[groupIndex] ?? `G${groupIndex + 1}`;
    roundRobinRounds(members).forEach((pairs, roundIndex) => {
      pairs.forEach(([a, b], slot) => {
        matches.push({
          bracket: name,
          round: roundIndex + 1,
          slot,
          teamAId: a,
          teamBId: b,
          winnerTo: null,
          loserTo: null,
          isBye: false,
          winnerId: null
        });
      });
    });
  });

  return matches;
}

// ---- ENTRY POINT ----------------------------------------------------

export interface GeneratePlan {
  format: TournamentFormat;
  teamIds: readonly string[];
  groupCount?: number;
}

export type GenerateResult =
  | { matches: PlannedMatch[]; error?: undefined }
  | { error: string; matches?: undefined };

export function generateMatches(plan: GeneratePlan): GenerateResult {
  const { format, teamIds } = plan;

  if (format === 'round_robin') {
    const matches: PlannedMatch[] = [];
    roundRobinRounds(teamIds).forEach((pairs, roundIndex) => {
      pairs.forEach(([a, b], slot) => {
        matches.push({
          bracket: 'main',
          round: roundIndex + 1,
          slot,
          teamAId: a,
          teamBId: b,
          winnerTo: null,
          loserTo: null,
          isBye: false,
          winnerId: null
        });
      });
    });
    return { matches };
  }

  if (format === 'single_elim') {
    return { matches: singleElimination(teamIds) };
  }

  if (format === 'double_elim') {
    return { matches: doubleElimination(teamIds) };
  }

  if (format === 'group_stage') {
    const count = Math.max(2, Math.min(plan.groupCount ?? 4, Math.floor(teamIds.length / 2)));
    return { matches: groupStage(teamIds, count) };
  }

  return { error: `Unknown format: ${String(format)}` };
}

// ชื่อสายที่เป็นรอบน็อกเอาต์ ไม่ใช่รอบที่แข่งพบกันหมด
//
// อยู่ใน domain เพราะการตั้งชื่อสายเป็นเรื่องของกติกา ไม่ใช่ของฐานข้อมูล
// และมีสองที่ที่ต้องใช้ชุดเดียวกัน: ตัววางสายน็อกเอาต์ กับตารางคะแนน
//
// ตารางคะแนนสร้างกลุ่มจาก "ชื่อสายที่พบในตารางแข่ง" ถ้าไม่กันชื่อพวกนี้ออก
// สายน็อกเอาต์ที่เพิ่งวางจะโผล่เป็นกลุ่มอีกกลุ่มหนึ่งบนกระดานคะแนน
// (เห็นมาแล้ว: กระดานขึ้นเป็นห้ากลุ่ม ทั้งที่รายการมีสี่กลุ่ม)
// และการเลื่อนชั้นรอบถัดไปก็จะพยายามเลื่อนทีมออกจากสายน็อกเอาต์ด้วย
export const PLAYOFF_BRACKET = 'playoff';
export const KNOCKOUT_BRACKETS: readonly string[] = [PLAYOFF_BRACKET, 'losers', 'grand'];

export function isKnockoutBracket(bracket: string): boolean {
  return KNOCKOUT_BRACKETS.includes(bracket);
}
