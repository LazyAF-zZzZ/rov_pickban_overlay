// รอบ (เกมที่เท่าไหร่ในซีรีส์) และดราฟต์ของรอบที่เล่นจบไปแล้ว
//
// ทำไมเก็บไว้ใน state ไม่ใช่ในฐานข้อมูล
//
// ฐานข้อมูลเก็บดราฟต์รายเกมอยู่แล้ว (ตาราง games + game_slots) แต่มันมีเฉพาะ
// แมตช์ที่อยู่ในทัวร์นาเมนต์ ส่วนแมตช์เดี่ยวที่คุมจากหน้า Control ล้วนๆ ไม่มีแถวไหนเลย
// และกราฟิกออกอากาศก็อ่านฐานไม่ได้อยู่ดี มันไม่ถือโทเคน
//
// สิ่งที่ผู้ใช้ขอคือ "เก็บเฉพาะแมตช์ที่กำลังออกอากาศ หรือที่กำลังคุมอยู่บนหน้า Control"
// ซึ่งตรงกับอายุของ state พอดี: เปลี่ยนแมตช์หรือกด RESET MATCH แล้วเริ่มนับใหม่
// เก็บที่นี่จึงได้ทั้งสองแบบด้วยทางเดียว และกราฟิกได้ข้อมูลมากับ stateUpdate
// เหมือนทุกอย่างที่มันต้องวาด ไม่ต้องมี endpoint ใหม่และไม่ต้องมีสองเส้นทาง
//
// ของในฐานยังอยู่เหมือนเดิมและยังเป็นแหล่งของสถิติ สองอย่างนี้ตอบคนละคำถาม:
// ฐาน = ประวัติถาวรของทัวร์นาเมนต์, ตรงนี้ = กระดานย้อนหลังของรายการที่กำลังออกอากาศ

import { sanitizeHero } from './heroes';
import { clampNumber, sanitizeText, normalizeArray } from '../lib/sanitize';
import { PICK_COUNT, BAN_COUNT } from './draft';

// ดราฟต์ของทีมหนึ่งในรอบหนึ่ง
export interface RoundSide {
  name: string;
  picks: (string | null)[];
  bans: (string | null)[];
}

export interface RoundRecord {
  round: number;
  blue: RoundSide;
  red: RoundSide;
}

export const FIRST_ROUND = 1;

// Bo7 ใช้เจ็ดรอบ เผื่อไว้ถึงสิบห้าก็เกินพอสำหรับทุกกติกาที่มีจริง
//
// ต้องมีเพดาน เพราะทั้งก้อนนี้ถูกเขียนลง state.json ทุกครั้งที่ดราฟต์เปลี่ยน
// และเดินทางไปกับ stateUpdate ทุกวินาทีตอนจับเวลา กดปุ่มรอบถัดไปรัวๆ
// ไม่ควรทำให้ไฟล์กับข้อความที่ส่งโตขึ้นเรื่อยๆ โดยไม่มีที่สิ้นสุด
export const MAX_ROUNDS = 15;
export const MAX_ROUND_NUMBER = 99;

export function sanitizeRoundNumber(value: unknown): number {
  return clampNumber(value, FIRST_ROUND, MAX_ROUND_NUMBER);
}

// ชื่อฮีโร่ในรอบที่เก็บไว้ ผ่าน sanitizeHero ได้ เพราะนี่คือกระดานของรายการที่กำลัง
// ออกอากาศอยู่ตอนนี้ ไม่ใช่ประวัติย้อนหลังข้ามปีแบบในฐานข้อมูล
// (กฎ "ห้ามกรองประวัติเก่าซ้ำ" ใน CLAUDE.md พูดถึงของในฐาน ไม่ใช่ของชุดนี้)
function sanitizeSide(value: unknown, fallbackName: string): RoundSide {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    name: sanitizeText(source.name, 24) || fallbackName,
    picks: normalizeArray(source.picks, PICK_COUNT, sanitizeHero),
    bans: normalizeArray(source.bans, BAN_COUNT, sanitizeHero)
  };
}

export function sanitizeRound(value: unknown, index: number): RoundRecord {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    round: sanitizeRoundNumber(source.round ?? index + 1),
    blue: sanitizeSide(source.blue, 'BLUE'),
    red: sanitizeSide(source.red, 'RED')
  };
}

// เกินเพดานให้ทิ้งรอบเก่าที่สุด ไม่ใช่รอบใหม่ที่สุด
//
// slice(0, MAX) ตัดปลายท้ายทิ้ง ซึ่งกลับด้านกับที่ fileRound ทำ (มันเก็บท้ายสุด)
// ผลคือกองที่ล้นจะค่อยๆ หยุดรับรอบใหม่ แล้วกราฟิกก็แช่อยู่กับรอบเก่าตลอดไป
export function sanitizeRounds(value: unknown): RoundRecord[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_ROUNDS).map(sanitizeRound);
}

// รอบนี้มีอะไรให้เก็บไหม
//
// กดปุ่มรอบถัดไปตอนกระดานยังว่าง ไม่ควรได้แถวเปล่าไปกองอยู่ในกราฟิก
// ว่างทั้งพิคและแบนทั้งสองฝั่ง = ยังไม่ได้เล่นรอบนี้
export function hasAnything(record: RoundRecord): boolean {
  return [record.blue, record.red].some((side) => (
    side.picks.some(Boolean) || side.bans.some(Boolean)
  ));
}
