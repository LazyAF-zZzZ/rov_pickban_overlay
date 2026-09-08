// นาฬิกาดราฟต์ และการเดินไปเฟสถัดไป
//
// แยกจาก domain/draft.ts ตรงที่ไฟล์นี้ "มีผลข้างเคียง" ตั้ง interval จริง
// และแก้ state จริง ส่วนตัวลำดับกับตัวแปลงเวลาเป็นฟังก์ชันบริสุทธิ์อยู่ที่โน่น

import { clampNumber } from '../lib/sanitize';
import {
  DRAFT_SEQUENCE,
  parseSlotId,
  parseTimeToSeconds,
  formatSeconds
} from '../domain/draft';
import { getState, emitState } from '../store/live-state';

let draftInterval: NodeJS.Timeout | null = null;
let draftSeconds = parseTimeToSeconds(getState().timer);

export function getDraftSeconds(): number {
  return draftSeconds;
}

export function setDraftSeconds(value: number): void {
  draftSeconds = value;
}

// เรียกหลังเปลี่ยน state.timer จากทางอื่น เพื่อให้นาฬิกาตรงกับที่แสดง
export function syncSecondsFromState(): void {
  draftSeconds = parseTimeToSeconds(getState().timer);
}

export function stopDraftTimer(): void {
  if (draftInterval) {
    clearInterval(draftInterval);
    draftInterval = null;
  }
  getState().draftRunning = false;
}

function runDraftInterval(): void {
  if (draftInterval) clearInterval(draftInterval);
  draftInterval = setInterval(() => {
    draftSeconds -= 1;
    getState().timer = formatSeconds(draftSeconds);
    emitState();
    if (draftSeconds <= 0) {
      startDraftPhase(getState().draftPhaseIndex + 1);
    }
  }, 1000);
}

export function startDraftPhase(index: number): void {
  stopDraftTimer();
  const state = getState();
  const safeIndex = clampNumber(index, 0, DRAFT_SEQUENCE.length);
  if (safeIndex >= DRAFT_SEQUENCE.length) {
    state.draftPhaseIndex = safeIndex;
    state.draftLabel = 'coming soon';
    state.draftActiveSlots = [];
    state.timer = '';
    state.draftRunning = false;
    emitState();
    return;
  }

  const phase = DRAFT_SEQUENCE[safeIndex]!;
  state.draftPhaseIndex = safeIndex;
  state.draftLabel = phase.label;
  state.draftActiveSlots = phase.slots || [];
  draftSeconds = phase.seconds;
  state.timer = formatSeconds(draftSeconds);
  state.draftRunning = true;
  emitState();
  runDraftInterval();
}

export function checkAndAdvancePhase(): void {
  const state = getState();
  const slots = state.draftActiveSlots;
  if (!slots || slots.length === 0) return;
  const allFilled = slots.every((slotId) => {
    const parsed = parseSlotId(slotId);
    if (!parsed) return false;
    return Boolean(state[parsed.team][parsed.type][parsed.index]);
  });
  if (allFilled) startDraftPhase(state.draftPhaseIndex + 1);
}

export function resetDraft(): void {
  stopDraftTimer();
  const state = getState();
  state.draftPhaseIndex = -1;
  state.draftLabel = '';
  state.draftActiveSlots = [];
  state.draftRunning = false;
  state.timer = '00:00';
  draftSeconds = 0;
  emitState();
}

export function resumeDraft(): void {
  const state = getState();
  // ดราฟต์จบไปแล้ว (draftPhaseIndex ชี้เลยท้ายลำดับ = 'coming soon') ไม่มีอะไรให้เดินต่อ
  //
  // ไม่กันไว้ตรงนี้ การกด Resume หรือคีย์ลัดหยุด/เดินต่อ จะไปตั้งนาฬิกา 60 วินาที
  // ให้กับเฟสที่ไม่มีอยู่จริง มองไม่เห็นบนจอ (ทั้ง overlay และหน้า control ซ่อนเวลาไว้
  // ตอน 'coming soon') แต่ยิง emitState ทุกวินาที = เขียน state.json และมิเรอร์
  // ดราฟต์ลงฐานซ้ำวินาทีละครั้งอยู่นาทีหนึ่งโดยไม่มีใครรู้
  if (state.draftPhaseIndex >= DRAFT_SEQUENCE.length) return;

  if (!state.draftRunning && state.draftPhaseIndex >= 0) {
    draftSeconds = draftSeconds > 0
      ? draftSeconds
      : DRAFT_SEQUENCE[state.draftPhaseIndex]?.seconds || 60;
    state.timer = formatSeconds(draftSeconds);
    state.draftRunning = true;
    emitState();
    runDraftInterval();
  }
}
