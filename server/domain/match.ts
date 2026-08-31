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
import type { Logo, Skin, SkinSlot } from './media';
import { SKIN_SLOTS, sanitizeLogo, sanitizeSkin } from './media';

export interface TeamState {
  name: string;
  score: number;
  logo: Logo;
  picks: (string | null)[];
  bans: (string | null)[];
  players: string[];
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
    players: Array.from({ length: PICK_COUNT }, (_, i) => `Player ${i + 1}`)
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
  }
};

export function isTeamKey(team: unknown): team is TeamKey {
  return team === 'teamBlue' || team === 'teamRed';
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
    ))
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
    }
  });
}
