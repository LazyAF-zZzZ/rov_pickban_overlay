// ตำแหน่งของผู้เล่นในทีม (เลน) — คำศัพท์ชุดเดียวที่ทั้งแอปใช้ร่วมกัน
//
// ROV มีห้าตำแหน่ง และมันคือ "ชุดปิด" ไม่ใช่ข้อความอิสระ
// เดิมทะเบียนทีมเก็บเป็นช่องพิมพ์อิสระชื่อ role ซึ่งพิมพ์อะไรลงไปก็ได้
// พอจะเอาไปเลือกไอคอนบนกราฟิกออกอากาศ ข้อความอิสระใช้ไม่ได้ทันที:
// "jungle" กับ "Jungle" กับ "จังเกิ้ล" ต้องได้ไอคอนเดียวกัน และคำที่ไม่รู้จัก
// ต้องไม่กลายเป็นชื่อไฟล์ที่ไปเปิดอะไรก็ไม่รู้
//
// slug เป็นตัวพิมพ์เล็กล้วนและถูกเอาไปต่อเป็นชื่อไฟล์ไอคอนโดยตรง
// (public/images/positions/<slug>.png) จึงต้องมาจากตารางนี้เท่านั้น
// กฎเดียวกับชื่อฮีโร่และ domain/media.ts: ชื่อไฟล์ไม่เคยมาจากข้อความที่ผู้ใช้พิมพ์

export const POSITIONS = ['jungle', 'carry', 'midlane', 'offlane', 'support'] as const;

export type Position = typeof POSITIONS[number];

// '' = ยังไม่ได้ระบุตำแหน่ง ต่างจากตำแหน่งที่ผิด ซึ่งก็ถูกปัดมาเป็น '' เหมือนกัน
// กราฟิกจะไม่วาดไอคอนให้ช่องที่เป็น '' แทนที่จะวาดไอคอนมั่วๆ
export type PositionValue = Position | '';

// ป้ายที่คนอ่าน ใช้ในหน้าทะเบียนทีม
// ฝั่งหน้าเว็บมีสำเนาของตารางนี้ใน public/js/lib/team-ui.js เพราะเป็นสคริปต์
// แบบคลาสสิก import จาก server/ ไม่ได้ มีเทสต์กันไว้ว่าสองที่ต้องตรงกัน
export const POSITION_LABELS: Record<Position, string> = {
  jungle: 'Jungle',
  carry: 'Carry',
  midlane: 'Mid lane',
  offlane: 'Off lane',
  support: 'Support'
};

export function isPosition(value: unknown): value is Position {
  return typeof value === 'string' && (POSITIONS as readonly string[]).includes(value);
}

// รับได้ทั้ง slug ตรงๆ และป้ายที่คนอ่าน เผื่อค่าที่เคยพิมพ์มือไว้ในช่อง role เดิม
// ไม่รู้จักก็คืน '' ไม่เดา
export function sanitizePosition(value: unknown): PositionValue {
  if (typeof value !== 'string') return '';
  const text = value.trim().toLowerCase();
  if (!text) return '';
  if (isPosition(text)) return text;

  // 'Mid lane' -> 'midlane', 'Off Lane' -> 'offlane'
  const squashed = text.replace(/[\s_-]+/g, '');
  return isPosition(squashed) ? squashed : '';
}
