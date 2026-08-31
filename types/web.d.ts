// สัญญาของสคริปต์ฝั่งเบราว์เซอร์
//
// public/js/ เป็นสคริปต์แบบคลาสสิก ไม่มี import/export และแชร์ scope กันทั้งหน้า
// ไฟล์นี้จึงเป็นที่ประกาศว่า "ของกลาง" ตัวไหนมีอะไรบ้าง
// ตัวตรวจชนิดอ่านไฟล์นี้แล้วรู้ว่า window.RovClient มีอะไร และไม่มีอะไร
//
// สำคัญ: ห้ามประกาศตัวแปรที่แต่ละหน้าต้อง destructure เอง (เช่น controlToken)
// ไว้เป็น global ที่นี่ ไม่งั้นจะกลบบั๊กชนิดเดียวกับที่ Phase 3 เคยเจอ
// ตอนนั้น tournament.js อ้าง controlToken โดยไม่ได้ดึงออกมาจาก window.RovClient
// ถ้าไฟล์นี้ประกาศ controlToken ไว้ ตัวตรวจจะเงียบ แล้วบั๊กเดิมก็หลุดไปอีกรอบ

// เสียงเอฟเฟกต์ของ overlay (public/js/overlay-sfx.js)
//
// ประกาศเป็น global ไม่ใช่แค่บน Window เพราะ overlay.js เรียกชื่อตรงๆ
// แบบเดียวกับ io() ไม่ได้ดึงออกมาจาก window เหมือน RovClient
interface RovSfxApi {
  enabled: boolean;
  /** เล่นเสียงของเหตุการณ์หนึ่ง เงียบไว้จนกว่าจะ arm() */
  play(name: 'pick' | 'ban' | 'timer'): void;
  /** ปลดล็อกเสียง เรียกหลังวาด state ก้อนแรกเสร็จ */
  arm(): void;
  /** ตั้งระดับเสียงต่อเหตุการณ์ จาก state.sfx */
  setLevels(levels: unknown): void;
}
declare const RovSfx: RovSfxApi;

// ระบบสองภาษา (public/js/lib/i18n.js)
//
// t() เป็น global เหมือน io() ไม่ได้ดึงออกมาจาก window เพราะทุกหน้าเรียกใช้ตรงๆ
// ค่าที่สองคือข้อความอังกฤษต้นฉบับ ถ้าไม่ส่งมาจะใช้กุญแจเป็นข้อความแทน
interface RovI18nApi {
  readonly lang: string;
  t(key: string, english?: string): string;
  tf(key: string, values?: Record<string, string | number>, english?: string): string;
  apply(root?: ParentNode | null): void;
  set(lang: string): void;
  onChange(fn: (lang: string) => void): void;
}
declare const RovI18n: RovI18nApi;
declare function t(key: string, english?: string): string;
declare function tf(
  key: string,
  values?: Record<string, string | number>,
  english?: string
): string;

// socket.io client ที่มาจาก /socket.io/socket.io.js
declare function io(options?: any): RovSocket;

interface RovSocket {
  connected: boolean;
  on(event: string, handler: (...args: any[]) => void): void;
  emit(event: string, ...args: any[]): void;
}

interface RovPlayerRows {
  read(): { name: string; role: string; isCaptain: boolean }[];
  clear(): void;
  focusFirst(): void;
}

interface RovClientApi {
  controlToken: string;
  socket: RovSocket;
  withToken(url: string): string;
  absoluteUrl(path: string): string;
  fetchJson(url: string, options?: RequestInit): Promise<any>;
  showToast(message: string, type?: 'green' | 'blue' | 'red'): void;
  goBack(): void;
  confirmBox(options: {
    title: string;
    body: string | string[];
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }): Promise<boolean>;
}

interface RovTournamentUiApi {
  /** ถามยืนยันแล้วลบถาวร คืน true เมื่อลบไปแล้วจริง */
  confirmAndDelete(tournament: { id: string; name: string }): Promise<boolean>;
}

interface RovObsSourcesApi {
  SOURCES: { name: string; path: string; size: string; sfx?: boolean; perTournament?: boolean }[];
  /** วาดรายการ URL ของ browser source ลงใน container ที่ให้มา */
  render(container: HTMLElement | null, options?: { tournamentId?: string }): void;
  copyUrl(url: string): Promise<void>;
}

interface RovTeamUiApi {
  ROSTER_SIZE: number;
  LOGO_MAX_BYTES: number;
  badge(text: string, cls?: string): HTMLSpanElement;
  buildPlayerRows(
    container: HTMLElement,
    players: any[] | null | undefined,
    captainGroup: string
  ): RovPlayerRows;
  logoImage(team: any): HTMLElement;
  sendLogo(teamId: string, file: File): Promise<any>;
  hiddenFilePicker(onPick: (file: File | null) => void): HTMLInputElement;
  on(id: string, event: string, handler: (event: any) => void): HTMLElement | null;
}

interface RovHotkeyUtilsApi {
  MODIFIER_CODES: any;
  DEFAULTS: any;
  ACTIONS: any;
  isModifierBinding(binding: any): boolean;
  codeLabel(code: string): string;
  bindingLabel(binding: any): string;
  matchesBinding(event: any, binding: any): boolean;
  sameBinding(a: any, b: any): boolean;
  bindingFromEvent(event: any): any;
}

interface Window {
  RovClient: RovClientApi;
  RovI18n: RovI18nApi;
  RovSfx: RovSfxApi;
  /** obs-browser ฝังไว้ให้เฉพาะตอนหน้าถูกเปิดเป็น browser source ใน OBS */
  obsstudio?: { pluginVersion?: string; [key: string]: unknown };
  /** ชื่อเก่าของ AudioContext ยังต้องรองรับเผื่อ CEF รุ่นเก่าใน OBS */
  webkitAudioContext?: typeof AudioContext;
  RovTeamUI: RovTeamUiApi;
  RovTournamentUI: RovTournamentUiApi;
  RovObsSources: RovObsSourcesApi;
  HotkeyUtils: RovHotkeyUtilsApi;
  // overlay-size.js ตั้งไว้ให้หน้าอื่นเรียก
  applyOverlaySize(size: string): void;
  reapplySkin(): void;
  __lastSkin: any;
}

// สมบัติที่โค้ดแปะไว้บน DOM node เอง
//
// ไม่ใช่ของมาตรฐาน แต่เป็นวิธีที่หน้าเว็บใช้ผูกตัวจับเวลาไว้กับ element
// ประกาศไว้ตรงนี้เพื่อให้ตัวตรวจรู้จัก และเพื่อให้มีที่เดียวที่บอกว่ามีอะไรบ้าง
interface HTMLElement {
  /** ตัวจับเวลาซ่อน toast (lib/app-client.js) */
  _t?: ReturnType<typeof setTimeout>;
  /** ตัวจับเวลาสำรองของอนิเมชัน เผื่อ animationend ไม่ยิง (overlay.js, result.js) */
  _animTimer?: ReturnType<typeof setTimeout>;
  /** handler ที่ผูกไว้กับช่องกรอกฮีโร่ (control.js) */
  _onCommit?: (...args: any[]) => void;
}

// ส่วนของ RovClient ที่ใช้ทำ real-time sync
interface RovDataChange {
  topic: 'teams' | 'tournaments' | 'roster' | 'matches' | 'games' | 'live';
  tournamentId?: string | null;
  teamId?: string | null;
}
interface RovClientApi {
  onDataChange(handler: (change: RovDataChange) => void): void;
  isEditingWithin(root: Element | null): boolean;
  deferWhileEditing(root: Element | null, run: () => void): void;
}
