// ทีมในทะเบียนกลาง ใช้ซ้ำได้ทุกทัวร์นาเมนต์
//
// ทะเบียนนี้คือ "ทีมตอนนี้" แก้ได้ตลอด เปลี่ยนชื่อ เปลี่ยนโลโก้ เปลี่ยนตัวผู้เล่น
//
// สำคัญ: ตอนบันทึกผลเกม ห้ามเก็บแค่ team_id
// ต้องก็อปชื่อ/โลโก้/รายชื่อผู้เล่น ณ ตอนนั้นแนบไปกับเกมด้วย
// ไม่งั้นพอทีมเปลี่ยนตัวผู้เล่นปีหน้า ประวัติแมตช์เก่าจะเปลี่ยนตาม
// กลายเป็นว่าคนที่ไม่ได้ลงแข่งโผล่ไปอยู่ในผลเมื่อปีที่แล้ว
// และสถิติ pick/ban ที่อ้างอิงผลพวกนั้นก็เพี้ยนตามไปด้วย

import { sanitizeText, clampNumber } from '../lib/sanitize';
import type { Logo } from './media';
import { sanitizeLogo } from './media';
import { PICK_COUNT } from './draft';
import type { PositionValue } from './position';
import { sanitizePosition } from './position';

// ชื่อทีมยาวเท่ากับที่ overlay รองรับ (sanitizeTeam ใน match.ts ใช้ 24 เท่ากัน)
// ถ้าให้ยาวกว่านั้น พอโหลดขึ้น overlay จะถูกตัดอยู่ดี แต่ผู้ใช้ไม่รู้ตัว
export const NAME_MAX = 24;
export const TAG_MAX = 6;
const PLAYER_NAME_MAX = 24;

export const ROSTER_SIZE = PICK_COUNT;

export interface TeamPlayer {
  slot: number;
  name: string;
  // ตำแหน่งในทีม เป็นชุดปิดห้าค่า ไม่ใช่ข้อความอิสระ (ดู domain/position.ts)
  // กราฟิกออกอากาศเอาค่านี้ไปเลือกไอคอนพื้นหลังของช่องพิค
  position: PositionValue;
  isCaptain: boolean;
}

// ทีมที่ผู้ใช้กรอกเข้ามา ยังไม่มี id เพราะ id ออกให้ตอนบันทึก
export interface TeamInput {
  name: string;
  tag: string;
  logo: Logo;
  players: TeamPlayer[];
}

// ทีมที่อยู่ในทะเบียนแล้ว
export interface Team extends TeamInput {
  id: string;
  createdAt: number;
  updatedAt: number;
}

export type TeamInputResult = { team: TeamInput; error?: undefined } | { error: string; team?: undefined };

export function sanitizePlayer(player: unknown, index: number): TeamPlayer {
  const source = (player && typeof player === 'object' ? player : {}) as Record<string, unknown>;
  return {
    slot: index,
    name: sanitizeText(source.name, PLAYER_NAME_MAX),
    position: sanitizePosition(source.position),
    isCaptain: source.isCaptain === true
  };
}

// รายชื่อผู้เล่นมี 5 ช่องเสมอ ปล่อยว่างได้
// ต่างจาก match.ts ที่เติม 'Player 1' ให้ เพราะตรงนั้นต้องมีอะไรขึ้นจอ
// ส่วนทะเบียนทีมปล่อยว่างไว้ได้ ยังไม่รู้ตัวจริงก็กรอกทีหลัง
export function sanitizeRoster(players: unknown): TeamPlayer[] {
  const input = Array.isArray(players) ? (players as unknown[]) : [];
  const roster = Array.from({ length: ROSTER_SIZE }, (_, i) => sanitizePlayer(input[i], i));

  // กัปตันมีได้คนเดียว เอาคนแรกที่ติ๊กมา
  let captainSeen = false;
  roster.forEach((player) => {
    if (player.isCaptain && !captainSeen) {
      captainSeen = true;
    } else {
      player.isCaptain = false;
    }
  });

  return roster;
}

// คืน { team } เมื่อผ่าน หรือ { error } เมื่อไม่ผ่าน
// ชื่อทีมว่างไม่ได้ อย่างอื่นปล่อยว่างได้หมด
export function sanitizeTeamInput(input: unknown): TeamInputResult {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const name = sanitizeText(source.name, NAME_MAX);
  if (!name) return { error: 'Team name is required' };

  return {
    team: {
      name,
      tag: sanitizeText(source.tag, TAG_MAX),
      logo: sanitizeLogo(source.logo),
      players: sanitizeRoster(source.players)
    }
  };
}

export function sanitizeSeed(value: unknown): number {
  return clampNumber(value, 0, 9999);
}
