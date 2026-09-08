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
// เสียงไม่ตาม ROV_USER_MEDIA_DIR แล้ว (อยู่ใน public/images/sounds เสมอ)
// ต้องชี้ไปโฟลเดอร์ว่างเอง ไม่งั้นเทสต์ "ไม่มีไฟล์เสียงเลย" จะไปเจอไฟล์จริงของคนพัฒนา
process.env.ROV_USER_SOUND_DIR = path.join(TMP, 'sounds');
process.env.CONTROL_TOKEN = '';

// ต้อง import หลังตั้ง env เท่านั้น
const { createApp } = require('../server/index') as typeof import('../server/index');
const { closeDatabase } = require('../server/store/db') as typeof import('../server/store/db');
const { PAGES } = require('../server/http/pages') as typeof import('../server/http/pages');

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
  for (const url of ['/result', '/overlay-teams', '/overlay-analytics']) {
    const html = String((await request('GET', url)).body);
    assert.ok(!html.includes('overlay-sfx.js'), `${url} must not play sound too`);
  }

  // โฟลเดอร์เสียงยังไม่มีไฟล์ ต้องได้ 404 เปล่าๆ ไม่ใช่ 500
  assert.strictEqual((await request('GET', '/sounds/pick.mp3')).status, 404);
});

// คู่มืออยู่ในแอพ ไม่ใช่ในโฟลเดอร์ docs
//
// เหตุผลที่ต้องอยู่ในแอพ: เวลาที่คนต้องการคู่มือคือตอนยืนงงอยู่หน้างาน
// ซึ่งไม่มีใครไปเปิดไฟล์ .md และอาจไม่มีเน็ตด้วย
// เนื้อหาสองภาษาต้องอยู่ในหน้าเลยทั้งคู่ ไม่ใช่โหลดทีหลัง
// ปุ่มสลับภาษาแค่ซ่อน/แสดง คู่มือจึงอ่านได้แม้ JS จะพัง
test('the guide ships inside the app, in both languages, without needing the network', async () => {
  const page = await request('GET', '/guide');
  assert.strictEqual(page.status, 200);

  const html = String(page.body);
  assert.ok(html.includes('/js/guide.js'), 'serves its own script');
  assert.ok(html.includes('/css/theme.css'), 'uses the shared theme');

  // ทั้งสองภาษาต้องอยู่ในไฟล์ ไม่ได้ไปดึงมาทีหลัง
  assert.ok(html.includes('data-lang="en"'), 'carries the English copy');
  assert.ok(html.includes('data-lang="th"'), 'carries the Thai copy');
  assert.ok(html.includes('เปิดโปรแกรม'), 'the Thai copy is real text, not a placeholder');

  // ห้ามพึ่งอะไรจากอินเทอร์เน็ต แอพนี้ใช้แบบออฟไลน์
  assert.ok(!/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(html), 'no external resources');
});

// แถบเมนูต้องเหมือนกันทุกหน้า ทั้งรายการและลำดับ
//
// จุดประสงค์คือปุ่มเดิมอยู่ที่เดิมเสมอ คนคุมงานจะได้กดโดยไม่ต้องอ่าน
// ของจริงเคยหลุด: หน้า Control ขาดลิงก์ ANALYTICS อยู่พักหนึ่งโดยไม่มีใครสังเกต
// และตอนถอดพรีเซ็ตออกก็ต้องแก้ทุกหน้าพร้อมกัน ลืมหน้าเดียวก็เหลือลิงก์ตายไว้
test('every operator page carries the same page nav, in the same order', async () => {
  const expected = ['/', '/teams', '/analytics', '/control', '/design', '/hotkeys', '/guide'];
  const pages = [
    '/', '/teams', '/teams/anything', '/tournament/anything',
    '/tournament/anything/bracket', '/tournament/anything/drafts', '/analytics', '/control', '/design', '/hotkeys', '/guide'
  ];

  for (const url of pages) {
    const html = String((await request('GET', url)).body);
    const start = html.indexOf('<nav class="topnav"');
    assert.ok(start > -1, `${url} has a page nav`);
    const nav = html.slice(start, html.indexOf('</nav>', start));
    const hrefs = [...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepStrictEqual(hrefs, expected, `${url} nav`);

    // ลิงก์ทุกอันต้องแปลได้ ไม่ใช่แค่เรียงถูก
    //
    // /guide เคยไม่มี data-i18n สักอันในแถบเมนู หน้านั้นจึงขึ้นเป็นภาษาอังกฤษ
    // ตลอดไม่ว่าจะเลือกภาษาอะไรไว้ อาการที่คนใช้เห็นคือ "พอเข้าคู่มือ
    // แถบบนเด้งกลับเป็นอังกฤษ" ซึ่งอ่านเหมือนของเสีย ไม่ใช่เหมือนยังไม่ได้แปล
    // เทสต์เดิมตรวจแค่ href กับลำดับ จึงมองไม่เห็นช่องนี้เลย
    const links = [...nav.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
    assert.strictEqual(links.length, expected.length, `${url} nav link count`);
    links.forEach((tag) => {
      assert.ok(
        /\sdata-i18n(\s|=|>)/.test(tag),
        `${url}: a nav link is not translatable - ${tag}`
      );
    });
  }
});

// เส้นแบ่งระหว่าง "หน้าคนคุมงาน" กับ "กราฟิกออกอากาศ" เป็นเรื่องของธีมด้วย
//
// หน้าคนคุมงานใช้ธีมกลางร่วมกันหมด ส่วนหน้าที่ออกอากาศมีหน้าตาของตัวเอง
// ที่ผู้ใช้ตั้งเองจากหน้า Design ถ้าวันหนึ่งมีใครลิงก์ theme.css เข้าไปในหน้า
// ออกอากาศ การแก้สีในแอปจะไปเปลี่ยนสิ่งที่คนดูเห็นกลางถ่ายทอดสดโดยไม่มีใครตั้งใจ
test('operator pages share the theme and broadcast pages keep their own look', async () => {
  const operator = [
    '/', '/teams', '/teams/anything', '/tournament/anything',
    '/tournament/anything/bracket', '/tournament/anything/drafts', '/analytics',
    '/control', '/design', '/hotkeys', '/guide'
  ];
  for (const url of operator) {
    const html = String((await request('GET', url)).body);
    assert.ok(html.includes('/css/theme.css'), `${url} links the shared theme`);
  }

  // รายการหน้าออกอากาศดึงมาจาก PAGES เอง ไม่ได้พิมพ์ทิ้งไว้
  //
  // ของเดิมเป็นรายการตายตัวห้าหน้า หน้าออกอากาศที่เพิ่มมาทีหลังจึงไม่เคยถูกตรวจเลย
  // ซึ่งเป็นความผิดพลาดที่มองไม่เห็น: เทสต์ยังเขียว ส่วนหน้าใหม่ที่เผลอลิงก์
  // theme.css เข้าไปก็หลุดออกอากาศไปพร้อมกับสีของหน้าคนคุมงาน
  const broadcast = Object.keys(PAGES).filter((route) => (
    route.startsWith('/overlay') || route === '/result'
  ));
  assert.ok(broadcast.length >= 7, 'every overlay- route is checked, not a list somebody has to remember');

  // ดูที่แท็กจริง ไม่ใช่ที่ข้อความดิบทั้งไฟล์
  //
  // หน้าออกอากาศมักมีคอมเมนต์เตือนไว้ว่า "ห้ามลิงก์ theme.css" ซึ่งเป็นสิ่งที่
  // อยากให้มี การเทียบข้อความดิบจะทำให้คอมเมนต์นั้นเองทำให้เทสต์ตก
  // แล้วทางแก้ที่ง่ายที่สุดคือลบคอมเมนต์ทิ้ง ซึ่งตรงข้ามกับที่เทสต์นี้ต้องการ
  const links = (html: string) => [...html.matchAll(/<link\b[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  const scripts = (html: string) => [...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map((m) => m[1]);

  for (const url of broadcast) {
    const html = String((await request('GET', url)).body);
    assert.ok(
      !links(html).some((href) => href.includes('theme.css')),
      `${url} must not take the operator theme`
    );
    // แปลภาษาก็เป็นของหน้าคนคุมงานเหมือนกัน สิ่งที่คนดูเห็นเป็นอังกฤษเสมอ
    assert.ok(
      !scripts(html).some((src) => src.includes('i18n.js')),
      `${url} must not take the operator translator`
    );
  }
});

// กระดานดราฟต์ย้อนหลังเป็นสองหน้า แต่เป็นสคริปต์ตัวเดียวกัน
//
// สิ่งเดียวที่แยกสองหน้านี้ออกจากกันคือ <body data-kind> ถ้ามันหายหรือสะกดผิด
// ทั้งสองหน้าจะกลายเป็นหน้าพิคเหมือนกันหมด (ค่าตั้งต้นของสคริปต์) ซึ่งอ่านออกยาก
// เพราะหน้าแบนจะขึ้นข้อมูลจริงๆ แค่เป็นข้อมูลผิดชุด
test('the previous-draft board is one page, and the split pages are gone', async () => {
  const html = String((await request('GET', '/overlay-prev')).body);
  assert.ok(html.includes('/js/overlay-prev.js'), 'it loads its script');
  // overlay-prev.js ประกาศ const socket ที่ overlay-size.js ไปอ่าน ลำดับจึงสลับไม่ได้
  assert.ok(
    html.indexOf('/js/overlay-prev.js') < html.indexOf('/js/overlay-size.js'),
    'overlay-prev.js loads before overlay-size.js, which reads its socket'
  );

  // สองหน้าเดิมถูกลบทิ้งตามที่ผู้ใช้สั่ง ต้องตอบ 404 ไม่ใช่หน้าเปล่า
  // และต้องไม่งอกกลับมาเงียบๆ ทั้งใน PAGES และในไฟล์
  for (const gone of ['/overlay-prev-picks', '/overlay-prev-bans']) {
    assert.strictEqual((await request('GET', gone)).status, 404, `${gone} is gone`);
    assert.ok(!Object.prototype.hasOwnProperty.call(PAGES, gone), `${gone} has no route`);
  }

  // และมีแถวเดียวในรายการ browser source
  const sources = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'js', 'lib', 'obs-sources.js'), 'utf8'
  );
  const rows = [...sources.matchAll(/path: '([^']+)'/g)]
    .map((m) => String(m[1]))
    .filter((route) => route.startsWith('/overlay-prev'));
  assert.deepStrictEqual(rows, ['/overlay-prev'], 'only the merged board is listed');
});

// หน้าที่แสดงรายการ browser source ต้องโหลด obs-sources.js ก่อนสคริปต์ของตัวเอง
//
// ทั้งสองหน้าเรียก window.RovObsSources ตอนวาดหน้า ลืมแท็กนี้ = หน้าตายทั้งหน้า
// และตัวโมดูลเองอ่าน window.RovClient ตอนโหลด จึงต้องมาหลัง app-client.js ด้วย
test('every page that lists OBS sources loads the shared module in the right order', async () => {
  // หน้า Control ที่เดียว หน้าทัวร์นาเมนต์เคยแสดงรายการนี้ด้วย
  // ผู้ใช้สั่งเอาออก 2026-09-08 พร้อมกับการลบสองหน้าดราฟต์ที่แยกพิค/แบน
  const pages = [
    { url: '/control', script: 'js/control.js' }
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

// ทุก URL ในรายการ browser source ต้องเปิดได้จริง
//
// รายการนี้คือสิ่งที่คนใช้ก๊อปไปวางใน OBS โดยไม่เคยเปิดดูในเบราว์เซอร์ก่อน
// path ที่พิมพ์ผิดหนึ่งตัวจะกลายเป็น browser source ที่ว่างเปล่าอยู่ในฉาก
// ซึ่งอ่านไม่ออกว่าเป็นการพิมพ์ผิด มันอ่านเหมือนฟีเจอร์นั้นพัง
//
// เดิมมีเทสต์ที่เช็คทีละแถวเฉพาะแถวที่มีคนนึกได้ (กระดานสถิติ ดราฟต์รอบก่อน)
// แถวที่เพิ่มมาทีหลังจึงไม่เคยถูกตรวจเลย ตัวนี้ดึงรายการมาจากไฟล์เอง
test('every URL in the OBS source list opens', async () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'js', 'lib', 'obs-sources.js'), 'utf8'
  );

  const paths = [...source.matchAll(/path: '([^']+)'/g)].map((m) => String(m[1]));
  assert.ok(paths.length >= 8, 'the list was read, not silently matched to nothing');

  for (const route of paths) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(PAGES, route),
      `${route} is a real page route`
    );
    const { status } = await request('GET', route);
    assert.strictEqual(status, 200, `${route} is served`);
  }

  // แถวที่มีพารามิเตอร์ประจำตัวต้องเป็นคู่ key=value ไม่ใช่คำลอยๆ
  // เขียนผิดแล้วหน้าปลายทางจะเงียบๆ ใช้ค่าเริ่มต้น ซึ่งดูเหมือนทำงานอยู่
  //
  // ตอนนี้ไม่มีแถวไหนใช้ query: แล้ว (Most picked / Most banned ถูกเอาออก)
  // จึงไม่บังคับว่าต้องมีอย่างน้อยหนึ่งแถว ด่านนี้รอไว้เฉยๆ เผื่อมีคนเติมกลับเข้ามา
  const pairs = [...source.matchAll(/query: \[([^\]]*)\]/g)]
    .flatMap((m) => String(m[1]).split(',').map((s) => s.trim().replace(/'/g, '')))
    .filter(Boolean);
  pairs.forEach((pair) => {
    assert.match(pair, /^[a-z][a-zA-Z0-9]*=[^=&\s]+$/, `${pair} is a key=value pair`);
  });
});

// กราฟิกที่วาดรูปฮีโร่ ต้องโหลด hero-art.js ก่อนสคริปต์ของตัวเอง
//
// ลืมแท็กแล้วหน้าจะโยน ReferenceError กลางการวาด ผลไม่ใช่ "ไม่มีรูป"
// แต่คือกระดานค้างอยู่ครึ่งเดียวบนออกอากาศ (กฎเดียวกับ overlay-sfx.js)
//
// และห้ามใช้ /images/heroes/ ตรงๆ อีก ช่องพวกนี้เป็นสี่เหลี่ยมจัตุรัสเล็ก
// รูปเต็มตัวย่อลงมาจะเหลือแต่ไหล่ ทางเลือกโฟลเดอร์อยู่ใน hero-art.js ที่เดียว
test('the graphics that draw heroes load the shared art helper first', async () => {
  const pages: Record<string, string> = {
    '/overlay-analytics': 'overlay-analytics.js',
    '/overlay-prev': 'overlay-prev.js',
    '/overlay-matchup': 'overlay-matchup.js',
    '/overlay-team-drafts': 'overlay-team-drafts.js'
  };

  for (const [url, own] of Object.entries(pages)) {
    const html = String((await request('GET', url)).body);

    const libAt = html.indexOf('/js/lib/hero-art.js');
    assert.ok(libAt > -1, `${url} loads hero-art.js`);
    assert.ok(
      libAt < html.indexOf(`/js/${own}`),
      `${url} loads hero-art.js before ${own}, which calls it`
    );

    // กราฟิกออกอากาศ ตัวช่วยนี้ต้องไม่ลากธีมหรือตัวแปลเข้ามาด้วย
    //
    // ดูที่แท็กจริง ไม่ใช่ข้อความดิบ หน้าพวกนี้มีคอมเมนต์เตือนว่า "ห้ามลิงก์
    // theme.css" อยู่ในหัวไฟล์ การเทียบข้อความดิบจะทำให้คอมเมนต์นั้นเองทำให้เทสต์ตก
    // แล้วทางแก้ที่ง่ายที่สุดคือลบคอมเมนต์ทิ้ง ซึ่งตรงข้ามกับที่ต้องการ
    const hrefs = [...html.matchAll(/<link\b[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(
      !hrefs.some((href) => String(href).includes('theme.css')),
      `${url} is still a broadcast graphic`
    );
  }

  const helper = fs.readFileSync(
    path.join(__dirname, '..', '..', 'public', 'js', 'lib', 'hero-art.js'), 'utf8'
  );
  assert.ok(helper.includes('heroes-icons'), 'the helper knows about the icon folder');

  // ไฟล์ที่ใช้ helper แล้ว ต้องไม่มี path ของรูปฮีโร่เขียนไว้เองอีก
  for (const own of new Set(Object.values(pages))) {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'public', 'js', own), 'utf8'
    );
    const codeOnly = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    assert.ok(
      !codeOnly.includes('/images/heroes'),
      `${own} picks its folder through hero-art.js, not by hand`
    );
  }
});

// ตัวช่วยที่กราฟิกออกอากาศใช้ร่วมกัน ต้องมีชุดเดียว
//
// เคยมี intParam กับ note คัดลอกไว้หน้าละชุด รวมหกชุดต่อฟังก์ชัน ตอนนั้นยังเหมือนกัน
// ทุกตัวอักษร แต่เพื่อนบ้านของมันไม่ใช่: settleSoon มีหกชุดต่างกันห้าแบบ
// และ fitToStage มีสี่ชุดต่างกันทั้งสี่ ซึ่งซ่อนบั๊กจริงไว้หนึ่งตัว
// (/overlay-standings วัดจากขอบกล่องแทนขอบการ์ด ทั้งที่อีกสามหน้าแก้ไปแล้ว)
//
// เทสต์นี้กันไม่ให้สองตัวที่รวมแล้วแตกกลับออกไปอีก
test('the shared overlay helpers have exactly one home', async () => {
  const pages: Record<string, string> = {
    '/overlay-analytics': 'overlay-analytics.js',
    '/overlay-matchup': 'overlay-matchup.js',
    '/overlay-prev': 'overlay-prev.js',
    '/overlay-standings': 'overlay-standings.js',
    '/overlay-team-drafts': 'overlay-team-drafts.js',
    '/overlay-teams': 'overlay-teams.js'
  };

  for (const [url, own] of Object.entries(pages)) {
    const html = String((await request('GET', url)).body);
    const libAt = html.indexOf('/js/lib/overlay-common.js');
    assert.ok(libAt > -1, `${url} loads overlay-common.js`);
    assert.ok(libAt < html.indexOf(`/js/${own}`), `${url} loads it before ${own}, which calls it`);

    // และหน้านั้นต้องไม่ประกาศของตัวเองซ้ำอีก
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'public', 'js', own), 'utf8'
    );
    const codeOnly = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    for (const fn of ['function intParam(', 'function note(']) {
      assert.ok(!codeOnly.includes(fn), `${own} uses the shared ${fn.slice(9, -1)}, not its own`);
    }
  }
});

// body ที่แยกวิเคราะห์ไม่ได้ ต้องตอบเป็น JSON เหมือน endpoint อื่นทุกตัว
//
// express.json() ปฏิเสธ body ที่ไม่ใช่ JSON ตั้งแต่ก่อนถึง route แล้วตกไปที่
// ตัวจับ error ปริยายของ express ซึ่งตอบเป็น HTML พร้อม stack trace เต็มๆ
// สองอย่างที่เสียไป: fetchJson ฝั่งหน้าเว็บอ่าน data.error ไม่เจอ เลยโชว์
// "Bad Request" ลอยๆ แทนเหตุผลจริง และเนื้อหาที่ตอบมี path เต็มของเครื่องที่รันอยู่
// (ค่าเริ่มต้นผูกที่ 127.0.0.1 ก็จริง แต่ HOST ตั้งทับได้จาก env)
test('a body that cannot be parsed answers in JSON, without a stack trace', async () => {
  const reply: { status: number; type: string; body: string } = await new Promise((resolve) => {
    const req = http.request(`${base}/api/tournaments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        type: String(res.headers['content-type'] || ''),
        body: Buffer.concat(chunks).toString()
      }));
    });
    req.write('{not json');
    req.end();
  });

  assert.strictEqual(reply.status, 400);
  assert.match(reply.type, /application\/json/, 'same content type as every other endpoint');

  const parsed = JSON.parse(reply.body);
  assert.ok(parsed.error, 'carries an error field, which is what fetchJson reads');

  // ห้ามมีร่องรอยของ stack trace: ชื่อไฟล์ เลขบรรทัด หรือ path ของเครื่อง
  assert.ok(!/\.(js|ts):\d+/.test(reply.body), 'no file:line in the response');
  assert.ok(!/node_modules/.test(reply.body), 'no module paths in the response');
  assert.ok(!/SyntaxError/.test(reply.body), 'no internal exception name in the response');
});
