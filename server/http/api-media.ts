// API อัปโหลดภาพ: ภาพพื้นหลังที่ออกแบบเอง (skin) และโลโก้ทีม
//
// รับ body เป็นไฟล์ดิบ ไม่ใช้ multipart จะได้ไม่ต้องเพิ่ม dependency
// ตรวจสามชั้น: ชื่อ slot ต้องอยู่ในตารางที่กำหนด, content-type ต้องเป็นภาพ
// ที่รองรับ และ magic bytes ต้องตรงกับชนิดที่บอกมาจริงๆ

import fs from 'fs';
import express, { Router } from 'express';
import {
  SKIN_DIR,
  LOGO_DIR,
  SKIN_MAX_BYTES,
  LOGO_MAX_BYTES,
  isSkinSlot,
  isLogoSlot,
  LOGO_SLOTS,
  skinFilePath,
  logoFilePath,
  removeSkinFiles,
  removeLogoFiles
} from '../domain/media';
import { getState, emitState } from '../store/live-state';
import { requireControl } from './auth';
import { validateUpload, rawImage } from './upload';

export function mediaRoutes(): Router {
  const router = express.Router();

  router.post('/api/skin/:slot', requireControl, rawImage(SKIN_MAX_BYTES), (req, res) => {
    const slot = req.params.slot;
    if (!isSkinSlot(slot)) {
      res.status(400).json({ error: 'Unknown skin slot' });
      return;
    }

    const checked = validateUpload(req);
    if (checked.error !== undefined) {
      res.status(checked.status).json({ error: checked.error });
      return;
    }

    try {
      fs.mkdirSync(SKIN_DIR, { recursive: true });
      removeSkinFiles(slot); // กันกรณีเปลี่ยนนามสกุล จะได้ไม่เหลือไฟล์เก่าค้าง
      fs.writeFileSync(skinFilePath(slot, checked.ext), checked.body);
    } catch (error) {
      res.status(500).json({ error: `Could not save image: ${(error as Error).message}` });
      return;
    }

    const state = getState();
    state.skin.slots[slot] = Date.now();
    state.skin.enabled = true;
    emitState();
    res.json({ ok: true, slot, ext: checked.ext, bytes: checked.body.length, skin: state.skin });
  });

  router.delete('/api/skin/:slot', requireControl, (req, res) => {
    const slot = req.params.slot;
    if (!isSkinSlot(slot)) {
      res.status(400).json({ error: 'Unknown skin slot' });
      return;
    }
    removeSkinFiles(slot);
    const state = getState();
    state.skin.slots[slot] = 0;
    emitState();
    res.json({ ok: true, skin: state.skin });
  });

  // ตรวจแบบเดียวกับ skin: ชื่อทีมต้องอยู่ในตาราง, content-type ต้องรองรับ
  // และ magic bytes ต้องตรงกับชนิดที่บอกมาจริงๆ
  router.post('/api/team-logo/:team', requireControl, rawImage(LOGO_MAX_BYTES), (req, res) => {
    const team = req.params.team;
    if (!isLogoSlot(team)) {
      res.status(400).json({ error: 'Unknown team' });
      return;
    }

    const checked = validateUpload(req);
    if (checked.error !== undefined) {
      res.status(checked.status).json({ error: checked.error });
      return;
    }

    try {
      fs.mkdirSync(LOGO_DIR, { recursive: true });
      removeLogoFiles(team); // กันไฟล์นามสกุลเดิมค้างอยู่ตอนเปลี่ยนชนิดภาพ
      fs.writeFileSync(logoFilePath(team, checked.ext), checked.body);
    } catch (error) {
      res.status(500).json({ error: `Could not save logo: ${(error as Error).message}` });
      return;
    }

    const state = getState();
    // บอกไปด้วยว่าภาพอยู่ไฟล์ไหน ไม่ปล่อยให้หน้าเว็บเดาจากฝั่ง
    // สลับฝั่งเมื่อไหร่ ค่านี้จะตามทีมไป ภาพจึงสลับตามจริง
    state[team].logo = { v: Date.now(), ext: checked.ext, src: LOGO_SLOTS[team] };
    emitState();
    res.json({
      ok: true, team, ext: checked.ext, bytes: checked.body.length, logo: state[team].logo
    });
  });

  router.delete('/api/team-logo/:team', requireControl, (req, res) => {
    const team = req.params.team;
    if (!isLogoSlot(team)) {
      res.status(400).json({ error: 'Unknown team' });
      return;
    }
    removeLogoFiles(team);
    const state = getState();
    state[team].logo = { v: 0, ext: '' };
    emitState();
    res.json({ ok: true, team, logo: state[team].logo });
  });

  return router;
}
