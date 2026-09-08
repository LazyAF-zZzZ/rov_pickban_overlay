// สำรองข้อมูลและกู้คืน
//
// สามเส้นทาง: ดาวน์โหลดไฟล์สำรอง, ดูว่าไฟล์ที่จะนำเข้ามีอะไร, และกู้คืนจริง
//
// ขั้นตอน "ดู" แยกจาก "กู้คืน" ตั้งใจ ไฟล์สำรองมาจากไหนก็ได้ และการกู้คืน
// แตะข้อมูลทั้งเครื่อง คนกดต้องเห็นก่อนว่ากำลังจะรับอะไรเข้ามา ไม่ใช่รู้ทีหลัง
//
// ตัวแยกวิเคราะห์ JSON ของเส้นทางนี้แยกจากตัวกลางของแอพ
// ตัวกลางจำกัดไว้ที่ 64kb ซึ่งพอดีกับทุก API ที่มีอยู่ แต่เล็กเกินไปมากสำหรับ
// ไฟล์ที่มีรูปฝังอยู่ เราเตอร์นี้จึงต้องถูก mount ก่อนตัวกลาง (ดู server/index.ts)

import fs from 'fs';
import path from 'path';
import express, { Router } from 'express';
import { ROOT_DIR } from '../config';
import { readBackup, summarise, MAX_FILE_BYTES } from '../domain/backup';
import type { RestoreMode } from '../store/backup';
import { getStores } from '../store/index';
import { requireControl } from './auth';
import { notifyData } from '../services/sync';
import { getState, setState, emitState } from '../store/live-state';
import { defaultState, sanitizeState } from '../domain/match';
import { carryOverSettings } from '../domain/settings';
import { releaseLiveMatch } from '../services/live-match';

// อ่านผ่าน ROOT_DIR ของ config ไม่ใช่นับ ../ เอาเอง
//
// ไฟล์นี้รันจาก build/server/http/ ตอนใช้งานจริง ไม่ใช่ server/http/
// การนับขึ้นไปสองชั้นจึงไปโผล่ที่ build/ ซึ่งไม่มี package.json อยู่
// เป็นกับดักเดียวกับที่ CLAUDE.md เขียนไว้เรื่อง ROOT_DIR และมันทำให้ทุกเทสต์
// ที่สร้างแอพขึ้นมาล้มทันที เพราะ require พังตั้งแต่ตอนโหลดโมดูล
//
// อ่านแบบไม่โยน: เวอร์ชันเป็นแค่ป้ายกำกับในไฟล์สำรอง ไม่ควรทำให้เซิร์ฟเวอร์เปิดไม่ขึ้น
function readAppVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8');
    return String((JSON.parse(raw) as { version?: string }).version || 'unknown');
  } catch {
    return 'unknown';
  }
}

const APP_VERSION = readAppVersion();

export function backupRoutes(): Router {
  const router = express.Router();

  // ไฟล์นำเข้าใหญ่กว่า API อื่นมาก เพราะรูปฝังมาด้วย
  // ยังมีเพดานอยู่ ไม่ใช่ปล่อยไม่จำกัด: ทั้งไฟล์ถูก JSON.parse ทีเดียว
  // ซึ่งบล็อก event loop ที่เสิร์ฟ overlay ที่ออกอากาศอยู่ด้วย
  const bigJson = express.json({ limit: MAX_FILE_BYTES });

  router.get('/api/backup', requireControl, (_req, res) => {
    const file = getStores().backup.exportAll(APP_VERSION);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rov-overlay-backup-${stamp}.json"`);
    res.send(JSON.stringify(file));
  });

  // ดูก่อน ยังไม่แตะอะไร
  router.post('/api/backup/preview', requireControl, bigJson, (req, res) => {
    const result = readBackup(req.body);
    if (result.error !== undefined) {
      res.status(400).json({ error: result.error });
      return;
    }

    const { teamIds, tournamentIds } = getStores().backup.existing();
    const file = result.file;
    res.json({
      summary: summarise(file),
      // ถ้ากู้แบบรวม อันไหนจะถูกข้ามเพราะมีอยู่แล้ว
      alreadyHere: {
        teams: file.data.teams.filter((t) => teamIds.has(t.id)).length,
        tournaments: file.data.tournaments.filter((t) => tournamentIds.has(t.id)).length
      }
    });
  });

  router.post('/api/backup/restore', requireControl, bigJson, (req, res) => {
    const body = (req.body || {}) as { file?: unknown; mode?: unknown };
    const result = readBackup(body.file);
    if (result.error !== undefined) {
      res.status(400).json({ error: result.error });
      return;
    }

    // ค่าเริ่มต้นคือ merge ตั้งใจ 'replace' ลบของที่มีอยู่ทั้งหมด
    // ค่าที่อ่านไม่ออกต้องตกมาที่ตัวเลือกที่ไม่ทำลายอะไร ไม่ใช่ตัวที่ทำลาย
    const mode: RestoreMode = body.mode === 'replace' ? 'replace' : 'merge';

    let report;
    try {
      report = getStores().backup.restore(result.file, mode);
    } catch (error) {
      res.status(500).json({ error: `Restore failed: ${(error as Error).message}` });
      return;
    }

    // เขียนทับทุกอย่างแล้ว แมตช์ที่ค้างอยู่บนจออาจไม่มีอยู่อีกต่อไป
    // ปล่อยตัวชี้ทิ้งและล้างกระดานให้เป็นค่าเริ่มต้น ดีกว่าให้หน้า Control
    // บอกว่ากำลังคุมคู่ที่เพิ่งถูกลบไป
    if (mode === 'replace') {
      releaseLiveMatch();
      const previous = getState();
      setState(carryOverSettings(sanitizeState({ ...defaultState }), previous));
      emitState();
    }

    notifyData({ topic: 'teams' });
    notifyData({ topic: 'tournaments' });
    res.json({ ok: true, report });
  });

  return router;
}
