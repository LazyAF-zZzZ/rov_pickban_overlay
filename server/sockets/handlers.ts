// คำสั่งทั้งหมดที่ส่งมาทาง socket
//
// ทุกคำสั่งผ่าน controlEvent ซึ่งเช็คสิทธิ์ให้ก่อนเสมอ
// ห้ามใช้ socket.on ตรงๆ กับคำสั่งที่แก้ state ไม่งั้นจะหลุดการตรวจสิทธิ์
//
// payload ที่เข้ามาเป็น unknown ทั้งหมด ต้องแกะเองทีละตัว
// จะประกาศชนิดตายตัวไม่ได้ เพราะฝั่งที่ส่งมาคือหน้าเว็บที่ใครก็เปิดได้

import type { Socket } from 'socket.io';
import { clampNumber, sanitizeText } from '../lib/sanitize';
import { sanitizeHero } from '../domain/heroes';
import {
  PICK_COUNT,
  BAN_COUNT,
  isPickIndex,
  isBanIndex,
  sanitizeTimer,
  parseTimeToSeconds
} from '../domain/draft';
import { isTeamKey, isHeroTaken } from '../domain/match';
import {
  THEME_DEFAULTS,
  HOTKEY_DEFAULTS,
  sanitizeOverlaySize,
  sanitizeTheme,
  sanitizeHotkeys,
  sanitizeSfx,
  sanitizeGlobalHotkeys,
  GLOBAL_HOTKEY_DEFAULTS
} from '../domain/settings';
import { deepClone } from '../lib/json';
import { getState, emitState, pushUndo, popUndo } from '../store/live-state';
import {
  setDraftSeconds,
  stopDraftTimer,
  startDraftPhase,
  checkAndAdvancePhase,
  resetDraft,
  resumeDraft
} from '../services/draft-engine';
import { isAuthorizedSocket } from '../http/auth';
import { DATA_ROOM } from '../services/sync';
import { pushOverlayScoreToMatch } from '../services/series';
import { stepRound } from '../services/live-match';

type Payload = Record<string, unknown>;

// คำสั่งหนึ่งคำสั่งพังต้องไม่ล้มทั้งเซิร์ฟเวอร์
//
// socket.io ไม่ได้ดัก exception ที่หลุดออกจาก handler ให้ มันลอยขึ้นไปเป็น
// uncaughtException แล้ว Node ก็ปิด process ทิ้ง (ตรวจแล้วว่าเป็นแบบนั้นจริง)
// เซิร์ฟเวอร์ตัวเดียวนี้เสิร์ฟทั้ง overlay และหน้า Control การล้มจึงแปลว่า
// ภาพบนอากาศดับไปพร้อมกัน กลางรายการ
//
// ทางที่เป็นไปได้จริงคือคำสั่งที่ไปแตะฐานข้อมูล เช่น updateScore ที่เขียนคะแนน
// ลงตารางแข่งต่อ: SQLITE_BUSY เพราะมีโปรแกรมอื่นเปิดไฟล์ .db ค้างไว้, ดิสก์เต็ม,
// หรือเปิดฐานครั้งแรกไม่สำเร็จ ทั้งหมดนี้ node:sqlite โยน exception ออกมา
//
// ดักที่นี่ที่เดียวได้ครบ เพราะทุกคำสั่งผ่านสองฟังก์ชันนี้เท่านั้น
// และบอกคนคุมงานด้วย ไม่ใช่กลืนเงียบ — คำสั่งที่ไม่ทำงานโดยไม่บอกอะไร
// แยกไม่ออกจากคำสั่งที่ทำงานแล้ว ซึ่งแย่กว่าตอนกดซ้ำ
function guard(socket: Socket, eventName: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    console.error(`Socket command ${eventName} failed:`, error);
    socket.emit('controlError', { message: `${eventName} failed: ${(error as Error).message}` });
  }
}

export function controlEvent(
  socket: Socket,
  eventName: string,
  handler: (payload: Payload) => void
): void {
  socket.on(eventName, (payload: unknown) => {
    if (!isAuthorizedSocket(socket)) {
      socket.emit('controlError', { message: 'Unauthorized control request' });
      return;
    }
    guard(socket, eventName, () => handler((payload || {}) as Payload));
  });
}

// คำสั่งที่ส่งค่าเดี่ยวๆ มา ไม่ใช่ object (updatePhase, updateTimer, updateOverlaySize)
function rawEvent(socket: Socket, eventName: string, handler: (payload: unknown) => void): void {
  socket.on(eventName, (payload: unknown) => {
    if (!isAuthorizedSocket(socket)) {
      socket.emit('controlError', { message: 'Unauthorized control request' });
      return;
    }
    guard(socket, eventName, () => handler(payload ?? {}));
  });
}

export function registerHandlers(socket: Socket): void {
  console.log('Client connected:', socket.id);
  socket.emit('stateUpdate', getState());

  controlEvent(socket, 'updateTeamName', ({ team, name }) => {
    if (!isTeamKey(team)) return;
    const state = getState();
    state[team].name = sanitizeText(name, 24) || state[team].name;
    emitState();
  });

  // ช่องคะแนนบนหน้า control เป็นตัวตั้งของคะแนนซีรีส์
  //
  // เดิมเขียนลง state ของ overlay อย่างเดียว สายยังเป็นคะแนนเก่า
  // ผู้ชนะรายเกมไม่ถูกบันทึก และ nextGameNo (ซึ่งอ่านจากตารางแข่ง) ไม่ขยับ
  // เกมถัดไปจึงได้เลขเดิม แล้วดราฟต์ใหม่เขียนทับดราฟต์เกมก่อนหน้า
  //
  // ตอนนี้เขียนต่อลงตารางแข่ง แล้วเดาผู้ชนะด้วยกติกาเดียวกับการกรอกในสาย
  // ไม่ได้ผูกกับแมตช์ของทัวร์นาเมนต์อยู่ (แมตช์เดี่ยว) ก็ไม่มีอะไรเกิดขึ้น
  controlEvent(socket, 'updateScore', ({ team, score }) => {
    if (!isTeamKey(team)) return;
    getState()[team].score = clampNumber(score, 0, 99);
    emitState();
    pushOverlayScoreToMatch();
  });

  controlEvent(socket, 'updatePlayerName', ({ team, index, name }) => {
    if (!isTeamKey(team) || !isPickIndex(index)) return;
    getState()[team].players[index] = sanitizeText(name, 24) || `Player ${index + 1}`;
    emitState();
  });

  controlEvent(socket, 'updatePick', ({ team, index, hero }) => {
    if (!isTeamKey(team) || !isPickIndex(index)) return;
    const state = getState();
    const next = sanitizeHero(hero);
    if (isHeroTaken(state, next, { team, type: 'picks', index })) {
      socket.emit('controlError', { message: `${next} is already used in this draft` });
      socket.emit('stateUpdate', state);
      return;
    }
    pushUndo();
    state[team].picks[index] = next;
    emitState();
    checkAndAdvancePhase();
  });

  controlEvent(socket, 'updateBan', ({ team, index, hero }) => {
    if (!isTeamKey(team) || !isBanIndex(index)) return;
    const state = getState();
    const next = sanitizeHero(hero);
    if (isHeroTaken(state, next, { team, type: 'bans', index })) {
      socket.emit('controlError', { message: `${next} is already used in this draft` });
      socket.emit('stateUpdate', state);
      return;
    }
    pushUndo();
    state[team].bans[index] = next;
    emitState();
    checkAndAdvancePhase();
  });

  controlEvent(socket, 'clearPick', ({ team, index }) => {
    if (!isTeamKey(team) || !isPickIndex(index)) return;
    pushUndo();
    getState()[team].picks[index] = null;
    emitState();
  });

  controlEvent(socket, 'clearBan', ({ team, index }) => {
    if (!isTeamKey(team) || !isBanIndex(index)) return;
    pushUndo();
    getState()[team].bans[index] = null;
    emitState();
  });

  controlEvent(socket, 'clearAll', () => {
    pushUndo();
    const state = getState();
    state.teamBlue.picks = Array.from({ length: PICK_COUNT }, () => null);
    state.teamBlue.bans = Array.from({ length: BAN_COUNT }, () => null);
    state.teamRed.picks = Array.from({ length: PICK_COUNT }, () => null);
    state.teamRed.bans = Array.from({ length: BAN_COUNT }, () => null);
    emitState();
  });

  // เดินรอบ (เกมที่เท่าไหร่ของซีรีส์)
  //
  // ส่ง delta มา ไม่ใช่เลขรอบปลายทาง เพราะปุ่มบนหน้า control อาจถูกกดพร้อมกัน
  // จากสองหน้าต่าง การส่งเลขปลายทางที่คำนวณจากค่าที่หน้านั้นเห็นล่าสุด
  // จะทำให้การกดครั้งหลังพารอบย้อนกลับไปที่เดิม ส่วน delta บวกกันได้ตามลำดับที่มาถึง
  //
  // ปฏิเสธแล้วต้องบอก กดปุ่มแล้วไม่มีอะไรเกิดขึ้นโดยไม่มีคำอธิบาย
  // แยกไม่ออกจากปุ่มที่เสีย ซึ่งกลางรายการคือเรื่องใหญ่กว่าที่ควรจะเป็น
  //
  // อย่าใช้ clampNumber กับ delta: ค่าที่อ่านไม่ออกจะกลายเป็น min ซึ่งคือ -1
  // payload ที่ส่งมาไม่ครบจึงจะพารอบถอยหลังไปหนึ่งรอบเงียบๆ แทนที่จะไม่ทำอะไร
  // (กฎเดียวกับที่ CLAUDE.md เขียนไว้เรื่อง Number(null) กับพารามิเตอร์ใน URL)
  controlEvent(socket, 'stepRound', ({ delta }) => {
    const n = Number(delta);
    if (!Number.isFinite(n) || n === 0) return;
    const step = n > 0 ? 1 : -1;
    const result = stepRound(step);
    if (result.error !== undefined) socket.emit('controlError', { message: result.error });
  });

  controlEvent(socket, 'undo', () => {
    if (!popUndo()) {
      socket.emit('controlError', { message: 'Nothing to undo' });
      return;
    }
    emitState();
  });

  rawEvent(socket, 'updatePhase', (phase) => {
    getState().currentPhase = phase === 'PICK' ? 'PICK' : 'BAN';
    emitState();
  });

  rawEvent(socket, 'updateTimer', (timer) => {
    const state = getState();
    state.timer = sanitizeTimer(timer);
    setDraftSeconds(parseTimeToSeconds(state.timer));
    emitState();
  });

  controlEvent(socket, 'updateSkinOptions', (data) => {
    const state = getState();
    if (typeof data.enabled === 'boolean') state.skin.enabled = data.enabled;
    if (typeof data.showPanels === 'boolean') state.skin.showPanels = data.showPanels;
    emitState();
  });

  // เลือกขนาดครั้งเดียว ทุกหน้าที่เปิดอยู่จะสลับตามทันที
  rawEvent(socket, 'updateOverlaySize', (data) => {
    const size = typeof data === 'string' ? data : (data as Payload)?.size;
    getState().overlaySize = sanitizeOverlaySize(size);
    emitState();
  });

  // patch ทีละคีย์ หน้า design ส่งมาเฉพาะตัวที่เพิ่งลาก
  // ค่าที่ไม่รู้จักถูก sanitizeTheme ตัดทิ้งเอง
  rawEvent(socket, 'updateTheme', (data) => {
    if (!data || typeof data !== 'object') return;
    const state = getState();
    state.theme = sanitizeTheme({ ...state.theme, ...(data as Payload) });
    emitState();
  });

  rawEvent(socket, 'updateHotkeys', (data) => {
    if (!data || typeof data !== 'object') return;
    const state = getState();
    state.hotkeys = sanitizeHotkeys({ ...state.hotkeys, ...(data as Payload) });
    emitState();
  });

  // ระดับเสียงต่อเหตุการณ์ ส่งมาเป็นก้อนบางส่วนได้ เช่น { pick: 0.4 }
  // overlay ที่เปิดค้างอยู่ใน OBS จะได้ค่าใหม่ผ่าน stateUpdate ทันที ไม่ต้อง Refresh
  rawEvent(socket, 'updateSfx', (data) => {
    if (!data || typeof data !== 'object') return;
    const state = getState();
    state.sfx = sanitizeSfx({ ...state.sfx, ...(data as Payload) });
    emitState();
  });

  // คีย์ลัดระดับระบบ ส่งมาเป็นก้อนบางส่วนได้ เช่น { enabled: true }
  //
  // เก็บใน state เหมือนค่าตั้งค่าอื่น แต่คนที่เอาไปใช้คือ process หลักของ Electron
  // ไม่ใช่ overlay ดู electron-main.js ว่ามันอ่านค่านี้มาจากไหน
  rawEvent(socket, 'updateGlobalHotkeys', (data) => {
    if (!data || typeof data !== 'object') return;
    const state = getState();
    const patch = data as Payload;
    state.globalHotkeys = sanitizeGlobalHotkeys({
      ...state.globalHotkeys,
      ...patch,
      bindings: { ...state.globalHotkeys.bindings, ...(patch.bindings as Payload || {}) }
    });
    emitState();
  });

  // คืนปุ่มกลับเป็นค่าเริ่มต้น แต่ไม่แตะสวิตช์เปิด/ปิด
  //
  // สวิตช์มีปุ่มของตัวเองอยู่ข้างๆ อยู่แล้ว การรีเซ็ตปุ่มแล้วพาลปิดฟีเจอร์ไปด้วย
  // แปลว่าคีย์ลัดระดับระบบดับทั้งชุดกลางรายการ โดยที่คนกดไม่ได้ขอ
  // และอาการที่เห็นคือ "กดคีย์แล้วไม่มีอะไรเกิดขึ้น" ซึ่งอ่านเหมือนของเสีย
  // ไม่ใช่เหมือนสวิตช์ถูกปิด — เป็นอาการเดียวกับที่ /hotkeys อุตส่าห์ทำไฟแดง
  // บอกความขัดแย้งของปุ่มเอาไว้เพื่อไม่ให้เกิด
  controlEvent(socket, 'resetGlobalHotkeys', () => {
    const state = getState();
    state.globalHotkeys = {
      ...deepClone(GLOBAL_HOTKEY_DEFAULTS),
      enabled: state.globalHotkeys.enabled
    };
    emitState();
  });

  controlEvent(socket, 'resetHotkeys', () => {
    getState().hotkeys = deepClone(HOTKEY_DEFAULTS);
    emitState();
  });

  controlEvent(socket, 'resetTheme', () => {
    getState().theme = { ...THEME_DEFAULTS };
    emitState();
  });

  // ส่ง visible มาเป็น true/false ก็ตั้งค่าตามนั้น ไม่ส่งมาคือสลับ
  // ปุ่มบนหน้า control ส่งค่ามาตรงๆ ส่วนคีย์ลัดปล่อยให้ฝั่งนี้สลับให้
  // เพราะถ้าเปิด control ไว้หลายเครื่อง ต่างเครื่องอาจเห็นสถานะไม่ตรงกัน
  controlEvent(socket, 'setOverlayVisible', (data) => {
    const state = getState();
    state.overlayVisible = typeof data.visible === 'boolean'
      ? data.visible
      : !state.overlayVisible;
    emitState();
  });

  controlEvent(socket, 'updateMatchInfo', (data) => {
    const state = getState();
    state.matchInfo = {
      title: sanitizeText(data.title, 80) || state.matchInfo.title,
      tournament: sanitizeText(data.tournament, 50) || state.matchInfo.tournament
    };
    emitState();
  });

  controlEvent(socket, 'switchTeams', () => {
    pushUndo();
    const state = getState();
    const tempTeam = deepClone(state.teamBlue);
    state.teamBlue = deepClone(state.teamRed);
    state.teamRed = tempTeam;
    emitState();
  });

  controlEvent(socket, 'draftStart', () => startDraftPhase(0));
  controlEvent(socket, 'draftNext', () => startDraftPhase(getState().draftPhaseIndex + 1));
  controlEvent(socket, 'draftPrev', () => startDraftPhase(Math.max(0, getState().draftPhaseIndex - 1)));

  controlEvent(socket, 'draftPause', () => {
    stopDraftTimer();
    emitState();
  });

  controlEvent(socket, 'draftResume', () => resumeDraft());

  controlEvent(socket, 'draftReset', () => resetDraft());

  controlEvent(socket, 'swapPicks', ({ team, index1, index2 }) => {
    if (!isTeamKey(team) || !isPickIndex(index1) || !isPickIndex(index2)) return;
    pushUndo();
    const picks = getState()[team].picks;
    [picks[index1], picks[index2]] = [picks[index2]!, picks[index1]!];
    emitState();
  });

  // ห้องของหน้าฝั่งคนคุมงาน เข้าเองได้โดยไม่ต้องมีโทเคน
  //
  // ไม่ผ่าน controlEvent ตั้งใจ: การเข้าห้องไม่ได้แก้ state อะไรเลย
  // และข้อมูลที่ห้องนี้พูดถึงก็เปิดอ่านได้อยู่แล้วทาง GET ปกติ
  // สิ่งที่ส่งเข้าห้องคือสัญญาณเปล่าๆ ว่า "หัวข้อนี้เปลี่ยนแล้ว ไปดึงมาใหม่"
  // ไม่มีข้อมูลติดไปด้วย (ดู services/sync.ts)
  socket.on('data:join', () => socket.join(DATA_ROOM));
  socket.on('data:leave', () => socket.leave(DATA_ROOM));

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
}
