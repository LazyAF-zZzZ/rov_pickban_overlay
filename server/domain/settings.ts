// การตั้งค่าเครื่องมือ: ธีม, คีย์ลัด, ขนาดจอ
//
// ต่างจากข้อมูลแมตช์ตรงที่ "ไม่หาย" เวลาเปิดแมตช์ใหม่ขึ้นจอหรือกด RESET MATCH
// ดูที่ CARRIED_OVER_KEYS ท้ายไฟล์

import { deepClone } from '../lib/json';

// เลือกครั้งเดียว มีผลกับทุกหน้าจอ overlay และ result
export const OVERLAY_SIZES = ['1080', '1440'] as const;
export type OverlaySize = typeof OVERLAY_SIZES[number];

// เขียนเป็นค่าคงที่ตรงนี้ ไม่อ้าง defaultState เพราะ match.ts เรียกใช้ไฟล์นี้
// ถ้าอ้างกลับไปจะกลายเป็น import วนกัน
export const DEFAULT_OVERLAY_SIZE: OverlaySize = '1080';

export type ThemeColorKey = 'blue' | 'red' | 'accent' | 'text' | 'label';
export type ThemeNumberKey =
  | 'typeCaption' | 'typePlayer' | 'typeTournament' | 'typeTitle'
  | 'typeScore' | 'typeTimer' | 'logoSize' | 'logoInset';

export type Theme = Record<ThemeColorKey, string> & Record<ThemeNumberKey, number>;

export interface HotkeyBinding {
  code: string;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
}

export type HotkeyAction = 'toggleBanner' | 'pauseResume' | 'prevPhase' | 'nextPhase' | 'undo';
export type Hotkeys = Record<HotkeyAction, HotkeyBinding>;

// ธีมของ overlay ทุกค่าตรงกับ CSS custom property ใน overlay.css
// ค่า default ต้องตรงกับ :root ในไฟล์นั้นเป๊ะๆ ไม่งั้นกด Reset แล้วหน้าตาเปลี่ยน
export const THEME_DEFAULTS: Theme = {
  blue: '#38bdf8',
  red: '#f87171',
  accent: '#f59e0b',
  text: '#ffffff',
  label: '#c0c0c0',
  typeCaption: 14,
  typePlayer: 18,
  typeTournament: 18,
  typeTitle: 24,
  typeScore: 42,
  typeTimer: 40,
  logoSize: 138,
  logoInset: 10
};

// ช่วงที่ยอมให้ปรับ กว้างพอให้เล่นได้ แต่ไม่ถึงขั้นทำ layout พัง
export const THEME_NUMBER_RANGE: Record<ThemeNumberKey, [number, number]> = {
  typeCaption: [8, 40],
  typePlayer: [10, 48],
  typeTournament: [10, 48],
  typeTitle: [10, 60],
  typeScore: [12, 96],
  typeTimer: [12, 96],
  logoSize: [40, 260],
  logoInset: [-40, 200]
};

export const THEME_COLOR_KEYS: ThemeColorKey[] = ['blue', 'red', 'accent', 'text', 'label'];

// คีย์ลัดของหน้า Control Panel ตั้งค่าได้จากหน้า /hotkeys
//
// code = event.code ของปุ่มจริง เช่น 'Space', 'KeyZ', 'ArrowLeft'
// ยกเว้นปุ่ม modifier ล้วน เก็บเป็นชื่อจาก event.key ('Alt', 'Control', ...)
// เพราะจะถูกดักตอน "แตะเดี่ยวๆ" ไม่ใช่ตอนกดค้างเป็นคีย์ผสม
export const HOTKEY_MODIFIER_CODES = ['Alt', 'Control', 'Shift', 'Meta'];

export const HOTKEY_DEFAULTS: Hotkeys = {
  toggleBanner: { code: 'Alt', ctrl: false, shift: false, alt: false, meta: false },
  pauseResume: { code: 'Space', ctrl: false, shift: false, alt: false, meta: false },
  prevPhase: { code: 'ArrowLeft', ctrl: false, shift: false, alt: false, meta: false },
  nextPhase: { code: 'ArrowRight', ctrl: false, shift: false, alt: false, meta: false },
  undo: { code: 'KeyZ', ctrl: true, shift: false, alt: false, meta: false }
};

export function sanitizeOverlaySize(value: unknown): OverlaySize {
  const text = String(value);
  return (OVERLAY_SIZES as readonly string[]).includes(text)
    ? (text as OverlaySize)
    : DEFAULT_OVERLAY_SIZE;
}

// สีต้องเป็น #rrggbb เท่านั้น ค่านี้ถูกเอาไปยัดใส่ CSS custom property
// ตรงๆ ปล่อยให้กรอกอะไรก็ได้เท่ากับเปิดช่องให้แทรก CSS
export function sanitizeThemeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback;
}

export function sanitizeTheme(value: unknown): Theme {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const theme = {} as Theme;

  THEME_COLOR_KEYS.forEach((key) => {
    theme[key] = sanitizeThemeColor(source[key], THEME_DEFAULTS[key]);
  });

  (Object.entries(THEME_NUMBER_RANGE) as [ThemeNumberKey, [number, number]][])
    .forEach(([key, [min, max]]) => {
      const n = Number(source[key]);
      theme[key] = Number.isFinite(n)
        ? Math.min(max, Math.max(min, Math.round(n)))
        : THEME_DEFAULTS[key];
    });

  return theme;
}

// code มาจากผู้ใช้กดปุ่มอะไรก็ได้ จำกัดรูปแบบไว้ให้เป็นชื่อ code ของ DOM
// เท่านั้น ค่านี้ถูกเอาไปเทียบกับ event.code ตรงๆ ไม่ได้เอาไปต่อเป็น HTML
export function sanitizeHotkeyBinding(value: unknown, fallback: HotkeyBinding): HotkeyBinding {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const code = typeof source.code === 'string' ? source.code.trim() : '';
  if (!/^[A-Za-z][A-Za-z0-9]{0,19}$/.test(code)) return { ...fallback };
  return {
    code,
    ctrl: source.ctrl === true,
    shift: source.shift === true,
    alt: source.alt === true,
    meta: source.meta === true
  };
}

export function sanitizeHotkeys(value: unknown): Hotkeys {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const hotkeys = {} as Hotkeys;
  (Object.entries(HOTKEY_DEFAULTS) as [HotkeyAction, HotkeyBinding][])
    .forEach(([action, fallback]) => {
      hotkeys[action] = sanitizeHotkeyBinding(source[action], fallback);
    });
  return hotkeys;
}

// ระดับเสียงของเอฟเฟกต์แต่ละเหตุการณ์ 0 ถึง 1
//
// เก็บใน state ไม่ใช่ใน URL ตั้งใจ: ปรับแล้วต้องมีผลกับ overlay ที่เปิดค้างอยู่
// ใน OBS ทันที โดยไม่ต้องไปแก้ URL ของ browser source แล้ว Refresh ใหม่
// ซึ่งกลางรายการทำไม่ได้ ค่าเดินทางไปกับ stateUpdate เหมือนธีมกับคีย์ลัด
export const SFX_KEYS = ['pick', 'ban', 'timer'] as const;
export type SfxKey = typeof SFX_KEYS[number];
export type SfxLevels = Record<SfxKey, number>;

// เริ่มที่ดังเต็ม ให้ไปหรี่เอาเองถ้าดังไป
// เงียบโดยไม่รู้ตัวหาสาเหตุยากกว่าดังเกินไปมาก (บทเรียนจากบั๊ก vol=0)
export const SFX_DEFAULTS: SfxLevels = { pick: 1, ban: 1, timer: 1 };

export function sanitizeSfx(value: unknown): SfxLevels {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const levels = {} as SfxLevels;
  SFX_KEYS.forEach((key) => {
    const n = Number(source[key]);
    // ค่าที่ใช้ไม่ได้ให้ถอยไปที่ค่าเริ่มต้น ไม่ใช่ 0
    // Number(undefined) เป็น NaN ตรงนี้จึงปลอดภัย ต่างจาก Number(null) ที่เป็น 0
    levels[key] = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : SFX_DEFAULTS[key];
  });
  return levels;
}

// ค่าที่เป็น "การตั้งค่าเครื่องมือ" ไม่ใช่ข้อมูลของแมตช์
//
// โหลดพรีเซ็ตหรือกด RESET MATCH คือการเปลี่ยน "แมตช์" ไม่ใช่การล้างค่าที่
// ตั้งไว้ ธีมที่ปรับทั้งวัน คีย์ลัดที่ผูกไว้ ภาพพื้นหลังที่อัปโหลด และขนาดจอ
// ต้องอยู่เหมือนเดิม ไม่งั้นโหลดพรีเซ็ตกลางอากาศทีเดียวหน้าตาเปลี่ยนหมด
//
// ตอนทำโหมดทัวร์นาเมนต์ การกดเลือกแมตช์ก็คือการเปลี่ยนแมตช์เหมือนกัน
// ให้ใช้ทางนี้ อย่าเขียนทับ state ทั้งก้อน
export const CARRIED_OVER_KEYS = [
  'overlayVisible', 'overlaySize', 'theme', 'hotkeys', 'skin', 'sfx'
] as const;

export type CarriedOverKey = typeof CARRIED_OVER_KEYS[number];

// T extends object ไม่ใช่ Record<string, unknown>
// เพราะ interface อย่าง GameState ไม่มี index signature จึงไม่เข้าเงื่อนไขตัวหลัง
export function carryOverSettings<T extends object>(
  nextState: T,
  previous: unknown
): T {
  const source = (previous || {}) as Record<string, unknown>;
  const target = nextState as Record<string, unknown>;
  CARRIED_OVER_KEYS.forEach((key) => {
    if (source[key] !== undefined) target[key] = deepClone(source[key]);
  });
  return nextState;
}
