// รูปร่างของ "แมตช์หนึ่งแมตช์" และตัวกรองให้ state อยู่ในรูปที่ถูกต้องเสมอ
//
// sanitizeState คือประตูเดียวที่ state จะเข้ามาได้ ไม่ว่าจะมาจากไฟล์ที่เซฟไว้
// พรีเซ็ต หรือค่าที่ผู้ใช้ส่งมา ทุกทางต้องผ่านตัวนี้
//
// สำคัญ: sanitizeState สร้าง object ใหม่จากรายการคีย์ที่รู้จักเท่านั้น
// คีย์แปลกปลอมจึงถูกทิ้งตอนเซฟรอบถัดไป
// ข้อมูลทัวร์นาเมนต์จึงต้องอยู่คนละไฟล์ ห้ามยัดมาไว้ใน state.json
// ไม่งั้นเปิดด้วยเวอร์ชันเก่าทีเดียวข้อมูลหายทั้งหมด
//
// GameState ที่ export จากไฟล์นี้คือ "สัญญา" ที่ฝั่งหน้าเว็บใช้ด้วย
// แก้รูปร่างเมื่อไหร่ ต้องไล่ดู public/js ด้วยเสมอ

import { deepClone } from '../lib/json';
import { clampNumber, sanitizeText, normalizeArray } from '../lib/sanitize';
import { sanitizeHero } from './heroes';
import type { TeamKey, SlotType } from './draft';
import { DRAFT_SEQUENCE, PICK_COUNT, BAN_COUNT, isSlotId, sanitizeTimer } from './draft';
import type { OverlaySize, Theme, Hotkeys, SfxLevels, GlobalHotkeys } from './settings';
import {
  DEFAULT_OVERLAY_SIZE,
  THEME_DEFAULTS,
  HOTKEY_DEFAULTS,
  SFX_DEFAULTS,
  GLOBAL_HOTKEY_DEFAULTS,
  sanitizeOverlaySize,
  sanitizeTheme,
  sanitizeHotkeys,
  sanitizeSfx,
  sanitizeGlobalHotkeys
} from './settings';
import type { PositionValue } from './position';
import { sanitizePosition } from './position';
import type { Logo, Skin, SkinSlot } from './media';
import { SKIN_SLOTS, sanitizeLogo, sanitizeSkin } from './media';
import type { RoundRecord } from './rounds';
import { FIRST_ROUND, sanitizeRoundNumber, sanitizeRounds } from './rounds';

export interface TeamState {
  name: string;
  score: number;
  logo: Logo;
  picks: (string | null)[];
  bans: (string | null)[];
  players: string[];
  // ตำแหน่ง (เลน) ของผู้เล่นแต่ละช่อง เรียงตรงกับ players และ picks
  //
  // อยู่ใน state ไม่ได้ให้ overlay ไปถามทะเบียนทีมเอง เพราะกราฟิกออกอากาศ
  // ไม่ได้ถือโทเคน และแมตช์เดี่ยวก็ไม่ได้ผูกกับทีมในทะเบียนอยู่แล้ว
  // ค่านี้เดินทางไปกับ stateUpdate เหมือนทุกอย่างที่กราฟิกต้องวาด
  positions: PositionValue[];
}

export interface MatchInfo {
  title: string;
  tournament: string;
}

export interface GameState {
  teamBlue: TeamState;
  teamRed: TeamState;
  currentPhase: 'PICK' | 'BAN';
  timer: string;
  draftPhaseIndex: number;
  draftLabel: string;
  draftActiveSlots: string[];
  draftRunning: boolean;
  overlaySize: OverlaySize;
  overlayVisible: boolean;
  theme: Theme;
  hotkeys: Hotkeys;
  sfx: SfxLevels;
  globalHotkeys: GlobalHotkeys;
  skin: Skin;
  matchInfo: MatchInfo;
  // เกมที่เท่าไหร่ของซีรีส์ที่กำลังคุมอยู่ เริ่มที่ 1
  //
  // ผูกกับ games.game_no เมื่อออกอากาศแมตช์ของทัวร์นาเมนต์ (ดู services/rounds.ts)
  // และเป็นตัวนับล้วนๆ เมื่อเป็นแมตช์เดี่ยว
  round: number;
  // ดราฟต์ของรอบที่ผ่านมาแล้ว เรียงจากรอบน้อยไปมาก ไม่รวมรอบปัจจุบัน
  rounds: RoundRecord[];
}

export interface SlotOwner {
  team: TeamKey;
  type: SlotType;
  index: number;
}

export const TEAM_KEYS: TeamKey[] = ['teamBlue', 'teamRed'];
const SLOT_TYPES: SlotType[] = ['picks', 'bans'];

function emptyTeam(name: string): TeamState {
  return {
    name,
    score: 0,
    // logo: v = 0 คือยังไม่มีภาพ, ตัวเลขอื่นคือเวอร์ชันไว้กัน cache
    // เก็บนามสกุลไว้ด้วย overlay จะได้ประกอบ URL ได้เลย ไม่ต้องลองโหลดทีละแบบ
    // อย่าง skin (หน้า overlay เป็นภาพออกอากาศ ลองผิดลองถูกแล้วภาพกระพริบ)
    logo: { v: 0, ext: '' },
    picks: Array.from({ length: PICK_COUNT }, () => null),
    bans: Array.from({ length: BAN_COUNT }, () => null),
    players: Array.from({ length: PICK_COUNT }, (_, i) => `Player ${i + 1}`),
    positions: Array.from({ length: PICK_COUNT }, () => '' as PositionValue)
  };
}

function emptySkin(): Skin {
  const slots = {} as Record<SkinSlot, number>;
  // 0 = ยังไม่มีภาพ, ตัวเลขอื่น = เวอร์ชันไว้กัน cache
  // เติมจาก SKIN_SLOTS จะได้ไม่ต้องมาไล่แก้สองที่
  (Object.keys(SKIN_SLOTS) as SkinSlot[]).forEach((key) => { slots[key] = 0; });
  return {
    enabled: false,     // ใช้ภาพที่อัปโหลดเป็นพื้นหลังหรือไม่
    showPanels: true,   // ยังวาดกรอบ/พื้นหลังแบบเดิมของแอพอยู่หรือไม่
    slots
  };
}

export const defaultState: GameState = {
  teamBlue: emptyTeam('BLUE'),
  teamRed: emptyTeam('RED'),
  currentPhase: 'BAN',
  timer: '00:00',
  draftPhaseIndex: -1,
  draftLabel: '',
  draftActiveSlots: [],
  draftRunning: false,
  // เลือกครั้งเดียว มีผลกับทุกหน้าจอ overlay และ result
  overlaySize: DEFAULT_OVERLAY_SIZE,
  // ซ่อน/แสดงแถบ overlay ทั้งแถบ ไว้ตัดเข้าเกมโดยไม่ต้องปิด source ใน OBS
  overlayVisible: true,
  theme: { ...THEME_DEFAULTS },
  hotkeys: deepClone(HOTKEY_DEFAULTS),
  sfx: { ...SFX_DEFAULTS },
  globalHotkeys: deepClone(GLOBAL_HOTKEY_DEFAULTS),
  skin: emptySkin(),
  matchInfo: {
    title: 'BLUE VS RED',
    tournament: 'ROV Tournament'
  },
  round: FIRST_ROUND,
  rounds: []
};

export function isTeamKey(team: unknown): team is TeamKey {
  return team === 'teamBlue' || team === 'teamRed';
}

// สำเนาแช่แข็งของเกม เท่าที่ต้องรู้เพื่อบอกว่าจอสลับฝั่งอยู่หรือเปล่า
export interface FrozenSides {
  blueTeamId: string | null;
  redTeamId: string | null;
  blueName: string;
  redName: string;
}

// จอกำลังแสดง "เกมนี้" อยู่จริงไหม และแสดงสลับฝั่งหรือเปล่า
//
// 'different' คือคำตอบที่สำคัญที่สุด และเป็นคำตอบที่เมื่อก่อนไม่มี
// ตัวบันทึกดราฟต์เกาะอยู่กับ emitState แล้วเขียนสิ่งที่อยู่บนจอลงเกมที่ตัวชี้บอก
// โดยไม่เคยถามว่าสองอย่างนี้เป็นเรื่องเดียวกันไหม พอ state ถูกแทนที่ทั้งก้อน
// (กด RESET MATCH หรือหยิบทีมจากทะเบียนมาซ้อมนอกรอบ) ตัวชี้ยังค้างอยู่ที่เกมเดิม
// การ emit ครั้งถัดไปจึงเขียนทับดราฟต์ของเกมนั้นด้วยกระดานเปล่าหรือกระดานของแมตช์ซ้อม
// เกมยังถูกนับว่า draft_locked = 1 อยู่ สถิติทั้งทัวร์นาเมนต์จึงเพี้ยนโดยไม่มีใครเห็น
export type SideOrientation = 'same' | 'swapped' | 'different';

export function orientationOf(state: GameState, frozen: FrozenSides): SideOrientation {
  // id เชื่อถือได้กว่าชื่อ: logo.src คือ id ของทีมในทะเบียน มันติดไปกับทีมตอนสลับฝั่ง
  // และไม่เปลี่ยนตามการแก้ชื่อทีมบนหน้า Control กลางเกม
  const blueSrc = state.teamBlue.logo?.src;
  const redSrc = state.teamRed.logo?.src;
  if (blueSrc && redSrc && blueSrc !== redSrc && frozen.blueTeamId && frozen.redTeamId) {
    if (blueSrc === frozen.blueTeamId && redSrc === frozen.redTeamId) return 'same';
    if (blueSrc === frozen.redTeamId && redSrc === frozen.blueTeamId) return 'swapped';
    return 'different';
  }

  // ไม่มี id ให้เทียบ ถอยไปใช้ชื่อ
  //
  // ตรงนี้ต้องใจกว้างไว้ก่อน: ชื่อเปลี่ยนได้ระหว่างแมตช์ และการตอบ 'different'
  // ผิดๆ แปลว่าหยุดบันทึกดราฟต์ของแมตช์จริงแบบเงียบๆ ซึ่งก็เสียหายพอกัน
  // จึงตอบ 'different' เฉพาะตอนที่ทั้งสองฝั่งไม่ตรงกับสำเนาเลยสักชื่อเดียว
  const blueName = state.teamBlue.name;
  const redName = state.teamRed.name;
  if (!blueName || !redName || blueName === redName) return 'same';
  if (blueName === frozen.blueName && redName === frozen.redName) return 'same';
  if (blueName === frozen.redName && redName === frozen.blueName) return 'swapped';
  if (blueName === frozen.blueName || redName === frozen.redName) return 'same';
  if (blueName === frozen.redName || redName === frozen.blueName) return 'swapped';
  return 'different';
}

// จอกำลังแสดงสลับฝั่งกับสำเนาแช่แข็งของเกมอยู่หรือเปล่า
//
// สำเนาตรึงไว้ว่า blue = ทีม A ของแมตช์ (ดู goLive) ส่วนปุ่ม "สลับฝั่ง" บนหน้า Control
// สลับเฉพาะบนจอ ไม่ได้แตะสำเนา ตั้งแต่นั้นคำว่า "น้ำเงิน" สองที่นี้คนละทีมกัน
// ใครก็ตามที่แปลงไปมาระหว่างสองโลกนี้ต้องถามฟังก์ชันนี้ก่อน
// (ตอนนี้มีสองที่: การบันทึกดราฟต์ใน store/games.ts และการซิงก์คะแนนใน services/series.ts)
//
// เทียบด้วย id ก่อน: logo.src คือ id ของทีมในทะเบียน และมันติดไปกับทีมตอนสลับฝั่ง
// จึงยังถูกแม้ผู้ใช้จะเปลี่ยนชื่อทีมบนหน้า Control กลางเกม
// ชื่อเป็นทางถอยสำหรับ state เก่าที่ยังไม่มี src และสำหรับแมตช์เดี่ยวที่ไม่ได้มาจากทะเบียน
// ชื่อซ้ำกันทั้งสองฝั่ง = แยกไม่ออก ห้ามเดา ให้ถือว่าไม่ได้สลับ (ตรงกับค่าเริ่มต้นของ goLive)
export function isDisplaySwapped(state: GameState, frozen: FrozenSides): boolean {
  return orientationOf(state, frozen) === 'swapped';
}

export function sanitizeTeam(team: unknown, fallback: TeamState): TeamState {
  const source = (team && typeof team === 'object' ? team : {}) as Record<string, unknown>;
  return {
    name: sanitizeText(source.name, 24) || fallback.name,
    score: clampNumber(source.score, 0, 99),
    logo: sanitizeLogo(source.logo),
    picks: normalizeArray(source.picks, PICK_COUNT, sanitizeHero),
    bans: normalizeArray(source.bans, BAN_COUNT, sanitizeHero),
    players: normalizeArray(source.players, PICK_COUNT, (name, index) => (
      sanitizeText(name, 24) || `Player ${index + 1}`
    )),
    positions: normalizeArray(source.positions, PICK_COUNT, sanitizePosition)
  };
}

// A hero can only appear once in a draft. Once banned or picked by either
// team it is gone, so the same name must never occupy two slots.
// slotOwner is the one slot allowed to already hold it - the slot being edited.
export function isHeroTaken(
  state: GameState,
  hero: string | null,
  slotOwner: SlotOwner | null
): boolean {
  if (!hero) return false;

  return TEAM_KEYS.some((teamKey) => (
    SLOT_TYPES.some((type) => (
      state[teamKey][type].some((value, index) => {
        if (value !== hero) return false;
        const isOwnSlot = Boolean(slotOwner) &&
          slotOwner!.team === teamKey &&
          slotOwner!.type === type &&
          slotOwner!.index === index;
        return !isOwnSlot;
      })
    ))
  ));
}

// A hand-edited state file can still contain duplicates.
// Keep the first occurrence and drop the rest so the invariant always holds.
export function dropDuplicateHeroes(state: GameState): GameState {
  const seen = new Set<string>();

  TEAM_KEYS.forEach((teamKey) => {
    // ลำดับสำคัญ: แบนก่อน แล้วค่อยเลือก ตัวที่เจอทีหลังถูกทิ้ง
    (['bans', 'picks'] as SlotType[]).forEach((type) => {
      state[teamKey][type] = state[teamKey][type].map((hero) => {
        if (!hero) return null;
        if (seen.has(hero)) return null;
        seen.add(hero);
        return hero;
      });
    });
  });

  return state;
}

export function sanitizeState(state: unknown): GameState {
  const source = (state && typeof state === 'object' ? state : {}) as Record<string, unknown>;
  const phaseIndex = clampNumber(source.draftPhaseIndex, -1, DRAFT_SEQUENCE.length);
  const phase = DRAFT_SEQUENCE[phaseIndex];
  const matchInfo = (source.matchInfo || {}) as Record<string, unknown>;

  return dropDuplicateHeroes({
    teamBlue: sanitizeTeam(source.teamBlue, defaultState.teamBlue),
    teamRed: sanitizeTeam(source.teamRed, defaultState.teamRed),
    currentPhase: source.currentPhase === 'PICK' ? 'PICK' : 'BAN',
    timer: sanitizeTimer(source.timer || defaultState.timer),
    draftPhaseIndex: phaseIndex,
    draftLabel: phaseIndex >= DRAFT_SEQUENCE.length
      ? 'coming soon'
      : sanitizeText(source.draftLabel || phase?.label || '', 32),
    draftActiveSlots: Array.isArray(source.draftActiveSlots)
      ? (source.draftActiveSlots as unknown[]).filter(isSlotId).slice(0, 2)
      : [],
    draftRunning: false,
    overlaySize: sanitizeOverlaySize(source.overlaySize),
    overlayVisible: source.overlayVisible !== false,
    theme: sanitizeTheme(source.theme),
    hotkeys: sanitizeHotkeys(source.hotkeys),
    sfx: sanitizeSfx(source.sfx),
    globalHotkeys: sanitizeGlobalHotkeys(source.globalHotkeys),
    skin: sanitizeSkin(source.skin),
    matchInfo: {
      title: sanitizeText(matchInfo.title, 80) || defaultState.matchInfo.title,
      tournament: sanitizeText(matchInfo.tournament, 50) || defaultState.matchInfo.tournament
    },
    round: sanitizeRoundNumber(source.round ?? FIRST_ROUND),
    rounds: sanitizeRounds(source.rounds)
  });
}
