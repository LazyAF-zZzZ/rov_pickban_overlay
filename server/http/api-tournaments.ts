// API ของทัวร์นาเมนต์
//
// ตัวเพดาน 128 ทีมกับกติการูปแบบการแข่งอยู่ในชั้น store/domain แล้ว
// ที่นี่ทำหน้าที่แปลงผลลัพธ์เป็น HTTP status เท่านั้น ไม่ตัดสินกติกาเอง
//
// เลือกใช้ 400 กับข้อผิดพลาดจากกติกา (เช่น ทีมเต็ม) และ 404 เมื่อหาไม่เจอ
// หน้าเว็บเอาข้อความจาก error ไปแสดงตรงๆ ได้เลย

import express, { Router } from 'express';
// เขียน '../store/index' ให้ครบตามกฎเดียวกับ './server/index' ในไฟล์ราก
import { getStores } from '../store/index';
import { FORMATS, BEST_OF_OPTIONS, STATUSES, MAX_TEAMS } from '../domain/tournament';
import { requireControl } from './auth';
import { goLive, clearLive, describeLive, notifyAnalytics } from '../services/live-match';
import { toHeroStats, summarise, rankHeroes, isRankMode } from '../domain/analytics';
import { notifyData } from '../services/sync';
import { recordSeriesResult } from '../services/series';

const NOT_FOUND = /not found/i;

export function tournamentRoutes(): Router {
  const router = express.Router();

  // ข้อมูลอ้างอิงให้หน้าเว็บสร้างฟอร์มได้โดยไม่ต้องฝังค่าซ้ำ
  // เพิ่มรูปแบบใหม่ใน domain แล้วหน้าเว็บได้ตามเอง ไม่ต้องแก้สองที่
  router.get('/api/tournament-options', (_req, res) => {
    res.json({
      formats: Object.entries(FORMATS).map(([id, spec]) => ({
        id,
        label: spec.label,
        minTeams: spec.minTeams,
        maxTeams: spec.maxTeams
      })),
      bestOf: BEST_OF_OPTIONS,
      statuses: STATUSES,
      maxTeams: MAX_TEAMS
    });
  });

  router.get('/api/tournaments', (_req, res) => {
    res.json({ tournaments: getStores().tournaments.list() });
  });

  router.post('/api/tournaments', requireControl, (req, res) => {
    const result = getStores().tournaments.create(req.body);
    if (result.error !== undefined) {
      res.status(400).json({ error: result.error });
      return;
    }
    notifyData({ topic: 'tournaments', tournamentId: result.tournament.id });
    res.json({ ok: true, tournament: result.tournament });
  });

  router.get('/api/tournaments/:id', (req, res) => {
    const { tournaments } = getStores();
    const tournament = tournaments.get(req.params.id);
    if (!tournament) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }
    res.json({ tournament, teams: tournaments.teams(req.params.id) });
  });

  router.put('/api/tournaments/:id', requireControl, (req, res) => {
    const result = getStores().tournaments.update(req.params.id, req.body);
    if (result.error !== undefined) {
      res.status(NOT_FOUND.test(result.error) ? 404 : 400).json({ error: result.error });
      return;
    }
    notifyData({ topic: 'tournaments', tournamentId: req.params.id });
    res.json({ ok: true, tournament: result.tournament });
  });

  // ปิดทัวร์นาเมนต์ / เปิดกลับมาแก้ต่อ แยกจาก update
  // เพราะหน้ารายการต้องกดสลับได้โดยไม่ต้องส่งฟอร์มทั้งก้อนมา
  router.post('/api/tournaments/:id/status', requireControl, (req, res) => {
    const body = (req.body || {}) as { status?: unknown };
    const result = getStores().tournaments.setStatus(req.params.id, body.status);
    if (result.error !== undefined) {
      res.status(404).json({ error: result.error });
      return;
    }
    notifyData({ topic: 'tournaments', tournamentId: req.params.id });
    res.json({ ok: true, tournament: result.tournament });
  });

  // ลบถาวร ไม่มีถังขยะให้กู้ ทัวร์นาเมนต์ สายการแข่ง และดราฟต์ที่บันทึกไว้หายหมด
  // หน้าเว็บต้องถามยืนยันก่อนเรียก แล้วเอา removed ไปบอกว่าอะไรหายไปเท่าไร
  //
  // ถ้าลบตัวที่กำลังออกอากาศ ต้องเคลียร์ตัวชี้ให้ด้วย
  // FK คลาย match_id เป็น NULL ให้อยู่แล้ว แต่ไม่มีใครส่งสัญญาณบอกหน้าอื่น
  // หน้าที่เปิดค้างไว้จะยังโชว์ว่าแมตช์ที่ลบไปแล้วอยู่บนจอ
  router.delete('/api/tournaments/:id', requireControl, (req, res) => {
    const wasLive = describeLive().tournamentId === req.params.id;

    const result = getStores().tournaments.remove(req.params.id);
    if (result.error !== undefined) {
      res.status(404).json({ error: result.error });
      return;
    }

    if (wasLive) clearLive();
    notifyData({ topic: 'tournaments', tournamentId: req.params.id });
    res.json({ ok: true, removed: result.removed, wasLive });
  });

  // ROSTER ------------------------------------------------------------
  //
  // เพดานทีมถูกบังคับที่ชั้น store ตรงนี้แค่แปลงเป็น status
  // เต็มแล้ว = 409 Conflict ไม่ใช่ 400 เพราะคำขอถูกต้องทุกอย่าง
  // แค่สถานะตอนนี้ของทัวร์นาเมนต์ไม่รับเพิ่มแล้ว หน้าเว็บจะได้แยกกรณีถูก

  router.get('/api/tournaments/:id/teams', (req, res) => {
    const { tournaments } = getStores();
    if (!tournaments.get(req.params.id)) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }
    res.json({ teams: tournaments.teams(req.params.id) });
  });

  router.post('/api/tournaments/:id/teams', requireControl, (req, res) => {
    const body = (req.body || {}) as { teamId?: unknown; seed?: unknown };
    const { tournaments } = getStores();
    const result = tournaments.addTeam(req.params.id, String(body.teamId || ''), body.seed as number);

    if (result.error !== undefined) {
      const status = NOT_FOUND.test(result.error) ? 404 : (result.limit !== undefined ? 409 : 400);
      res.status(status).json({ error: result.error, limit: result.limit });
      return;
    }
    notifyData({ topic: 'roster', tournamentId: req.params.id });
    res.json({
      ok: true,
      teamCount: result.teamCount,
      tournament: tournaments.get(req.params.id),
      teams: tournaments.teams(req.params.id)
    });
  });

  router.delete('/api/tournaments/:id/teams/:teamId', requireControl, (req, res) => {
    const { tournaments } = getStores();
    const result = tournaments.removeTeam(req.params.id, req.params.teamId);
    if (result.error !== undefined) {
      res.status(404).json({ error: result.error });
      return;
    }
    notifyData({ topic: 'roster', tournamentId: req.params.id });
    res.json({
      ok: true,
      teamCount: result.teamCount,
      tournament: tournaments.get(req.params.id),
      teams: tournaments.teams(req.params.id)
    });
  });

  // MATCHES -----------------------------------------------------------

  router.get('/api/tournaments/:id/matches', (req, res) => {
    const { tournaments, matches } = getStores();
    if (!tournaments.get(req.params.id)) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }
    res.json({ matches: matches.list(req.params.id) });
  });

  // สร้างสายใหม่ = ทิ้งของเดิมทั้งชุด ผลที่บันทึกไว้หายด้วย
  // หน้าเว็บต้องถามยืนยันก่อนเรียก
  router.post('/api/tournaments/:id/matches', requireControl, (req, res) => {
    const body = (req.body || {}) as { randomise?: unknown };
    const result = getStores().matches.generate(req.params.id, {
      randomise: body.randomise === true
    });
    if (result.error !== undefined) {
      res.status(NOT_FOUND.test(result.error) ? 404 : 400).json({ error: result.error });
      return;
    }
    notifyData({ topic: 'matches', tournamentId: req.params.id });
    res.json({ ok: true, matches: result.matches });
  });

  router.delete('/api/tournaments/:id/matches', requireControl, (req, res) => {
    const { tournaments, matches } = getStores();
    if (!tournaments.get(req.params.id)) {
      res.status(404).json({ error: 'Tournament not found' });
      return;
    }
    matches.clear(req.params.id);
    notifyData({ topic: 'matches', tournamentId: req.params.id });
    res.json({ ok: true, matches: [] });
  });

  // LIVE MATCH --------------------------------------------------------

  router.get('/api/live-match', (_req, res) => {
    res.json({ live: describeLive() });
  });

  // เอาแมตช์นี้ขึ้นจอ แล้วผูกดราฟต์ที่กำลังจะเกิดเข้ากับเกมของแมตช์นี้
  router.post('/api/matches/:matchId/live', requireControl, (req, res) => {
    const result = goLive(req.params.matchId);
    if (result.error !== undefined) {
      res.status(NOT_FOUND.test(result.error) ? 404 : 400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, live: result.live });
  });

  router.delete('/api/live-match', requireControl, (_req, res) => {
    res.json({ ok: true, live: clearLive() });
  });

  // ดราฟต์ที่บันทึกไว้ของแมตช์นี้ ใช้ดูย้อนหลังและเป็นวัตถุดิบของสถิติ
  router.get('/api/matches/:matchId/games', (req, res) => {
    const { matches, games } = getStores();
    if (!matches.get(req.params.matchId)) {
      res.status(404).json({ error: 'Match not found' });
      return;
    }
    res.json({ games: games.forMatch(req.params.matchId) });
  });

  // ผู้ชนะของ "เกม" ไม่ใช่ของซีรีส์
  //
  // ต้องบันทึกตอนนั้น เดาย้อนหลังไม่ได้เลย
  // ซีรีส์ Bo3 ที่จบ 2-1 บอกได้แค่ว่าใครชนะซีรีส์ ไม่ได้บอกว่าเกมที่สองใครชนะ
  // อัตราชนะรายฮีโร่จึงต้องอาศัยการกดบันทึกตรงนี้เท่านั้น
  router.put('/api/games/:gameId/winner', requireControl, (req, res) => {
    const body = (req.body || {}) as { winner?: unknown };
    const raw = body.winner;
    // อนุญาต null ตั้งใจ ไว้ล้างค่าตอนกดผิด
    const winner = raw === 'blue' || raw === 'red' ? raw : null;
    if (raw !== null && raw !== undefined && winner === null) {
      res.status(400).json({ error: 'Winner must be blue, red or null' });
      return;
    }

    const game = getStores().games.setWinner(req.params.gameId, winner);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    // อัตราชนะเปลี่ยนทันที หน้าสถิติที่เปิดค้างอยู่ต้องรู้
    notifyAnalytics();
    res.json({ ok: true, game, live: describeLive() });
  });

  // สถิติ pick/ban กรองได้ตามทัวร์นาเมนต์หรือตามทีม
  router.get('/api/analytics', (req, res) => {
    const query = req.query as { tournamentId?: unknown; teamId?: unknown };
    const scope = {
      tournamentId: typeof query.tournamentId === 'string' && query.tournamentId ? query.tournamentId : null,
      teamId: typeof query.teamId === 'string' && query.teamId ? query.teamId : null
    };

    const raw = getStores().analytics.read(scope);
    const heroes = toHeroStats(raw.counts, raw.games);

    // สรุปคิดจากชุดเต็มเสมอ ไม่ใช่จากชุดที่ถูกตัดมาสิบแถว
    // ไม่งั้นกราฟิกที่ขอ top=10 จะบอกคนดูว่าทัวร์นาเมนต์นี้มีฮีโร่ลงแค่สิบตัว
    const summary = summarise(heroes, raw.games, raw.decidedGames);

    // การจัดอันดับเป็นของกราฟิกออกอากาศ หน้าสถิติของคนคุมงานไม่ส่งพารามิเตอร์พวกนี้มา
    // และต้องได้ผลเหมือนเดิมทุกประการ (เรียงตาม presence ครบทุกตัว)
    const ranking = req.query as { mode?: unknown; top?: unknown; minDecided?: unknown };
    const ranked = isRankMode(ranking.mode) || ranking.top !== undefined
      ? rankHeroes(heroes, {
        mode: isRankMode(ranking.mode) ? ranking.mode : 'presence',
        top: Number(ranking.top),
        minDecided: ranking.minDecided === undefined ? undefined : Number(ranking.minDecided)
      })
      : heroes;

    res.json({ scope, summary, heroes: ranked });
  });

  router.put('/api/matches/:matchId/result', requireControl, (req, res) => {
    const body = (req.body || {}) as { scoreA?: unknown; scoreB?: unknown };
    const { matches } = getStores();
    // ผ่าน service ไม่ใช่ store ตรงๆ เพราะการกรอกคะแนนซีรีส์เป็นตัวกำหนด
    // ผู้ชนะรายเกมไปด้วย ซึ่งเป็นงานข้ามสอง store (matches กับ games)
    const result = recordSeriesResult(req.params.matchId, body.scoreA, body.scoreB);
    if (result.error !== undefined) {
      res.status(NOT_FOUND.test(result.error) ? 404 : 400).json({ error: result.error });
      return;
    }
    notifyData({ topic: 'matches', tournamentId: result.match.tournamentId });
    res.json({ ok: true, match: result.match, matches: matches.list(result.match.tournamentId) });
  });

  router.put('/api/tournaments/:id/teams/:teamId/seed', requireControl, (req, res) => {
    const body = (req.body || {}) as { seed?: unknown };
    const { tournaments } = getStores();
    const result = tournaments.setSeed(req.params.id, req.params.teamId, body.seed);
    if (result.error !== undefined) {
      res.status(404).json({ error: result.error });
      return;
    }
    notifyData({ topic: 'roster', tournamentId: req.params.id });
    res.json({ ok: true, teams: tournaments.teams(req.params.id) });
  });

  return router;
}
