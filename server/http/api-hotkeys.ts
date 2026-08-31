// ทางที่ process หลักของ Electron คุยกับเซิร์ฟเวอร์เรื่องคีย์ลัดระดับระบบ
//
// สองเส้นทางเท่านั้น: ถามว่าตอนนี้ตั้งอะไรไว้ กับบอกว่ามีคนกดคีย์ลัดตัวไหน
//
// ทำไมเป็น HTTP ไม่ใช่ socket: ตัวจองคีย์ลัดคือ process หลักของ Electron
// ซึ่งไม่ได้เปิดหน้าเว็บและไม่มี socket.io-client อยู่ในนั้น
// และแอพยังรองรับกรณีที่เซิร์ฟเวอร์ถูกสตาร์ทไว้ก่อนแล้วจากที่อื่น (ดู startServerIfNeeded)
// ซึ่งแปลว่า require เอาตรงๆ ก็ไม่ได้เหมือนกัน HTTP เป็นทางเดียวที่ใช้ได้ทั้งสองแบบ

import { Router } from 'express';
import { requireControl } from './auth';
import { getState } from '../store/live-state';
import { toAccelerator } from '../domain/settings';
import type { GlobalHotkeyAction } from '../domain/settings';
import {
  isGlobalHotkeyAction,
  runGlobalHotkey,
  setHeldAccelerators,
  getHeldAccelerators
} from '../services/global-hotkeys';

export function hotkeyRoutes(): Router {
  const router = Router();

  // ไม่ต้องมีโทเคน อ่านอย่างเดียวและไม่ได้บอกอะไรที่เป็นความลับ
  // ส่ง accelerator ที่แปลงแล้วไปด้วย ตัวแปลงอยู่ใน domain/settings.ts ที่เดียว
  // ฝั่ง Electron จะได้ไม่ต้องมีตารางปุ่มเป็นของตัวเองให้เพี้ยนจากกันทีหลัง
  router.get('/api/global-hotkeys', (_req, res) => {
    const { enabled, bindings } = getState().globalHotkeys;
    const accelerators: Record<string, string> = {};
    (Object.entries(bindings) as [GlobalHotkeyAction, typeof bindings[GlobalHotkeyAction]][])
      .forEach(([action, binding]) => {
        const accelerator = toAccelerator(binding);
        if (accelerator) accelerators[action] = accelerator;
      });
    res.json({ enabled, accelerators, held: getHeldAccelerators() });
  });

  // ตัวจองรายงานกลับมาว่าจองติดจริงกี่ปุ่ม
  //
  // หน้าตั้งค่าเดาเองไม่ได้ ปุ่มจะจองติดหรือไม่ขึ้นกับว่าโปรแกรมอื่นในเครื่องจองไว้ก่อนหรือเปล่า
  // ถ้าไม่มีทางนี้ หน้าจะโชว์ว่าจองครบทุกปุ่ม แล้วคนกดจะเจอ "กดแล้วไม่มีอะไรเกิดขึ้น"
  router.post('/api/global-hotkeys/registered', requireControl, (req, res) => {
    const body = (req.body || {}) as { held?: unknown };
    setHeldAccelerators(body.held);
    res.json({ ok: true });
  });

  router.post('/api/global-hotkeys/fire', requireControl, (req, res) => {
    const body = (req.body || {}) as { action?: unknown };
    if (!isGlobalHotkeyAction(body.action)) {
      res.status(400).json({ error: 'Unknown hotkey action' });
      return;
    }

    // ปิดอยู่แล้วต้องไม่ทำงาน แม้จะมีคนยิงเข้ามาตรงๆ
    // ตัวจองฝั่ง Electron ปลดคีย์ทิ้งตอนปิดอยู่แล้ว ตรงนี้เป็นด่านที่สอง
    if (!getState().globalHotkeys.enabled) {
      res.status(409).json({ error: 'Global hotkeys are switched off' });
      return;
    }

    res.json({ ok: true, changed: runGlobalHotkey(body.action) });
  });

  return router;
}
