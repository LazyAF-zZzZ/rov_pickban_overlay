// state ของแมตช์ที่กำลังออกอากาศ มีก้อนเดียวทั้งแอพ
//
// เข้าถึงผ่าน getState()/setState() เท่านั้น ห้าม export ตัวแปรออกไปตรงๆ
// เพราะ setState เป็นการ "แทนที่ทั้งก้อน" (โหลดพรีเซ็ต / RESET MATCH)
// โมดูลที่เก็บ reference ไว้ตั้งแต่ตอน import จะชี้ไปที่ก้อนเก่าทันที
// อาการคือหน้าเว็บอัปเดต แต่ค่าที่เซฟลงไฟล์เป็นของเก่า หาสาเหตุยากมาก
//
// ตอนทำโหมดทัวร์นาเมนต์: ตัวนี้ยังคงเป็น "แมตช์ที่ออกอากาศอยู่" เหมือนเดิม
// การกดเลือกแมตช์จากตารางแข่ง = setState(แมตช์นั้น) + จำว่ามาจากแมตช์ไหน
// ไม่ใช่การสร้าง state ก้อนที่สอง

import type { Server } from 'socket.io';
import { STATE_PATH } from '../config';
import { loadJson, writeJson, deepClone } from '../lib/json';
import type { GameState, TeamState } from '../domain/match';
import { defaultState, sanitizeState } from '../domain/match';

interface UndoEntry {
  teamBlue: TeamState;
  teamRed: TeamState;
}

// ไฟล์ยังไม่มีตอนเปิดแอพครั้งแรกเป็นเรื่องปกติ ไม่ต้องเตือน
let gameState: GameState = sanitizeState(loadJson(STATE_PATH, defaultState, { quiet: true }));

let io: Server | null = null;
let saveTimer: NodeJS.Timeout | null = null;

export function attachIo(instance: Server): void {
  io = instance;
}

// ส่งเฉพาะห้อง ไม่ใช่ทุกคนที่ต่ออยู่
//
// หน้า overlay กับ control ไม่ได้สนใจสถิติเลย การยิงหาให้ทุกคนคือการบังคับ
// ให้ทุกหน้าที่เปิดอยู่ต้องรับข้อความที่มันทิ้งทันที
// หน้าไหนต้องการก็เข้าห้องมาเอง (ดู sockets/handlers.ts)
export function emitToRoom(room: string, event: string, payload: unknown = {}): void {
  if (io) io.to(room).emit(event, payload);
}

export function getState(): GameState {
  return gameState;
}

export function setState(next: GameState): GameState {
  gameState = next;
  return gameState;
}

export function saveStateSoon(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      writeJson(STATE_PATH, gameState);
    } catch (error) {
      console.warn(`Could not save state: ${(error as Error).message}`);
    }
  }, 150);
}

// ผู้ฟังการเปลี่ยนแปลงของ state
//
// มีไว้ให้ตัวบันทึกดราฟต์เกาะ โดยที่ไฟล์นี้ไม่ต้องรู้จักฐานข้อมูลทัวร์นาเมนต์
// ถ้าเรียก store ของทัวร์นาเมนต์ตรงๆ จากตรงนี้ ชั้นล่างจะกลายเป็นรู้จักชั้นบน
// แล้วเทสต์ที่แตะแค่ state ก็จะลากฐานข้อมูลติดมาด้วยทั้งก้อน
type StateListener = (state: GameState) => void;
const listeners: StateListener[] = [];

export function subscribe(listener: StateListener): void {
  listeners.push(listener);
}

export function emitState(): void {
  if (io) io.emit('stateUpdate', gameState);
  saveStateSoon();
  // ผู้ฟังพังไม่ควรทำให้การออกอากาศพังตาม
  listeners.forEach((listener) => {
    try {
      listener(gameState);
    } catch (error) {
      console.warn(`State listener failed: ${(error as Error).message}`);
    }
  });
}

// Undo only covers the teams, never the clock. Rewinding the timer mid-draft
// would be worse than the mistake being undone.
export const UNDO_LIMIT = 40;
const undoStack: UndoEntry[] = [];

export function pushUndo(): void {
  undoStack.push({
    teamBlue: deepClone(gameState.teamBlue),
    teamRed: deepClone(gameState.teamRed)
  });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
}

export function popUndo(): boolean {
  const previous = undoStack.pop();
  if (!previous) return false;
  gameState.teamBlue = previous.teamBlue;
  gameState.teamRed = previous.teamRed;
  return true;
}
