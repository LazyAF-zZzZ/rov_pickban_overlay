// ภาพที่ผู้ใช้อัปโหลด: ตารางช่อง, ที่อยู่ไฟล์, และการตรวจชนิดไฟล์
//
// กฎเหล็กของไฟล์นี้: ชื่อไฟล์ต้องมาจากตารางที่กำหนดไว้ในโค้ดเท่านั้น
// ห้ามเอาข้อความจากผู้ใช้มาต่อเป็น path ไม่ว่ากรณีใด
//
// ตอนทำโลโก้ทีมสำหรับทัวร์นาเมนต์ (128 ทีม) จะใช้ตารางตายตัวไม่ได้แล้ว
// ให้ตั้งชื่อไฟล์จาก id ที่ "ฝั่งเซิร์ฟเวอร์เป็นคนสร้าง" แล้วตรวจด้วย
// isSafeMediaId ก่อนใช้เสมอ ห้ามใช้ชื่อทีมที่ผู้ใช้พิมพ์มาเป็นชื่อไฟล์
//
// SkinSlot / LogoSlot เป็นชนิดที่คำนวณจากตารางข้างล่าง ไม่ได้พิมพ์ซ้ำ
// เพิ่มช่องใหม่ในตารางแล้วชนิดขยายตามเอง ลืมแก้ที่อื่นไม่ได้

import fs from 'fs';
import path from 'path';
import { USER_MEDIA_DIR, USER_SOUND_DIR } from '../config';

// ชื่อไฟล์เสียงที่ overlay มองหา ตายตัวสามชื่อ ตรงกับตารางใน public/js/overlay-sfx.js
// ผู้ใช้เอาไฟล์มาวางเอง ไม่มีหน้าอัปโหลด จึงต้องมีที่เดียวที่บอกว่าชื่ออะไรบ้าง
export const SOUND_FILES = ['pick', 'ban', 'timer-warning'] as const;

// สร้างโฟลเดอร์ให้ตั้งแต่เปิดแอพ ไม่ใช่รอให้ผู้ใช้สร้างเอง
//
// โฟลเดอร์นี้อยู่คนละที่กันระหว่างรันจาก source กับรันจากตัวติดตั้ง
// ถ้าไม่สร้างให้ ผู้ใช้ต้องเดาเองว่าต้องไปสร้างที่ไหน ซึ่งเดาผิดแน่นอน
// ใบ README ข้างในบอกชื่อไฟล์ที่ต้องใช้ เขียนทับทุกครั้งที่เปิดแอพไม่ได้
// เพราะผู้ใช้อาจแก้ไว้ จึงเขียนเฉพาะตอนที่ยังไม่มี
export function ensureSoundDir(): string {
  try {
    fs.mkdirSync(USER_SOUND_DIR, { recursive: true });

    const readme = path.join(USER_SOUND_DIR, 'README.txt');
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, SOUND_README, 'utf8');
    }
  } catch (error) {
    // สร้างไม่ได้ก็ไม่เป็นไร แค่ไม่มีเสียง ส่วนที่เหลือของแอพต้องเปิดได้ตามปกติ
  }
  return USER_SOUND_DIR;
}

const SOUND_README = [
  'Overlay sound effects',
  '=====================',
  '',
  'Put your own sound files in THIS folder, using exactly these names:',
  '',
  '    pick.mp3            when a hero is picked',
  '    ban.mp3             when a hero is banned',
  '    timer-warning.mp3   every second through the last 10 (10, 9, ... 1)',
  '',
  '.wav works too (pick.wav, ban.wav, timer-warning.wav).',
  'You do not need all three - whatever is missing simply stays silent.',
  '',
  'Then add ?sfx=1 to the end of the browser source URL of the ONE source',
  'that should have sound, and restart / refresh that source:',
  '',
  '    http://127.0.0.1:3000/overlay?sfx=1',
  '',
  'In OBS: source Properties -> tick "Control audio via OBS" so viewers hear it,',
  'and leave "Shutdown source when not visible" unticked. The overlay has to stay',
  'running for sound to play, and OBS only mixes audio from sources in the scene',
  'you are broadcasting - so the overlay must be in that scene, not just in another.',
  '',
  'Testing in a normal browser instead of OBS? Chrome will not let any page make',
  'sound until you click on it once, so the overlay shows a "Click to enable',
  'sound" button. Click anywhere on the page and it works from then on.',
  'That button never appears inside OBS, which does not have that restriction.',
  '',
'If you get no sound, open the sound check page - it tells you which of the',
  'three possible causes it is:',
  '',
  '    http://127.0.0.1:3000/sfx-test',
  '',
  'Open that same page as a browser source INSIDE OBS to test what OBS itself',
  'can do. It prints the verdict on screen, because OBS has no console.',
  ''
].join('\r\n');

// นามสกุลที่ overlay เล่นได้ เรียงตามลำดับที่จะเลือกใช้ถ้ามีทั้งคู่
// ตรงกับ EXTS ใน public/js/overlay-sfx.js
const SOUND_EXTS = ['mp3', 'wav'] as const;

export interface FoundSound {
  file: string;
  url: string;
  bytes: number;
}

// ไฟล์เสียงที่มีอยู่จริงตอนนี้ อ่านจากดิสก์ทุกครั้ง ไม่แคช
// ผู้ใช้เอาไฟล์มาวางระหว่างที่แอพเปิดอยู่ได้ตลอด ไม่ต้องปิดเปิดใหม่
export function findSounds(): Record<string, FoundSound> {
  const found: Record<string, FoundSound> = {};

  ([['pick', 'pick'], ['ban', 'ban'], ['timer', 'timer-warning']] as const).forEach(([key, file]) => {
    for (const ext of SOUND_EXTS) {
      const full = path.join(USER_SOUND_DIR, `${file}.${ext}`);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        found[key] = { file: `${file}.${ext}`, url: `/sounds/${file}.${ext}`, bytes: stat.size };
        return;
      } catch (error) {
        // ไม่มีไฟล์นามสกุลนี้ ลองอันถัดไป
      }
    }
  });

  return found;
}

// ภาพพื้นหลังที่ผู้ใช้ออกแบบเอง แยกเป็นส่วนบน/ส่วนล่าง และแยกตามขนาดจอ
// overlay: บน = แถบ ban/score/timer, ล่าง = การ์ด pick
// result:  บน = ฝั่งน้ำเงิน, ล่าง = ฝั่งแดง
//
// แยก 1080p กับ 1440p คนละไฟล์ เพราะขนาดที่วาดจริงไม่เท่ากัน
// ถ้าใช้ไฟล์เดียวกัน ภาพ 1080p จะถูกขยายขึ้นไปใช้กับ 1440p แล้วเบลอ
export const SKIN_SLOTS = {
  overlayTop1080: 'overlay-top-1080',
  overlayTop1440: 'overlay-top-1440',
  overlayBottom1080: 'overlay-bottom-1080',
  overlayBottom1440: 'overlay-bottom-1440',
  resultTop1080: 'result-top-1080',
  resultTop1440: 'result-top-1440',
  resultBottom1080: 'result-bottom-1080',
  resultBottom1440: 'result-bottom-1440'
} as const;

// โลโก้ทีม แยกจาก skin เพราะผูกกับทีม ไม่ได้ผูกกับขนาดจอ
// ชื่อไฟล์มาจากตารางนี้เท่านั้น ไม่เอาค่าจากผู้ใช้มาต่อ path
export const LOGO_SLOTS = { teamBlue: 'blue-team', teamRed: 'red-team' } as const;

export type SkinSlot = keyof typeof SKIN_SLOTS;
export type LogoSlot = keyof typeof LOGO_SLOTS;
export type ImageExt = 'png' | 'jpg' | 'webp';

export interface Logo {
  v: number;
  ext: ImageExt | '';
  // ชื่อไฟล์ (ไม่รวมนามสกุล) ที่เก็บภาพนี้ไว้
  //
  // เดิมไม่มีฟิลด์นี้ ผู้เล่นหน้า overlay จึงเดาชื่อไฟล์จาก "ฝั่ง" แทน
  // (ฝั่งน้ำเงิน = blue-team เสมอ) ซึ่งพังสองแบบ:
  //   1. สลับฝั่ง แล้วข้อมูลใน state สลับ แต่ไฟล์ไม่สลับ ภาพจึงไม่เปลี่ยน
  //   2. เอาแมตช์ของทัวร์นาเมนต์ขึ้นจอ state ได้ v/ext ของทีมในทะเบียนมา
  //      แต่ overlay ยังไปเปิด blue-team.<ext> ซึ่งเป็นภาพของใครก็ไม่รู้ที่ค้างอยู่
  //
  // มีค่าได้สองแบบ: ชื่อช่องของแมตช์ ('blue-team' / 'red-team')
  // หรือ id ของทีมในทะเบียน ทั้งสองแบบเป็นชื่อไฟล์ที่เซิร์ฟเวอร์ออกให้เอง
  // ไม่ใช่ข้อความที่ผู้ใช้พิมพ์ และถูกตรวจด้วย isLogoSource ก่อนใช้เสมอ
  src?: string;
}

export interface Skin {
  enabled: boolean;
  showPanels: boolean;
  slots: Record<SkinSlot, number>;
}

export const SKIN_DIR = path.join(USER_MEDIA_DIR, 'skins');
export const LOGO_DIR = path.join(USER_MEDIA_DIR, 'team-logos');

export const SKIN_MAX_BYTES = 8 * 1024 * 1024;
export const LOGO_MAX_BYTES = 4 * 1024 * 1024;
export const SKIN_TYPES: Record<string, ImageExt> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
};

const IMAGE_EXTS: ImageExt[] = ['png', 'jpg', 'webp'];

// ตรวจสามชั้น: ชื่อ slot ต้องอยู่ในตารางที่กำหนด, content-type ต้องเป็นภาพ
// ที่รองรับ และ magic bytes ต้องตรงกับชนิดที่บอกมาจริงๆ
export const SKIN_MAGIC: Record<ImageExt, (b: Buffer) => boolean> = {
  png: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  jpg: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  webp: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
};

// ชื่ออุปกรณ์ที่ Windows จองไว้ ห้ามเป็นชื่อไฟล์
//
// แอพนี้ลงบน Windows และ Windows ตีความชื่อพวกนี้เป็นอุปกรณ์ ไม่ใช่ไฟล์
// รวมถึงตอนมีนามสกุลต่อท้ายด้วย: "aux.png" ก็ยังหมายถึงอุปกรณ์ AUX
// การเขียนลงไปจะล้มเหลวหรือค้าง ไม่ใช่ได้ไฟล์ภาพ
//
// วันนี้ยังไปไม่ถึงจุดนั้น: id ถูกสร้างจากเซิร์ฟเวอร์ (newId) และเส้นทางอัปโหลด
// โลโก้เช็คก่อนว่ามีทีมนั้นอยู่จริง ใครก็ตั้ง id เป็น "aux" ไม่ได้
// กันไว้ด้วยเหตุผลเดียวกับที่ newId เรียก isSafeMediaId ซ้ำอีกที:
// ถ้าวันหลังมีคนเปิดให้ตั้ง id เองแล้วลืมนึกถึงเรื่องนี้ ด่านนี้จะยังอยู่
const WINDOWS_DEVICE_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9'
]);

// id ที่เอาไปเป็นชื่อไฟล์ได้ ไว้ใช้ตอนโลโก้ต่อทีมในโหมดทัวร์นาเมนต์
// ยอมเฉพาะ a-z 0-9 และ - เท่านั้น ไม่มีจุด ไม่มี slash จึงออกนอกโฟลเดอร์ไม่ได้
export function isSafeMediaId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
    && !WINDOWS_DEVICE_NAMES.has(value);
}

export function isSkinSlot(value: unknown): value is SkinSlot {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SKIN_SLOTS, value);
}

export function isLogoSlot(value: unknown): value is LogoSlot {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(LOGO_SLOTS, value);
}

export function skinFilePath(slot: SkinSlot, ext: ImageExt): string {
  return path.join(SKIN_DIR, `${SKIN_SLOTS[slot]}.${ext}`);
}

export function logoFilePath(team: LogoSlot, ext: ImageExt): string {
  return path.join(LOGO_DIR, `${LOGO_SLOTS[team]}.${ext}`);
}

export function removeSkinFiles(slot: SkinSlot): void {
  IMAGE_EXTS.forEach((ext) => {
    try { fs.unlinkSync(skinFilePath(slot, ext)); } catch { /* ไม่มีไฟล์ก็ข้ามไป */ }
  });
}

export function removeLogoFiles(team: LogoSlot): void {
  IMAGE_EXTS.forEach((ext) => {
    try { fs.unlinkSync(logoFilePath(team, ext)); } catch { /* ไม่มีไฟล์ก็ข้ามไป */ }
  });
}

// โลโก้ของทีมในทะเบียน (คนละชุดกับช่องน้ำเงิน/แดงของแมตช์ที่ออกอากาศ)
//
// อยู่โฟลเดอร์เดียวกันได้ เพราะชื่อไฟล์คนละรูปแบบกันโดยสิ้นเชิง:
// ช่องของแมตช์ = 'blue-team' / 'red-team' ส่วนทีมในทะเบียน = 't' + เลขฐานสิบหก
// แต่ก็ยังกันไว้อีกชั้นด้วย isTeamLogoId เผื่อวันหลังมีคนแก้รูปแบบ id
const RESERVED_LOGO_NAMES = new Set<string>(Object.values(LOGO_SLOTS));

export function isTeamLogoId(value: unknown): value is string {
  return isSafeMediaId(value) && !RESERVED_LOGO_NAMES.has(value);
}

// src ที่รับได้: ชื่อช่องของแมตช์ หรือ id ทีมที่ปลอดภัยพอจะเป็นชื่อไฟล์
export function isLogoSource(value: unknown): value is string {
  return typeof value === 'string'
    && (RESERVED_LOGO_NAMES.has(value) || isSafeMediaId(value));
}

export function teamLogoFilePath(teamId: string, ext: ImageExt): string {
  if (!isTeamLogoId(teamId)) throw new Error(`Unsafe team logo id: ${teamId}`);
  return path.join(LOGO_DIR, `${teamId}.${ext}`);
}

export function removeTeamLogoFiles(teamId: string): void {
  if (!isTeamLogoId(teamId)) return;
  IMAGE_EXTS.forEach((ext) => {
    try { fs.unlinkSync(teamLogoFilePath(teamId, ext)); } catch { /* ไม่มีไฟล์ก็ข้ามไป */ }
  });
}

// นามสกุลต้องเป็นค่าที่รู้จักเท่านั้น เพราะถูกเอาไปต่อเป็นชื่อไฟล์
export function sanitizeLogo(value: unknown): Logo {
  const source = (value && typeof value === 'object' ? value : {}) as {
    v?: unknown; ext?: unknown; src?: unknown;
  };
  const v = Number(source.v);
  const ext = IMAGE_EXTS.includes(source.ext as ImageExt) ? (source.ext as ImageExt) : '';

  // ไม่มี src ก็ปล่อยว่างไว้ได้ ฝั่งหน้าเว็บจะถอยไปใช้ชื่อตามฝั่งเหมือนเดิม
  // state.json ของเวอร์ชันก่อนหน้าจึงยังใช้งานได้โดยไม่ต้องแปลงอะไร
  const logo: Logo = { v: 0, ext: '' };
  if (isLogoSource(source.src)) logo.src = source.src;

  // ยังไม่มีภาพ แต่ src ต้องรอด
  //
  // src บอกว่า "ช่องนี้เป็นของทีมไหน" ซึ่งเป็นคนละเรื่องกับ "มีภาพหรือยัง"
  // เดิมคืน { v: 0, ext: '' } ทิ้ง src ไปด้วย ทีมที่ยังไม่มีโลโก้ตอนเอาขึ้นจอ
  // จึงไม่เหลืออะไรบอกว่าฝั่งนั้นคือทีมไหน แล้วการอัปโหลดโลโก้ทีหลัง
  // หาไม่เจอว่าต้องไปรีเฟรชฝั่งไหน (ดู refreshLiveTeamLogo)
  // หน้าเว็บไม่กระทบ ทุกที่เช็ค v กับ ext ก่อนจะแตะ src อยู่แล้ว
  if (!Number.isFinite(v) || v <= 0 || !ext) return logo;

  logo.v = Math.trunc(v);
  logo.ext = ext;
  return logo;
}

export function sanitizeSkin(value: unknown): Skin {
  const source = (value && typeof value === 'object' ? value : {}) as {
    slots?: unknown; enabled?: unknown; showPanels?: unknown;
  };
  const slotsIn = (source.slots && typeof source.slots === 'object' ? source.slots : {}) as Record<string, unknown>;
  const slots = {} as Record<SkinSlot, number>;
  (Object.keys(SKIN_SLOTS) as SkinSlot[]).forEach((key) => {
    const n = Number(slotsIn[key]);
    slots[key] = Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
  });
  return {
    enabled: source.enabled === true,
    showPanels: source.showPanels !== false,
    slots
  };
}
