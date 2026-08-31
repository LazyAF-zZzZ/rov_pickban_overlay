// สิ่งที่คีย์ลัดระดับระบบสั่งได้ และการลงมือทำจริง
//
// ตัวสั่งคือ process หลักของ Electron ซึ่งไม่ได้เปิดหน้าเว็บไว้ จึงส่ง socket ไม่ได้
// มันยิง POST /api/global-hotkeys/fire เข้ามาแทน แล้วมาลงเอยที่ไฟล์นี้
//
// ตัวงานจริงคือฟังก์ชันชุดเดียวกับที่ sockets/handlers.ts เรียก
// (startDraftPhase / stopDraftTimer / resumeDraft / popUndo)
// ไฟล์นี้เป็นแค่ตัวแปลง "ชื่อคีย์ลัด" เป็น "การเรียกฟังก์ชัน" ไม่มีกติกาของตัวเอง
// ถ้าวันหนึ่งกติกาย้ายมาอยู่ที่นี่ ทางหน้า Control กับทางคีย์ลัดระบบจะเริ่มไม่ตรงกัน

import { GLOBAL_HOTKEY_ACTIONS } from '../domain/settings';
import type { GlobalHotkeyAction } from '../domain/settings';
import { getState, emitState, popUndo } from '../store/live-state';
import { startDraftPhase, stopDraftTimer, resumeDraft } from './draft-engine';

// ปุ่มที่ process หลักของ Electron จองได้จริงบนเครื่องนี้
//
// ไม่ได้เก็บลง state และไม่ได้เขียนลงไฟล์ ตั้งใจ: มันไม่ใช่การตั้งค่า
// แต่เป็นข้อเท็จจริงของเครื่องเครื่องนี้ในรอบการทำงานนี้ ปิดแอพแล้วก็ไม่จริงอีกต่อไป
//
// ที่ต้องมีเพราะ globalShortcut.register() คืน false เงียบๆ เมื่อโปรแกรมอื่นจองปุ่มไว้ก่อน
// ถ้าไม่รายงานกลับมา หน้าตั้งค่าจะโชว์ว่าจองแล้วทั้งห้าปุ่ม แล้วคนกดจะเจอ
// อาการ "กดแล้วไม่มีอะไรเกิดขึ้น" ซึ่งแยกไม่ออกจากของเสีย
let heldAccelerators: string[] = [];
let heldReported = false;

export function setHeldAccelerators(list: unknown): void {
  heldAccelerators = Array.isArray(list)
    ? list.filter((item): item is string => typeof item === 'string')
    : [];
  heldReported = true;
}

// null = ยังไม่มีใครรายงานมา (เปิดในเบราว์เซอร์ หรือแอพเพิ่งเริ่ม)
// ต่างจาก [] ซึ่งแปลว่ารายงานแล้วว่าจองไม่ได้สักปุ่ม
export function getHeldAccelerators(): string[] | null {
  return heldReported ? heldAccelerators : null;
}

export function isGlobalHotkeyAction(value: unknown): value is GlobalHotkeyAction {
  return typeof value === 'string'
    && (GLOBAL_HOTKEY_ACTIONS as readonly string[]).includes(value);
}

// คืน false = ทำแล้วไม่มีอะไรเปลี่ยน (ตอนนี้มีแค่ undo ที่ไม่มีอะไรให้ถอย)
// ไม่ใช่ข้อผิดพลาด คนกดอยู่ที่ OBS ไม่ได้มองหน้าจอนี้อยู่แล้ว
export function runGlobalHotkey(action: GlobalHotkeyAction): boolean {
  const state = getState();

  switch (action) {
    case 'toggleBanner':
      // สลับเอง ไม่รับค่ามาจากผู้เรียก เหตุผลเดียวกับ setOverlayVisible ใน handlers.ts
      state.overlayVisible = !state.overlayVisible;
      emitState();
      return true;

    case 'pauseResume':
      if (state.draftRunning) {
        stopDraftTimer();
        emitState();
      } else {
        resumeDraft();
      }
      return true;

    case 'prevPhase':
      startDraftPhase(Math.max(0, state.draftPhaseIndex - 1));
      return true;

    case 'nextPhase':
      startDraftPhase(state.draftPhaseIndex + 1);
      return true;

    case 'undo':
      if (!popUndo()) return false;
      emitState();
      return true;

    default:
      return false;
  }
}
