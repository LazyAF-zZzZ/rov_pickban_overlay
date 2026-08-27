// สถิติ pick/ban แปลงจำนวนดิบเป็นอัตราส่วน
//
// แยกจาก store/analytics.ts ตั้งใจ: ที่นี่ไม่รู้จักฐานข้อมูลเลย
// รับตัวเลขนับมาแล้วคำนวณอย่างเดียว จึงเขียนเทสต์ได้โดยไม่ต้องมีเกมจริง
//
// กติกาที่สำคัญที่สุด: ตัวหารคือ "จำนวนเกม" ไม่ใช่ "จำนวนช่องในดราฟต์"
// ถ้าหารด้วยช่อง ผลรวมของทุกฮีโร่จะได้ 100% พอดี ซึ่งไม่ได้ตอบคำถามอะไรเลย
// หารด้วยจำนวนเกมแล้วตัวเลขจะอ่านได้ว่า "ฮีโร่ตัวนี้โผล่กี่เปอร์เซ็นต์ของเกมทั้งหมด"
//
// สเกลที่ควรได้: ฮีโร่ 129 ตัว ใช้จริงเกมละ 18 ช่อง (เลือก 5 แบน 4 สองฝั่ง)
// ฮีโร่ธรรมดาจึงอยู่แถวๆ 7.8% pick / 6.2% ban / 14% presence
// ของที่น่าสนใจอยู่ราวๆ 30 อันดับแรก ที่เหลือคือเสียงรบกวน

export interface HeroCounts {
  hero: string;
  // นับเป็น "จำนวนเกม" ไม่ใช่จำนวนครั้ง ฮีโร่ตัวเดียวถูกเลือกได้ครั้งเดียวต่อเกมอยู่แล้ว
  picked: number;
  banned: number;
  present: number;
  // แบนในเฟสแรกเท่านั้น (ช่อง 0-1) ใช้วัดว่าใครคือตัวที่ต้องเอาออกก่อนใคร
  earlyBans: number;
  wins: number;
  // เกมที่ฮีโร่นี้ถูกเลือก และมีการบันทึกผู้ชนะไว้แล้ว
  // เป็นตัวหารของอัตราชนะ ไม่ใช่ picked เพราะเกมที่ยังไม่รู้ผลไม่ควรนับเป็นแพ้
  decided: number;
}

export interface HeroStat extends HeroCounts {
  pickRate: number;
  banRate: number;
  presence: number;
  earlyBanRate: number;
  // null = ยังไม่มีเกมที่รู้ผลแพ้ชนะ ต่างจาก 0 ซึ่งแปลว่าลงแล้วแพ้ล้วน
  winRate: number | null;
  // อันดับความสำคัญของการแบน นับเฉพาะฮีโร่ที่เคยโดนแบนเฟสแรก
  banPriority: number | null;
}

export interface AnalyticsSummary {
  games: number;
  decidedGames: number;
  heroesSeen: number;
  slotsPerGame: number;
}

// ช่องที่ถูกใช้จริงต่อหนึ่งเกม เอาไว้อธิบายสเกลบนหน้าเว็บ
export const SLOTS_PER_GAME = 18;

// เฟสแบนแรกเขียนลงช่อง 0 กับ 1 ของทั้งสองฝั่ง (ดู DRAFT_SEQUENCE)
// เฟสแบนที่สองเขียนช่อง 2 กับ 3 การแยกจึงเป็นเรื่องของ index ล้วนๆ
export const FIRST_BAN_PHASE_MAX_INDEX = 1;

export function rate(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

// เรียงตาม presence เป็นหลัก ตามที่แผนบอกให้นำด้วยตัวเลขนี้
// ตัวตัดสินรองไล่ลงไปเรื่อยๆ เพื่อให้ลำดับคงที่ ไม่สลับไปมาระหว่างการโหลด
function byPresence(a: HeroStat, b: HeroStat): number {
  return (
    b.present - a.present ||
    b.picked - a.picked ||
    b.banned - a.banned ||
    a.hero.localeCompare(b.hero)
  );
}

export function toHeroStats(counts: readonly HeroCounts[], games: number): HeroStat[] {
  const stats = counts.map((c): HeroStat => ({
    ...c,
    pickRate: rate(c.picked, games),
    banRate: rate(c.banned, games),
    presence: rate(c.present, games),
    earlyBanRate: rate(c.earlyBans, games),
    winRate: c.decided > 0 ? c.wins / c.decided : null,
    banPriority: null
  }));

  // อันดับการแบน ให้เฉพาะตัวที่เคยโดนแบนเฟสแรกจริงๆ
  // ตัวที่ไม่เคยโดนไม่ควรได้อันดับ 87 ราวกับว่ามีความสำคัญน้อยแต่ยังวัดได้
  stats
    .filter((s) => s.earlyBans > 0)
    .sort((a, b) => b.earlyBans - a.earlyBans || a.hero.localeCompare(b.hero))
    .forEach((s, index) => { s.banPriority = index + 1; });

  return stats.sort(byPresence);
}

export function summarise(
  stats: readonly HeroStat[],
  games: number,
  decidedGames: number
): AnalyticsSummary {
  return {
    games,
    decidedGames,
    heroesSeen: stats.filter((s) => s.present > 0).length,
    slotsPerGame: SLOTS_PER_GAME
  };
}
