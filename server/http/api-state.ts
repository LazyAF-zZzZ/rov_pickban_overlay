// API ของ state และข้อมูลอ้างอิงที่หน้าเว็บต้องใช้ตอนเปิด

import express, { Router } from 'express';
import { heroesData } from '../domain/heroes';
import { DRAFT_SEQUENCE } from '../domain/draft';
import { defaultState, sanitizeState } from '../domain/match';
import { carryOverSettings } from '../domain/settings';
import { getState, setState, emitState } from '../store/live-state';
import { stopDraftTimer, syncSecondsFromState } from '../services/draft-engine';
import { requireControl } from './auth';
import { releaseLiveMatch } from '../services/live-match';

export function stateRoutes(): Router {
  const router = express.Router();

  router.get('/api/heroes', (_req, res) => {
    res.json(heroesData);
  });

  router.get('/api/state', (_req, res) => {
    res.json(getState());
  });

  router.get('/api/draft-sequence', (_req, res) => {
    res.json({ sequence: DRAFT_SEQUENCE });
  });

  router.post('/api/reset-state', requireControl, (_req, res) => {
    stopDraftTimer();
    const previous = getState(); // RESET MATCH ล้างแมตช์ ไม่ใช่ล้างการตั้งค่า
    setState(carryOverSettings(sanitizeState(defaultState), previous));
    syncSecondsFromState();

    // เลิกผูกกับคู่ที่ออกอากาศอยู่ ก่อนจะ emit
    //
    // กระดานเปล่าไม่ใช่แมตช์ไหนอีกต่อไป ปล่อยตัวชี้ค้างไว้แล้วแถบ ON AIR
    // จะยังบอกว่ากำลังบันทึกดราฟต์ลงคู่นั้นอยู่ ทั้งที่ไม่ได้บันทึกแล้ว
    // (ตัวบันทึกปฏิเสธเอง ดู captureDraft) กดเปิดคู่นั้นใหม่จากหน้าสายการแข่ง
    // จะได้ดราฟต์เดิมกลับมาครบ เพราะมันถูกเก็บไว้ที่เกม ไม่ได้อยู่บนจอ
    releaseLiveMatch();
    emitState();
    res.json({ ok: true, state: getState() });
  });

  return router;
}
