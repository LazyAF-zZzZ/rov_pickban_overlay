// API ของทะเบียนทีมกลาง
//
// ทีมในทะเบียนใช้ซ้ำได้ทุกทัวร์นาเมนต์ ลบทีมคือลบออกจากทะเบียนจริงๆ
// และหลุดจากทุกทัวร์นาเมนต์ที่เคยลง (ON DELETE CASCADE)
//
// โลโก้ตั้งชื่อไฟล์จาก id ที่เซิร์ฟเวอร์สร้าง ไม่ใช่ชื่อทีมที่ผู้ใช้พิมพ์
// ต่อให้ตั้งชื่อทีมว่า '../../evil' ก็ไม่มีผลกับชื่อไฟล์

import fs from 'fs';
import express, { Router } from 'express';
import { LOGO_DIR, LOGO_MAX_BYTES, teamLogoFilePath, removeTeamLogoFiles } from '../domain/media';
import { getStores } from '../store/index';
import { requireControl } from './auth';
import { validateUpload, rawImage } from './upload';
import { notifyData } from '../services/sync';

const NOT_FOUND = /not found/i;

export function teamRoutes(): Router {
  const router = express.Router();

  router.get('/api/teams', (_req, res) => {
    res.json({ teams: getStores().teams.list() });
  });

  // สรุปแพ้ชนะของทุกทีมในคำขอเดียว สำหรับหน้ารายชื่อทีม
  //
  // แยกจาก /api/teams ตั้งใจ ไม่เอาไปยัดรวมกัน
  // dropdown เลือกทีมในหน้าทัวร์นาเมนต์เรียก /api/teams บ่อย และไม่ต้องใช้สถิติเลย
  router.get('/api/team-summaries', (_req, res) => {
    res.json({ summaries: getStores().history.summaries() });
  });

  router.post('/api/teams', requireControl, (req, res) => {
    const result = getStores().teams.create(req.body);
    if (result.error !== undefined) {
      res.status(400).json({ error: result.error });
      return;
    }
    notifyData({ topic: 'teams', teamId: result.team.id });
    res.json({ ok: true, team: result.team });
  });

  router.get('/api/teams/:id', (req, res) => {
    const team = getStores().teams.get(req.params.id);
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    res.json({ team });
  });

  // ประวัติของทีม: ทุกทัวร์นาเมนต์ที่เคยลง และทุกคู่ที่เคยเจอ
  //
  // แยก endpoint จาก GET /api/teams/:id ตั้งใจ
  // หน้าไหนที่ต้องการแค่ชื่อกับรายชื่อผู้เล่น (เช่น dropdown เลือกทีม)
  // จะได้ไม่ต้องลากตารางแข่งทั้งกองมาด้วยทุกครั้ง
  router.get('/api/teams/:id/history', (req, res) => {
    const { teams, history } = getStores();
    const team = teams.get(req.params.id);
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    res.json({ team, ...history.forTeam(req.params.id) });
  });

  router.put('/api/teams/:id', requireControl, (req, res) => {
    const result = getStores().teams.update(req.params.id, req.body);
    if (result.error !== undefined) {
      res.status(NOT_FOUND.test(result.error) ? 404 : 400).json({ error: result.error });
      return;
    }
    notifyData({ topic: 'teams', teamId: req.params.id });
    res.json({ ok: true, team: result.team });
  });

  router.delete('/api/teams/:id', requireControl, (req, res) => {
    const { teams } = getStores();
    if (!teams.get(req.params.id)) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    // ลบไฟล์ก่อน แล้วค่อยลบแถว ถ้าสลับกันแล้วลบแถวสำเร็จแต่ลบไฟล์พลาด
    // จะเหลือไฟล์กำพร้าที่ไม่มีอะไรอ้างถึงอีกเลย
    removeTeamLogoFiles(req.params.id);
    const result = teams.remove(req.params.id);
    if (result.error !== undefined) {
      res.status(404).json({ error: result.error });
      return;
    }
    // ทีมหลุดจากทุกทัวร์นาเมนต์ที่เคยลงด้วย roster ของหน้าอื่นจึงเปลี่ยนตาม
    notifyData({ topic: 'teams', teamId: req.params.id });
    notifyData({ topic: 'roster' });
    res.json({ ok: true });
  });

  router.post('/api/teams/:id/logo', requireControl, rawImage(LOGO_MAX_BYTES), (req, res) => {
    const { teams } = getStores();
    const id = req.params.id;
    if (!teams.get(id)) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    const checked = validateUpload(req);
    if (checked.error !== undefined) {
      res.status(checked.status).json({ error: checked.error });
      return;
    }

    try {
      fs.mkdirSync(LOGO_DIR, { recursive: true });
      removeTeamLogoFiles(id); // กันไฟล์นามสกุลเดิมค้างตอนเปลี่ยนชนิดภาพ
      fs.writeFileSync(teamLogoFilePath(id, checked.ext), checked.body);
    } catch (error) {
      res.status(500).json({ error: `Could not save logo: ${(error as Error).message}` });
      return;
    }

    // v = เวลาที่อัปโหลด ไว้กัน cache ของเบราว์เซอร์กับ OBS
    const result = teams.setLogo(id, { v: Date.now(), ext: checked.ext });
    notifyData({ topic: 'teams', teamId: id });
    res.json({ ok: true, team: result.team });
  });

  router.delete('/api/teams/:id/logo', requireControl, (req, res) => {
    const { teams } = getStores();
    if (!teams.get(req.params.id)) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }
    removeTeamLogoFiles(req.params.id);
    const result = teams.setLogo(req.params.id, { v: 0, ext: '' });
    notifyData({ topic: 'teams', teamId: req.params.id });
    res.json({ ok: true, team: result.team });
  });

  return router;
}
