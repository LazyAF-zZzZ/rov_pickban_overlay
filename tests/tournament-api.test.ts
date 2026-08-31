// เทสต์ HTTP ของทัวร์นาเมนต์ ยิงผ่าน express จริง
//
// ตั้ง ROV_USER_DATA_DIR ไปที่โฟลเดอร์ชั่วคราวก่อน import อะไรก็ตาม
// เพราะ config อ่าน env ตอน import ถ้าตั้งทีหลังจะไปเขียนทับ
// tournament.db ของผู้ใช้จริง

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-api-test-'));
process.env.ROV_USER_DATA_DIR = path.join(TMP, 'data');
process.env.ROV_USER_MEDIA_DIR = path.join(TMP, 'media');
process.env.CONTROL_TOKEN = '';

// ต้อง import หลังตั้ง env เท่านั้น
const { createApp } = require('../server/index') as typeof import('../server/index');
const { closeDatabase } = require('../server/store/db') as typeof import('../server/store/db');

const app = createApp();
let server: http.Server;
let base = '';

interface Reply { status: number; body: any }

function request(method: string, url: string, payload?: unknown): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const data = payload === undefined ? null : JSON.stringify(payload);
    const req = http.request(
      `${base}${url}`,
      {
        method,
        headers: data
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
          : {}
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let body: any = null;
          try { body = JSON.parse(text); } catch { body = text; }
          resolve({ status: res.statusCode || 0, body });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      base = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.after(() => {
  server?.close();
  // ต้องปิดฐานข้อมูลก่อนลบโฟลเดอร์ ไม่งั้น Windows ไม่ยอมให้ลบ
  // เพราะ SQLite ยังถือ handle ของไฟล์ .db กับไฟล์ WAL อยู่
  closeDatabase();
  // ลบไม่ได้ก็ไม่ใช่ความผิดของเทสต์ อย่าให้ชุดเทสต์ล้มเพราะเก็บกวาดไม่สำเร็จ
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* โฟลเดอร์ชั่วคราวค้างไว้ ระบบจะเก็บเอง */
  }
});

test('options endpoint describes the formats the UI must offer', async () => {
  const { status, body } = await request('GET', '/api/tournament-options');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.maxTeams, 128);
  assert.deepStrictEqual(body.bestOf, [1, 3, 5, 7]);
  assert.deepStrictEqual(body.statuses, ['active', 'finished']);

  const ids = body.formats.map((f: any) => f.id);
  ['single_elim', 'double_elim', 'round_robin', 'group_stage'].forEach((id) => {
    assert.ok(ids.includes(id), `${id} offered`);
  });
  const rr = body.formats.find((f: any) => f.id === 'round_robin');
  assert.strictEqual(rr.maxTeams, 24, 'round robin cap is visible to the UI');
});

test('a tournament can be created, listed, read, updated and deleted', async () => {
  const created = await request('POST', '/api/tournaments', {
    name: 'RPL Season 1', format: 'single_elim', bestOf: 5, note: 'Bangkok'
  });
  assert.strictEqual(created.status, 200);
  const id = created.body.tournament.id;
  assert.strictEqual(created.body.tournament.name, 'RPL Season 1');
  assert.strictEqual(created.body.tournament.bestOf, 5);
  assert.strictEqual(created.body.tournament.maxTeams, 128);

  const listed = await request('GET', '/api/tournaments');
  assert.strictEqual(listed.status, 200);
  assert.ok(listed.body.tournaments.some((t: any) => t.id === id));

  const read = await request('GET', `/api/tournaments/${id}`);
  assert.strictEqual(read.status, 200);
  assert.strictEqual(read.body.tournament.note, 'Bangkok');
  assert.deepStrictEqual(read.body.teams, [], 'a new tournament has no teams');

  const updated = await request('PUT', `/api/tournaments/${id}`, {
    name: 'RPL Season 1 (final)', format: 'round_robin', bestOf: 3, status: 'active', note: ''
  });
  assert.strictEqual(updated.status, 200);
  assert.strictEqual(updated.body.tournament.format, 'round_robin');
  assert.strictEqual(updated.body.tournament.maxTeams, 24, 'cap follows the new format');

  const removed = await request('DELETE', `/api/tournaments/${id}`);
  assert.strictEqual(removed.status, 200);
  assert.strictEqual((await request('GET', `/api/tournaments/${id}`)).status, 404);
});

// การลบผ่าน API ต้องบอกกลับด้วยว่ากินอะไรไปบ้าง หน้าเว็บเอาไปแสดงใน toast
// และต้องปลดแมตช์ที่กำลังออกอากาศออก ไม่ใช่ปล่อยให้หน้าอื่นยังคิดว่ามีของอยู่บนจอ
test('deleting a tournament reports the damage and takes it off air', async () => {
  const cup = (await request('POST', '/api/tournaments', {
    name: 'Deletable Cup', format: 'single_elim', bestOf: 3
  })).body.tournament;

  const ids: string[] = [];
  for (const name of ['Alpha', 'Bravo']) {
    const team = (await request('POST', '/api/teams', { name })).body.team;
    ids.push(team.id);
    await request('POST', `/api/tournaments/${cup.id}/teams`, { teamId: team.id });
  }

  const drawn = (await request('POST', `/api/tournaments/${cup.id}/matches`, {})).body.matches;
  assert.strictEqual(drawn.length, 1, 'two teams make one match');

  const wentLive = await request('POST', `/api/matches/${drawn[0].id}/live`);
  assert.strictEqual(wentLive.status, 200);
  assert.strictEqual((await request('GET', '/api/live-match')).body.live.tournamentId, cup.id);

  const removed = await request('DELETE', `/api/tournaments/${cup.id}`);
  assert.strictEqual(removed.status, 200);
  assert.strictEqual(removed.body.wasLive, true);
  assert.strictEqual(removed.body.removed.teams, 2);
  assert.strictEqual(removed.body.removed.matches, 1);
  assert.strictEqual(removed.body.removed.games, 1, 'going on air created a game to record');

  assert.strictEqual((await request('GET', `/api/tournaments/${cup.id}`)).status, 404);
  assert.strictEqual(
    (await request('GET', '/api/live-match')).body.live.tournamentId,
    null,
    'nothing is left pointing at the deleted tournament'
  );

  // ทีมยังอยู่ในทะเบียน ทัวร์นาเมนต์อื่นต้องใช้ต่อได้
  for (const id of ids) {
    assert.strictEqual((await request('GET', `/api/teams/${id}`)).status, 200);
  }
});

test('a tournament needs a name', async () => {
  const { status, body } = await request('POST', '/api/tournaments', { name: '   ' });
  assert.strictEqual(status, 400);
  assert.match(body.error, /name is required/i);
});

test('unknown ids give 404, not 500', async () => {
  assert.strictEqual((await request('GET', '/api/tournaments/nope')).status, 404);
  assert.strictEqual((await request('DELETE', '/api/tournaments/nope')).status, 404);
  assert.strictEqual((await request('PUT', '/api/tournaments/nope', { name: 'x' })).status, 404);
  assert.strictEqual(
    (await request('POST', '/api/tournaments/nope/status', { status: 'finished' })).status,
    404
  );
});

test('status flips without sending the whole form', async () => {
  const id = (await request('POST', '/api/tournaments', { name: 'Cup' })).body.tournament.id;

  const finished = await request('POST', `/api/tournaments/${id}/status`, { status: 'finished' });
  assert.strictEqual(finished.status, 200);
  assert.strictEqual(finished.body.tournament.status, 'finished');
  assert.strictEqual(finished.body.tournament.name, 'Cup', 'nothing else changed');

  const junk = await request('POST', `/api/tournaments/${id}/status`, { status: 'banana' });
  assert.strictEqual(junk.body.tournament.status, 'active', 'junk falls back to active');
});

// หน้าตรวจเสียงต้องเปิดได้เสมอ แม้ตอนที่ยังไม่มีไฟล์เสียงสักไฟล์
//
// มันคือเครื่องมือที่ใช้ตอน "ไม่มีเสียง" ถ้ามันพังตอนโฟลเดอร์ว่าง
// มันก็พังในสถานการณ์เดียวที่คนต้องใช้มันจริงๆ
test('the sound check page and its report work with no sound files at all', async () => {
  const page = await request('GET', '/sfx-test');
  assert.strictEqual(page.status, 200);
  assert.ok(String(page.body).includes('/js/sfx-test.js'), 'serves its own script');
  assert.ok(String(page.body).includes('/css/theme.css'), 'uses the shared theme');

  const report = await request('GET', '/api/sounds');
  assert.strictEqual(report.status, 200);
  assert.ok(report.body.dir, 'reports where the folder is');
  assert.deepStrictEqual(report.body.sounds, {}, 'no files yet, and that is not an error');
});

// overlay ต้องโหลด overlay-sfx.js ก่อน overlay.js เสมอ
//
// overlay.js เรียก RovSfx ตั้งแต่ state ก้อนแรกที่มาถึง ลืมแท็กนี้แล้วจะได้
// ReferenceError กลางฟังก์ชันที่วาดกระดาน ผลไม่ใช่ "ไม่มีเสียง" แต่คือ overlay
// ค้างอยู่กับภาพเดิมทั้งเกม ซึ่งเป็นความพังที่เห็นกันทั้งสตรีม
//
// และต้องเงียบเป็นค่าเริ่มต้น เสียงเปิดด้วย ?sfx=1 ที่ URL ของ source เท่านั้น
// ไม่ใช่ของที่ติดมากับหน้า ไม่งั้นคนที่อัปเดตแอพจะมีเสียงโผล่กลางรายการ
test('the overlay loads its sound module first and stays silent unless asked', async () => {
  for (const url of ['/overlay', '/overlay-1440']) {
    const html = String((await request('GET', url)).body);

    const sfxAt = html.indexOf('js/overlay-sfx.js');
    assert.ok(sfxAt > -1, `${url} loads overlay-sfx.js`);
    assert.ok(sfxAt < html.indexOf('js/overlay.js'), `${url} loads it before overlay.js`);
    assert.ok(!html.includes('sfx=1'), `${url} does not turn sound on by itself`);
  }

  // หน้าที่ออกอากาศอันอื่นไม่มีเสียง เปิดพร้อมกันแล้วจะได้ยินซ้อนกัน
  for (const url of ['/result', '/overlay-teams']) {
    const html = String((await request('GET', url)).body);
    assert.ok(!html.includes('overlay-sfx.js'), `${url} must not play sound too`);
  }

  // โฟลเดอร์เสียงยังไม่มีไฟล์ ต้องได้ 404 เปล่าๆ ไม่ใช่ 500
  assert.strictEqual((await request('GET', '/sounds/pick.mp3')).status, 404);
});

// เส้นแบ่งระหว่าง "หน้าคนคุมงาน" กับ "กราฟิกออกอากาศ" เป็นเรื่องของธีมด้วย
//
// หน้าคนคุมงานใช้ธีมกลางร่วมกันหมด ส่วนหน้าที่ออกอากาศมีหน้าตาของตัวเอง
// ที่ผู้ใช้ตั้งเองจากหน้า Design ถ้าวันหนึ่งมีใครลิงก์ theme.css เข้าไปในหน้า
// ออกอากาศ การแก้สีในแอปจะไปเปลี่ยนสิ่งที่คนดูเห็นกลางถ่ายทอดสดโดยไม่มีใครตั้งใจ
test('operator pages share the theme and broadcast pages keep their own look', async () => {
  const operator = [
    '/', '/teams', '/teams/anything', '/tournament/anything',
    '/tournament/anything/bracket', '/analytics',
    '/control', '/design', '/hotkeys', '/guide'
  ];
  for (const url of operator) {
    const html = String((await request('GET', url)).body);
    assert.ok(html.includes('/css/theme.css'), `${url} links the shared theme`);
  }

  for (const url of ['/overlay', '/overlay-1440', '/result', '/overlay-teams']) {
    const html = String((await request('GET', url)).body);
    assert.ok(!html.includes('theme.css'), `${url} must not take the operator theme`);
  }
});

// หน้าที่แสดงรายการ browser source ต้องโหลด obs-sources.js ก่อนสคริปต์ของตัวเอง
//
// ทั้งสองหน้าเรียก window.RovObsSources ตอนวาดหน้า ลืมแท็กนี้ = หน้าตายทั้งหน้า
// และตัวโมดูลเองอ่าน window.RovClient ตอนโหลด จึงต้องมาหลัง app-client.js ด้วย
test('every page that lists OBS sources loads the shared module in the right order', async () => {
  const pages = [
    { url: '/control', script: 'js/control.js' },
    { url: '/tournament/anything', script: '/js/tournament.js' }
  ];

  for (const page of pages) {
    const html = String((await request('GET', page.url)).body);
    const libAt = html.indexOf('/js/lib/obs-sources.js');
    assert.ok(libAt > -1, `${page.url} loads obs-sources.js`);
    assert.ok(libAt < html.indexOf(page.script), `${page.url} loads it before its own script`);
    assert.ok(
      html.indexOf('lib/app-client.js') < libAt,
      `${page.url} loads app-client.js first, which obs-sources.js reads at load time`
    );
  }
});

// หน้าที่ลบทัวร์นาเมนต์ได้ต้องโหลด tournament-ui.js ก่อนสคริปต์ของตัวเอง
// ลืมแท็กนี้ = หน้าตายตั้งแต่บรรทัด destructure โดยไม่มีอะไรบอกว่าเพราะอะไร
// (กฎเดียวกับ team-ui.js ที่ team-api.test.ts เฝ้าอยู่)
test('every page that deletes a tournament loads the shared tournament module', async () => {
  const pages = [
    { url: '/', script: '/js/home.js' },
    { url: '/tournament/anything', script: '/js/tournament.js' }
  ];

  for (const page of pages) {
    const html = String((await request('GET', page.url)).body);
    const libAt = html.indexOf('/js/lib/tournament-ui.js');
    assert.ok(libAt > -1, `${page.url} loads tournament-ui.js`);
    assert.ok(libAt < html.indexOf(page.script), `${page.url} loads it before ${page.script}`);
    assert.ok(
      html.indexOf('/js/lib/app-client.js') < libAt,
      `${page.url} loads app-client.js first, which tournament-ui.js reads at load time`
    );
  }
});

test('the tournament page is served for any id', async () => {
  const res = await request('GET', '/tournament/anything');
  assert.strictEqual(res.status, 200);
  assert.ok(String(res.body).includes('/js/tournament.js'), 'serves the tournament page');
  // path ของ asset ต้องเป็นแบบเต็ม ไม่งั้นเบราว์เซอร์หาไม่เจอเพราะ URL ลึกกว่าหน้าอื่น
  assert.ok(!String(res.body).includes('src="js/'), 'no relative script paths');
  assert.ok(!String(res.body).includes('href="css/'), 'no relative stylesheet paths');
});
