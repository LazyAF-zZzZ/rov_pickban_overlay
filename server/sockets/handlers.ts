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
  sanitizeHotkeys
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

type Payload = Record<string, unknown>;

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
    handler((payload || {}) as Payload);
  });
}

// คำสั่งที่ส่งค่าเดี่ยวๆ มา ไม่ใช่ object (updatePhase, updateTimer, updateOverlaySize)
function rawEvent(socket: Socket, eventName: string, handler: (payload: unknown) => void): void {
  socket.on(eventName, (payload: unknown) => {
    if (!isAuthorizedSocket(socket)) {
      socket.emit('controlError', { message: 'Unauthorized control request' });
      return;
    }
    handler(payload ?? {});
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

  controlEvent(socket, 'updateScore', ({ team, score }) => {
    if (!isTeamKey(team)) return;
    getState()[team].score = clampNumber(score, 0, 99);
    emitState();
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
