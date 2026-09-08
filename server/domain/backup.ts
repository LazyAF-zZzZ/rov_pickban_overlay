// รูปแบบไฟล์สำรองข้อมูล และตัวกรองของที่อ่านเข้ามา
//
// ไฟล์สำรองเป็น "ข้อมูลจากคนอื่น" เสมอ ไม่ใช่ของเรา
//
// นี่คือความต่างที่สำคัญที่สุดของโมดูลนี้กับโมดูลอื่นในโฟลเดอร์นี้ ไฟล์ที่ผู้ใช้
// กดนำเข้าอาจมาจากใครก็ได้ (ส่งต่อกันในดิสคอร์ด แนบมากับอีเมล) คนส่งจึงคุม
// ทุกไบต์ในนั้นได้ และสิ่งที่เขาอยากได้มีสองอย่าง: เขียนไฟล์ลงเครื่อง กับ
// รันสคริปต์ในต้นทางเดียวกับหน้าคุมงาน (ซึ่งถือโทเคนควบคุม overlay ที่ออกอากาศอยู่)
//
// กฎที่ทั้งไฟล์นี้ยึด: ไฟล์บอกได้แค่ "เนื้อหา" ไม่มีสิทธิ์บอก "ชื่อไฟล์" หรือ "ที่อยู่"
// ชื่อไฟล์ทั้งหมดประกอบขึ้นจาก id ที่ผ่าน isSafeMediaId แล้วเท่านั้น
// และรูปทุกใบต้องมีไบต์ต้นไฟล์ตรงกับชนิดที่มันอ้าง (SKIN_MAGIC)
//
// ตัวกรองในไฟล์นี้ "สร้างของใหม่จากคีย์ที่รู้จัก" ไม่ใช่ผสมของเก่ากับของใหม่
// หลักเดียวกับ sanitizeState คีย์แปลกปลอมอย่าง __proto__ จึงตกไปเองโดยไม่ต้องดักเป็นพิเศษ

import { clampNumber, sanitizeText } from '../lib/sanitize';
import type { ImageExt } from './media';
import {
  SKIN_MAGIC, SKIN_TYPES, isSafeMediaId, isTeamLogoId, isSkinSlot, LOGO_MAX_BYTES
} from './media';
import { MAX_TEAMS } from './tournament';

export const BACKUP_FORMAT = 'rov-overlay-export';

// ขึ้นเลขนี้เมื่อรูปร่างของไฟล์เปลี่ยนจนของเก่าอ่านด้วยกฎใหม่ไม่ได้
// ไม่ใช่ทุกครั้งที่เพิ่มฟิลด์ การเพิ่มฟิลด์ที่ไม่บังคับยังอ่านย้อนหลังได้
export const BACKUP_VERSION = 1;

export type BackupKind = 'full';

// เพดานทั้งหมดของไฟล์นำเข้า
//
// ปฏิเสธ ไม่ใช่ตัดให้สั้นลง ไฟล์ที่ใหญ่เกินคือไฟล์ที่ผิดปกติ การตัดครึ่งแล้ว
// นำเข้าต่อคือการเก็บข้อมูลที่ไม่ตรงกับต้นฉบับโดยที่ไม่มีใครรู้
//
// ตัวที่สำคัญที่สุดคือ MAX_FILE_BYTES: ทั้งไฟล์ถูกอ่านเข้าหน่วยความจำแล้ว
// JSON.parse ทีเดียว ซึ่งบล็อก event loop ทั้งเส้น เซิร์ฟเวอร์ตัวนี้เสิร์ฟ overlay
// ที่ออกอากาศอยู่ด้วย การค้างไปสามวินาทีจึงเห็นบนอากาศ
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_TEAMS_IN_FILE = 2000;
export const MAX_TOURNAMENTS_IN_FILE = 500;
export const MAX_MATCHES_IN_FILE = 20000;
export const MAX_GAMES_IN_FILE = 40000;
export const MAX_SLOTS_PER_GAME = 18;

export interface BackupImage {
  ext: ImageExt;
  bytes: string;      // base64
}

export interface BackupPlayer {
  slot: number;
  name: string;
  position: string;
  isCaptain: boolean;
}

export interface BackupTeam {
  id: string;
  name: string;
  tag: string;
  logoV: number;
  logoExt: string;
  createdAt: number;
  updatedAt: number;
  players: BackupPlayer[];
}

export interface BackupTournament {
  id: string;
  name: string;
  status: string;
  format: string;
  bestOf: number;
  note: string;
  createdAt: number;
  updatedAt: number;
  teams: { teamId: string; seed: number; addedAt: number }[];
}

export interface BackupMatch {
  id: string;
  tournamentId: string;
  bracket: string;
  round: number;
  slot: number;
  teamAId: string | null;
  teamBId: string | null;
  bestOf: number;
  status: string;
  scoreA: number;
  scoreB: number;
  winnerId: string | null;
  isBye: boolean;
  nextRound: number | null;
  nextSlot: number | null;
  nextSide: number | null;
  nextBracket: string | null;
  loserRound: number | null;
  loserSlot: number | null;
  loserSide: number | null;
  loserBracket: string | null;
  createdAt: number;
}

export interface BackupGame {
  id: string;
  matchId: string;
  gameNo: number;
  blueTeamId: string | null;
  redTeamId: string | null;
  blueName: string;
  redName: string;
  draftLocked: boolean;
  winner: string | null;
  startedAt: number;
  updatedAt: number;
  slots: { side: string; kind: string; idx: number; hero: string }[];
}

export interface BackupData {
  teams: BackupTeam[];
  tournaments: BackupTournament[];
  matches: BackupMatch[];
  games: BackupGame[];
  logos: Record<string, BackupImage>;
  skins: Record<string, BackupImage>;
  state: unknown;
}

export interface BackupFile {
  format: string;
  version: number;
  kind: BackupKind;
  app: string;
  exportedAt: string;
  data: BackupData;
}

export type ReadResult =
  | { file: BackupFile; error?: undefined }
  | { error: string; file?: undefined };

function asArray(value: unknown, cap: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, cap) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value && typeof value === 'object' && !Array.isArray(value))
    ? value as Record<string, unknown>
    : {};
}

function asId(value: unknown): string | null {
  return isSafeMediaId(value) ? value : null;
}

// เวลาเป็นตัวเลข ค่าที่อ่านไม่ออกให้เป็น "ตอนนี้" ไม่ใช่ 0
// ปีค.ศ. 1970 บนหน้าประวัติดูเหมือนของเสีย มากกว่าดูเหมือนข้อมูลที่ไม่รู้เวลา
function asTime(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : Date.now();
}

function asNullableInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// รูปหนึ่งใบ: นามสกุลต้องเป็นชนิดที่รองรับ และไบต์ต้นไฟล์ต้องตรงกับชนิดนั้นจริง
//
// นามสกุลเชื่อไม่ได้ ไฟล์ HTML ที่ตั้งชื่อว่า .png แล้วถูกเสิร์ฟจากต้นทางเดียวกับ
// หน้าคุมงาน คือทางที่สคริปต์ของคนอื่นจะได้อ่านโทเคนควบคุมไปทั้งดุ้น
// ไบต์ต้นไฟล์คือสิ่งเดียวที่ตัดสิน (กฎเดียวกับตอนอัปโหลดผ่านหน้าเว็บ)
//
// ไม่รับ svg โดยตั้งใจ มันเป็นเอกสารที่ฝังสคริปต์ได้ SKIN_TYPES ไม่มีมันอยู่แล้ว
export function readImage(value: unknown): BackupImage | null {
  const source = asRecord(value);
  const ext = Object.values(SKIN_TYPES).includes(source.ext as ImageExt)
    ? source.ext as ImageExt
    : null;
  if (!ext) return null;
  if (typeof source.bytes !== 'string' || source.bytes.length === 0) return null;
  // base64 พองขึ้นราวหนึ่งในสาม เทียบก่อนถอดรหัสเพื่อไม่ให้ต้องกางไฟล์ยักษ์ในหน่วยความจำก่อน
  if (source.bytes.length > Math.ceil(LOGO_MAX_BYTES * 4 / 3) + 4) return null;

  let buffer: Buffer;
  try {
    buffer = Buffer.from(source.bytes, 'base64');
  } catch {
    return null;
  }
  if (buffer.length === 0 || buffer.length > LOGO_MAX_BYTES) return null;
  if (!SKIN_MAGIC[ext](buffer)) return null;

  return { ext, bytes: source.bytes };
}

function readImageMap(
  value: unknown,
  keyIsValid: (key: string) => boolean
): Record<string, BackupImage> {
  const out: Record<string, BackupImage> = {};
  // Object.entries ของ object ที่ผ่าน JSON.parse มา ไม่คืน __proto__ อยู่แล้ว
  // แต่คีย์ยังต้องผ่านตัวตรวจ เพราะมันจะกลายเป็นชื่อไฟล์
  Object.entries(asRecord(value)).forEach(([key, raw]) => {
    if (!keyIsValid(key)) return;
    const image = readImage(raw);
    if (image) out[key] = image;
  });
  return out;
}

function readPlayers(value: unknown): BackupPlayer[] {
  return asArray(value, 5).map((raw, index) => {
    const p = asRecord(raw);
    return {
      slot: clampNumber(p.slot ?? index, 0, 4),
      name: sanitizeText(p.name, 24),
      // ตำแหน่งถูกกรองอีกทีตอนเขียนลงฐานผ่าน sanitizeRoster
      position: sanitizeText(p.position, 16),
      isCaptain: p.isCaptain === true
    };
  });
}

function readTeam(value: unknown): BackupTeam | null {
  const t = asRecord(value);
  const id = asId(t.id);
  if (!id) return null;
  const name = sanitizeText(t.name, 40);
  if (!name) return null;

  return {
    id,
    name,
    tag: sanitizeText(t.tag, 8),
    logoV: clampNumber(t.logoV, 0, Number.MAX_SAFE_INTEGER),
    logoExt: Object.values(SKIN_TYPES).includes(t.logoExt as ImageExt) ? String(t.logoExt) : '',
    createdAt: asTime(t.createdAt),
    updatedAt: asTime(t.updatedAt),
    players: readPlayers(t.players)
  };
}

function readTournament(value: unknown): BackupTournament | null {
  const t = asRecord(value);
  const id = asId(t.id);
  if (!id) return null;
  const name = sanitizeText(t.name, 60);
  if (!name) return null;

  return {
    id,
    name,
    status: sanitizeText(t.status, 16),
    format: sanitizeText(t.format, 24),
    bestOf: clampNumber(t.bestOf, 1, 99),
    note: sanitizeText(t.note, 500),
    createdAt: asTime(t.createdAt),
    updatedAt: asTime(t.updatedAt),
    teams: asArray(t.teams, MAX_TEAMS).map((raw) => {
      const entry = asRecord(raw);
      return {
        teamId: asId(entry.teamId) || '',
        seed: clampNumber(entry.seed, 0, 9999),
        addedAt: asTime(entry.addedAt)
      };
    }).filter((entry) => entry.teamId !== '')
  };
}

function readMatch(value: unknown): BackupMatch | null {
  const m = asRecord(value);
  const id = asId(m.id);
  const tournamentId = asId(m.tournamentId);
  if (!id || !tournamentId) return null;

  return {
    id,
    tournamentId,
    // ชื่อสายไปอยู่ในคีย์ตำแหน่ง ไม่ได้เป็นชื่อไฟล์ จำกัดความยาวก็พอ
    bracket: sanitizeText(m.bracket, 16) || 'main',
    round: clampNumber(m.round, 0, 9999),
    slot: clampNumber(m.slot, 0, 9999),
    teamAId: asId(m.teamAId),
    teamBId: asId(m.teamBId),
    bestOf: clampNumber(m.bestOf, 1, 99),
    status: sanitizeText(m.status, 16) || 'pending',
    scoreA: clampNumber(m.scoreA, 0, 99),
    scoreB: clampNumber(m.scoreB, 0, 99),
    winnerId: asId(m.winnerId),
    isBye: m.isBye === true,
    nextRound: asNullableInt(m.nextRound),
    nextSlot: asNullableInt(m.nextSlot),
    nextSide: asNullableInt(m.nextSide),
    nextBracket: m.nextBracket === null || m.nextBracket === undefined
      ? null : sanitizeText(m.nextBracket, 16),
    loserRound: asNullableInt(m.loserRound),
    loserSlot: asNullableInt(m.loserSlot),
    loserSide: asNullableInt(m.loserSide),
    loserBracket: m.loserBracket === null || m.loserBracket === undefined
      ? null : sanitizeText(m.loserBracket, 16),
    createdAt: asTime(m.createdAt)
  };
}

function readGame(value: unknown): BackupGame | null {
  const g = asRecord(value);
  const id = asId(g.id);
  const matchId = asId(g.matchId);
  if (!id || !matchId) return null;

  return {
    id,
    matchId,
    gameNo: clampNumber(g.gameNo, 1, 99),
    blueTeamId: asId(g.blueTeamId),
    redTeamId: asId(g.redTeamId),
    blueName: sanitizeText(g.blueName, 40),
    redName: sanitizeText(g.redName, 40),
    draftLocked: g.draftLocked === true,
    winner: g.winner === 'blue' || g.winner === 'red' ? g.winner : null,
    startedAt: asTime(g.startedAt),
    updatedAt: asTime(g.updatedAt),
    // ชื่อฮีโร่เก็บดิบตามกฎของ game_slots ห้ามกรองกับรายชื่อฮีโร่ปัจจุบัน
    // ไม่งั้นประวัติที่อ้างฮีโร่ที่ถูกเปลี่ยนชื่อไฟล์ไปแล้วจะหายไปตอนนำเข้า
    // แต่ยังต้องจำกัดความยาวและตัดอักขระควบคุม เพราะมันจะถูกเอาไปวาดบนจอ
    slots: asArray(g.slots, MAX_SLOTS_PER_GAME).map((raw) => {
      const s = asRecord(raw);
      return {
        side: s.side === 'red' ? 'red' : 'blue',
        kind: s.kind === 'ban' ? 'ban' : 'pick',
        idx: clampNumber(s.idx, 0, 4),
        hero: sanitizeText(s.hero, 40)
      };
    }).filter((s) => s.hero !== '')
  };
}

// อ่านไฟล์ที่นำเข้ามา คืน error เป็นข้อความ ไม่โยน
//
// ทุกอย่างที่ออกจากฟังก์ชันนี้ถือว่าปลอดภัยพอจะเอาไปเขียนฐานได้แล้ว
// ยกเว้นอย่างเดียว: การชนกันของ id กับของที่มีอยู่ ซึ่งเป็นเรื่องของชั้น store
export function readBackup(raw: unknown): ReadResult {
  const file = asRecord(raw);

  if (file.format !== BACKUP_FORMAT) {
    return { error: 'That file is not a ROV Overlay backup' };
  }
  const version = Number(file.version);
  if (!Number.isFinite(version) || version < 1) {
    return { error: 'That backup file has no version' };
  }
  if (version > BACKUP_VERSION) {
    return { error: 'That backup was made by a newer version of the app' };
  }
  if (file.kind !== 'full') {
    return { error: 'Only full backups can be restored right now' };
  }

  const data = asRecord(file.data);
  const teams = asArray(data.teams, MAX_TEAMS_IN_FILE)
    .map(readTeam).filter((t): t is BackupTeam => t !== null);
  const tournaments = asArray(data.tournaments, MAX_TOURNAMENTS_IN_FILE)
    .map(readTournament).filter((t): t is BackupTournament => t !== null);
  const matches = asArray(data.matches, MAX_MATCHES_IN_FILE)
    .map(readMatch).filter((m): m is BackupMatch => m !== null);
  const games = asArray(data.games, MAX_GAMES_IN_FILE)
    .map(readGame).filter((g): g is BackupGame => g !== null);

  return {
    file: {
      format: BACKUP_FORMAT,
      version,
      kind: 'full',
      app: sanitizeText(file.app, 24),
      exportedAt: sanitizeText(file.exportedAt, 40),
      data: {
        teams,
        tournaments,
        matches,
        games,
        // คีย์ของโลโก้คือ id ของทีม มันจะกลายเป็นชื่อไฟล์
        //
        // ใช้ isTeamLogoId ไม่ใช่ isSafeMediaId ตัวหลังยอมให้ชื่อ 'blue-team' กับ
        // 'red-team' ผ่าน ซึ่งเป็นชื่อไฟล์ของช่องโลโก้ในแมตช์ที่กำลังออกอากาศ
        // ไฟล์นำเข้าที่ตั้งคีย์เป็นสองชื่อนั้นจะเขียนทับภาพที่อยู่บนจอตอนนั้นได้เลย
        // teamLogoFilePath ก็กันไว้อีกชั้น แต่ควรตกตั้งแต่ตอนอ่าน ไม่ใช่ตอนโยน error
        logos: readImageMap(data.logos, (key) => isTeamLogoId(key)),
        // คีย์ของภาพพื้นหลังเป็นชื่อช่องที่กำหนดไว้ตายตัว ไม่ใช่ข้อความอิสระ
        skins: readImageMap(data.skins, (key) => isSkinSlot(key)),
        state: data.state ?? null
      }
    }
  };
}

// สรุปว่าไฟล์มีอะไรอยู่ข้างใน ใช้แสดงก่อนถามยืนยัน
export interface BackupSummary {
  teams: number;
  tournaments: number;
  matches: number;
  games: number;
  drafts: number;
  logos: number;
  skins: number;
  exportedAt: string;
  app: string;
}

export function summarise(file: BackupFile): BackupSummary {
  return {
    teams: file.data.teams.length,
    tournaments: file.data.tournaments.length,
    matches: file.data.matches.length,
    games: file.data.games.length,
    drafts: file.data.games.filter((g) => g.slots.length > 0).length,
    logos: Object.keys(file.data.logos).length,
    skins: Object.keys(file.data.skins).length,
    exportedAt: file.exportedAt,
    app: file.app
  };
}
