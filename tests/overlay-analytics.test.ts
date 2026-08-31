// เทสต์กระดานสถิติที่ขึ้นจอ: กติกาการจัดอันดับ และตัวหน้าเว็บเอง
//
// ตั้ง env ก่อน import อะไรก็ตาม เพราะ config อ่านตอน import
//
// เรื่องที่ตั้งใจจับที่สุดคืออัตราชนะจากเกมเดียว
// "100% win rate" ที่มาจากการลงหนึ่งเกมแล้วชนะ เป็นตัวเลขที่ถูกทางเลขคณิต
// แต่โกหกคนดู เพราะบนกราฟิกมันอ่านว่า "ฮีโร่ตัวนี้แข็งที่สุดในรายการ"

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-overlay-analytics-test-'));
process.env.ROV_USER_DATA_DIR = path.join(TMP, 'data');
process.env.ROV_USER_MEDIA_DIR = path.join(TMP, 'media');
process.env.CONTROL_TOKEN = '';

const { createApp } = require('../server/index') as typeof import('../server/index');
const { closeDatabase } = require('../server/store/db') as typeof import('../server/store/db');

import { toHeroStats, rankHeroes, rateFor, isRankMode, DEFAULT_MIN_DECIDED } from '../server/domain/analytics';
import type { HeroCounts } from '../server/domain/analytics';
import { must } from './helpers';

const app = createApp();
let server: http.Server;
let base = '';

interface Reply { status: number; body: any }

function request(method: string, url: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${url}`, { method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let body: any = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = text; }
        resolve({ status: res.statusCode || 0, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      resolve();
    });
  });
});

test.after(async () => {
  closeDatabase();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ระบบเก็บเอง */ }
});

// ---- ตัวช่วยสร้างตัวเลขนับ ----

function counts(over: Partial<HeroCounts> & { hero: string }): HeroCounts {
  return {
    picked: 0, banned: 0, present: 0, earlyBans: 0, wins: 0, decided: 0, ...over
  };
}

const GAMES = 20;

// ตั้งใจให้อันดับของแต่ละโหมดไม่เหมือนกัน ไม่งั้นเทสต์ผ่านได้โดยที่โหมดไม่ทำงานเลย
const SAMPLE = toHeroStats([
  counts({ hero: 'airi', picked: 12, banned: 2, present: 14, earlyBans: 1, wins: 4, decided: 12 }),
  counts({ hero: 'butterfly', picked: 1, banned: 16, present: 17, earlyBans: 9, wins: 1, decided: 1 }),
  counts({ hero: 'nakroth', picked: 8, banned: 1, present: 9, earlyBans: 0, wins: 6, decided: 8 }),
  counts({ hero: 'violet', picked: 2, banned: 0, present: 2, earlyBans: 0, wins: 2, decided: 2 }),
  counts({ hero: 'zephys' })   // ไม่เคยลงเลย ไม่ควรโผล่บนกระดานไหนทั้งนั้น
], GAMES);

// ---- กติกาการจัดอันดับ ----

test('each mode ranks by its own number, not by presence with a different label', () => {
  const top = (mode: 'presence' | 'pick' | 'ban' | 'win'): string =>
    must(rankHeroes(SAMPLE, { mode, top: 1 })[0]).hero;

  assert.strictEqual(top('presence'), 'butterfly', '17 of 20 games');
  assert.strictEqual(top('pick'), 'airi', 'picked 12, more than anyone');
  assert.strictEqual(top('ban'), 'butterfly', 'banned 16');
  // violet ชนะ 2 จาก 2 = 100% แต่มีแค่สองเกม ยังไม่ถึงขั้นต่ำสามเกม
  assert.strictEqual(top('win'), 'nakroth', '6 of 8 beats airi 4 of 12');
});

test('a perfect win rate from too few games never leads the board', () => {
  const winners = rankHeroes(SAMPLE, { mode: 'win' }).map((s) => s.hero);

  assert.ok(!winners.includes('butterfly'), '1 game decided is not a win rate');
  assert.ok(!winners.includes('violet'), '2 games decided is still under the floor');
  assert.deepStrictEqual(winners, ['nakroth', 'airi'], 'only the ones with enough games');

  // ลดขั้นต่ำลงแล้วต้องกลับเข้ามา กติกาปรับได้จาก URL ไม่ได้ฝังตาย
  const loose = rankHeroes(SAMPLE, { mode: 'win', minDecided: 1 }).map((s) => s.hero);
  assert.deepStrictEqual(loose, ['butterfly', 'violet', 'nakroth', 'airi'], '100% first once it counts');
  assert.strictEqual(DEFAULT_MIN_DECIDED, 3, 'the default floor is documented in the plan');
});

// แถวที่เป็นศูนย์กินที่ของแถวที่มีข้อมูลจริง และทำให้กราฟิกดูเหมือนข้อมูลยังมาไม่ครบ
test('heroes with nothing to say in that mode are left off, not shown as zero', () => {
  assert.ok(!rankHeroes(SAMPLE, { mode: 'presence' }).some((s) => s.hero === 'zephys'));
  assert.ok(!rankHeroes(SAMPLE, { mode: 'ban' }).some((s) => s.hero === 'violet'), 'never banned');
  assert.ok(rankHeroes(SAMPLE, { mode: 'pick' }).some((s) => s.hero === 'violet'), 'but it was picked');
});

test('top trims the board, and a missing or junk top means everything', () => {
  assert.strictEqual(rankHeroes(SAMPLE, { mode: 'presence', top: 2 }).length, 2);
  assert.strictEqual(rankHeroes(SAMPLE, { mode: 'presence' }).length, 4, 'zephys is filtered, not trimmed');
  // Number(undefined) เป็น NaN ซึ่งไม่ผ่าน isFinite จึงต้องได้ทั้งหมด ไม่ใช่กระดานเปล่า
  assert.strictEqual(rankHeroes(SAMPLE, { mode: 'presence', top: Number('x') }).length, 4);
  assert.strictEqual(rankHeroes(SAMPLE, { mode: 'presence', top: 0 }).length, 4);
});

// กระดานรีเฟรชตัวเองได้ ถ้าลำดับไม่คงที่ แถวจะสลับที่ทั้งที่ไม่มีอะไรเปลี่ยนจริง
test('equal numbers keep a stable order across repeated ranking', () => {
  const tied = toHeroStats([
    counts({ hero: 'zuka', picked: 5, present: 5 }),
    counts({ hero: 'alice', picked: 5, present: 5 }),
    counts({ hero: 'maloch', picked: 5, present: 5 })
  ], GAMES);

  const once = rankHeroes(tied, { mode: 'pick' }).map((s) => s.hero);
  const twice = rankHeroes([...tied].reverse(), { mode: 'pick' }).map((s) => s.hero);
  assert.deepStrictEqual(once, twice, 'input order must not change the board');
  assert.deepStrictEqual(once, ['alice', 'maloch', 'zuka'], 'settled alphabetically at the end');
});

test('the bar reads the same number the board was ranked by', () => {
  const airi = must(SAMPLE.find((s) => s.hero === 'airi'));
  assert.strictEqual(rateFor(airi, 'pick'), airi.pickRate);
  assert.strictEqual(rateFor(airi, 'ban'), airi.banRate);
  assert.strictEqual(rateFor(airi, 'win'), airi.winRate);
  assert.strictEqual(rateFor(airi, 'presence'), airi.presence);
  // ไม่มีอัตราชนะ = 0 สำหรับความยาวแถบ ไม่ใช่ NaN ที่ทำให้แถบหายไปทั้งอัน
  assert.strictEqual(rateFor(must(SAMPLE.find((s) => s.hero === 'zephys')), 'win'), 0);
});

test('an unknown mode is refused rather than quietly becoming presence somewhere else', () => {
  assert.ok(isRankMode('presence') && isRankMode('pick') && isRankMode('ban') && isRankMode('win'));
  assert.ok(!isRankMode('winrate'));
  assert.ok(!isRankMode(''));
  assert.ok(!isRankMode(undefined));
});

// ---- API ----

test('the analytics API is unchanged for the operator page, which sends no ranking', async () => {
  const reply = await request('GET', '/api/analytics');
  assert.strictEqual(reply.status, 200);
  assert.ok(Array.isArray(reply.body.heroes));
  assert.strictEqual(typeof reply.body.summary.games, 'number');
});

test('the summary counts the whole tournament, not the ten rows the board asked for', async () => {
  const full = await request('GET', '/api/analytics');
  const board = await request('GET', '/api/analytics?mode=presence&top=3');

  assert.strictEqual(board.status, 200);
  assert.ok(board.body.heroes.length <= 3, 'the board is trimmed');
  assert.deepStrictEqual(
    board.body.summary, full.body.summary,
    'a trimmed board must not tell viewers the tournament had three heroes in it'
  );
});

// ---- หน้าเว็บ ----

test('the stats overlay is served, and is a broadcast page rather than an operator one', async () => {
  const page = await request('GET', '/overlay-analytics');
  assert.strictEqual(page.status, 200);

  const html = String(page.body);
  assert.ok(html.includes('/js/overlay-analytics.js'), 'serves its own script');
  assert.ok(html.includes('/css/overlay-analytics.css'), 'and its own stylesheet');
  assert.ok(!html.includes('i18n.js'), 'viewers see English, so no translator');
  assert.ok(!html.includes('app-client.js'), 'view-only, no control token needed');

  // overlay-size.js อ่านตัวแปร socket ที่ overlay-analytics.js ประกาศไว้
  // สลับลำดับแล้วหน้าจะไม่ตามขนาดจอที่เลือกจาก Control Panel อีกเลย
  assert.ok(
    html.indexOf('/js/overlay-analytics.js') < html.indexOf('/js/overlay-size.js'),
    'overlay-analytics.js is loaded before overlay-size.js reads its socket'
  );
});

// /analytics เป็นหน้าของคนคุมงานมาตั้งแต่ Phase 8 กระดานที่ขึ้นจอต้องอยู่คนละที่
// (กฎเดียวกับ /teams กับ /overlay-teams ซึ่งเคยชนกันมาแล้วในแผน Appendix A)
test('the operator statistics page and the broadcast board stay apart', async () => {
  const operator = String((await request('GET', '/analytics')).body);
  const broadcast = String((await request('GET', '/overlay-analytics')).body);

  assert.ok(operator.includes('/js/analytics.js'), '/analytics is still the operator page');
  assert.ok(!operator.includes('overlay-analytics.js'));
  assert.ok(!broadcast.includes('/js/analytics.js'));
});

test('the stats board is offered as an OBS source, carrying its tournament id', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'js', 'lib', 'obs-sources.js'),
    'utf8'
  );
  const entry = must(
    source.split('\n').find((line) => line.includes("path: '/overlay-analytics'")),
    'the board is in the shared OBS source list'
  );
  // ไม่แนบ id = กระดานจะไปเดาเอาจากแมตช์ที่ออกอากาศ ซึ่งไม่ใช่สิ่งที่คนก๊อป
  // URL จากหน้าทัวร์นาเมนต์ตั้งใจ (เหตุผลเดียวกับ Team list)
  assert.ok(entry.includes('perTournament: true'), 'and it is copied with the tournament id');
});
