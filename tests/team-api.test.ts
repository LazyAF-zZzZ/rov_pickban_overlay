// เทสต์ HTTP ของทะเบียนทีมและ roster ของทัวร์นาเมนต์
//
// ตั้ง env ก่อน import อะไรก็ตาม เพราะ config อ่านตอน import
// ถ้าตั้งทีหลังจะไปเขียนทับข้อมูลจริงของผู้ใช้

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-team-test-'));
process.env.ROV_USER_DATA_DIR = path.join(TMP, 'data');
process.env.ROV_USER_MEDIA_DIR = path.join(TMP, 'media');
process.env.CONTROL_TOKEN = '';

const { createApp } = require('../server/index') as typeof import('../server/index');
const { closeDatabase } = require('../server/store/db') as typeof import('../server/store/db');
const { MAX_TEAMS } = require('../server/domain/tournament') as typeof import('../server/domain/tournament');

const app = createApp();
let server: http.Server;
let base = '';

interface Reply { status: number; body: any }

function send(method: string, url: string, payload?: unknown, raw?: { body: Buffer; type: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    let data: Buffer | null = null;
    const headers: Record<string, string> = {};
    if (raw) {
      data = raw.body;
      headers['content-type'] = raw.type;
      headers['content-length'] = String(raw.body.length);
    } else if (payload !== undefined) {
      data = Buffer.from(JSON.stringify(payload));
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(data.length);
    }

    const req = http.request(`${base}${url}`, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let body: any = null;
        try { body = JSON.parse(text); } catch { body = text; }
        resolve({ status: res.statusCode || 0, body });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7)
]);
const NOT_PNG = Buffer.concat([Buffer.from('NOPE'), Buffer.alloc(64, 1)]);

async function newTeam(name: string): Promise<string> {
  const res = await send('POST', '/api/teams', { name });
  assert.strictEqual(res.status, 200, `creating ${name}: ${JSON.stringify(res.body)}`);
  return res.body.team.id;
}

async function newTournament(format = 'single_elim'): Promise<string> {
  const res = await send('POST', '/api/tournaments', { name: `Cup ${format}`, format });
  assert.strictEqual(res.status, 200);
  return res.body.tournament.id;
}

test.before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      resolve();
    });
  });
});

test.after(() => {
  server?.close();
  closeDatabase();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ระบบเก็บเอง */ }
});

test('a team round-trips through the API with its roster', async () => {
  const created = await send('POST', '/api/teams', {
    name: 'Buriram United',
    tag: 'BRU',
    players: [{ name: 'ZHAN', role: 'jungle', isCaptain: true }, { name: 'WETZ' }]
  });
  assert.strictEqual(created.status, 200);
  const id = created.body.team.id;

  const read = await send('GET', `/api/teams/${id}`);
  assert.strictEqual(read.body.team.name, 'Buriram United');
  assert.strictEqual(read.body.team.players.length, 5, 'always five slots');
  assert.strictEqual(read.body.team.players[0].isCaptain, true);
  assert.deepStrictEqual(read.body.team.logo, { v: 0, ext: '' }, 'no logo yet');

  const updated = await send('PUT', `/api/teams/${id}`, {
    name: 'Buriram', tag: 'BRU', players: [{ name: 'ZHAN' }, { name: 'NEW GUY' }]
  });
  assert.strictEqual(updated.body.team.name, 'Buriram');
  assert.strictEqual(updated.body.team.players[1].name, 'NEW GUY');
});

// ทางที่มาแทนพรีเซ็ต: หยิบทีมจากทะเบียนขึ้นจอทีละฝั่ง โดยไม่ต้องมีทัวร์นาเมนต์
//
// ที่ต้องมีเทสต์คือ "แตะแค่ฝั่งเดียว" ถ้าเผลอเขียนทับทั้ง state
// คนคุมงานจะเลือกทีมฝั่งที่สองแล้วเห็นฝั่งแรกกับดราฟต์ที่กรอกไว้หายไปกลางงาน
test('a registry team can be loaded onto one side without touching the other', async () => {
  const blue = (await send('POST', '/api/teams', {
    name: 'Talon', players: [{ name: 'ZHAN' }, { name: 'WETZ' }]
  })).body.team;
  const red = (await send('POST', '/api/teams', { name: 'Bacon Time' })).body.team;

  const first = await send('POST', `/api/teams/${blue.id}/live`, { team: 'teamBlue' });
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.body.state.teamBlue.name, 'Talon');
  assert.deepStrictEqual(
    first.body.state.teamBlue.players.slice(0, 2),
    ['ZHAN', 'WETZ'],
    'the roster comes with the name'
  );

  const second = await send('POST', `/api/teams/${red.id}/live`, { team: 'teamRed' });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.state.teamRed.name, 'Bacon Time');
  assert.strictEqual(second.body.state.teamBlue.name, 'Talon', 'the other side is untouched');
});

test('loading a team onto the overlay refuses a bad side or a missing team', async () => {
  const team = (await send('POST', '/api/teams', { name: 'Buriram' })).body.team;
  assert.strictEqual((await send('POST', `/api/teams/${team.id}/live`, { team: 'teamGreen' })).status, 400);
  assert.strictEqual((await send('POST', '/api/teams/nope/live', { team: 'teamBlue' })).status, 404);
});

// พรีเซ็ตถูกถอดออกแล้ว ทะเบียนทีมทำหน้าที่นี้แทน
// เทสต์นี้กันการเผลอเอากลับมาครึ่งทาง: หน้าเว็บหาย แต่ API ยังเปิดอยู่เงียบๆ
test('the presets feature is gone, page and API alike', async () => {
  assert.strictEqual((await send('GET', '/presets')).status, 404);
  assert.strictEqual((await send('GET', '/api/presets')).status, 404);
  assert.strictEqual((await send('POST', '/api/presets', { name: 'x' })).status, 404);
  assert.strictEqual((await send('POST', '/api/presets/load', { name: 'x' })).status, 404);

  const home = String((await send('GET', '/')).body);
  assert.ok(!home.includes('/presets'), 'no page still links to it');
});

// ลบหลายทีมพร้อมกัน
//
// ที่ต้องมีเทสต์คือ "ลบเฉพาะที่เลือก" ถ้าพลาดตรงนี้คือลบทะเบียนทีมทิ้งทั้งชุด
// ซึ่งกู้คืนไม่ได้ และคนจะรู้ตัวตอนเปิดทัวร์นาเมนต์ถัดไปแล้วทีมหายหมด
test('bulk delete removes exactly the teams asked for, and nothing else', async () => {
  const made: string[] = [];
  for (const name of ['Bulk A', 'Bulk B', 'Bulk C', 'Bulk D']) {
    made.push((await send('POST', '/api/teams', { name })).body.team.id);
  }

  const doomed = [made[0], made[2]];
  const result = await send('POST', '/api/teams/bulk-delete', { ids: doomed });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.removed, 2);
  assert.strictEqual(result.body.missing, 0);

  const left = (await send('GET', '/api/teams')).body.teams.map((t: any) => t.id);
  assert.ok(!left.includes(made[0]), 'the first chosen team is gone');
  assert.ok(!left.includes(made[2]), 'the second chosen team is gone');
  assert.ok(left.includes(made[1]), 'a team that was not chosen survives');
  assert.ok(left.includes(made[3]), 'and so does the other one');
});

// id ที่หาไม่เจอไม่ใช่ความผิดพลาด อีกจอหนึ่งอาจลบตัดหน้าไปแล้ว
// เป้าหมายคือ "ทีมพวกนี้ต้องไม่อยู่" ซึ่งก็บรรลุอยู่ดี
test('bulk delete counts ids that were already gone instead of failing', async () => {
  const team = (await send('POST', '/api/teams', { name: 'Half Gone' })).body.team;

  const result = await send('POST', '/api/teams/bulk-delete', { ids: [team.id, 'nope', 'also-nope'] });
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.body.removed, 1);
  assert.strictEqual(result.body.missing, 2);
});

test('bulk delete refuses an empty selection rather than doing nothing quietly', async () => {
  assert.strictEqual((await send('POST', '/api/teams/bulk-delete', { ids: [] })).status, 400);
  assert.strictEqual((await send('POST', '/api/teams/bulk-delete', {})).status, 400);
  assert.strictEqual((await send('POST', '/api/teams/bulk-delete', { ids: 'all' })).status, 400);
});

// ลบทีมทิ้งต้องพาออกจากทัวร์นาเมนต์ที่ลงไว้ด้วย เหมือนการลบทีละใบ
test('teams deleted in bulk also leave the tournaments they had entered', async () => {
  const cup = (await send('POST', '/api/tournaments', {
    name: 'Bulk Cup', format: 'single_elim', bestOf: 3
  })).body.tournament;

  const ids: string[] = [];
  for (const name of ['Roster One', 'Roster Two']) {
    const team = (await send('POST', '/api/teams', { name })).body.team;
    ids.push(team.id);
    await send('POST', `/api/tournaments/${cup.id}/teams`, { teamId: team.id });
  }
  assert.strictEqual((await send('GET', `/api/tournaments/${cup.id}/teams`)).body.teams.length, 2);

  await send('POST', '/api/teams/bulk-delete', { ids });
  assert.strictEqual(
    (await send('GET', `/api/tournaments/${cup.id}/teams`)).body.teams.length,
    0,
    'the roster empties with them'
  );
});

test('a team needs a name', async () => {
  const res = await send('POST', '/api/teams', { name: '  ' });
  assert.strictEqual(res.status, 400);
  assert.match(res.body.error, /name is required/i);
});

// ---- TEST GOAL 1 ผ่าน HTTP: ห้ามเกิน 128 ทีมต่อทัวร์นาเมนต์ ----

test('the API refuses the 129th team with 409, and the count does not move', async () => {
  const tid = await newTournament('single_elim');

  // สร้างทีมล่วงหน้าให้ครบ แล้วค่อยใส่ทีละตัว
  const ids: string[] = [];
  for (let i = 0; i < MAX_TEAMS + 1; i += 1) ids.push(await newTeam(`T${i}`));

  for (let i = 0; i < MAX_TEAMS; i += 1) {
    const res = await send('POST', `/api/tournaments/${tid}/teams`, { teamId: ids[i] });
    assert.strictEqual(res.status, 200, `team ${i + 1}: ${JSON.stringify(res.body)}`);
  }

  const before = (await send('GET', `/api/tournaments/${tid}`)).body.tournament.teamCount;
  assert.strictEqual(before, MAX_TEAMS);

  const overflow = await send('POST', `/api/tournaments/${tid}/teams`, { teamId: ids[MAX_TEAMS] });
  assert.strictEqual(overflow.status, 409, 'full is a conflict, not a bad request');
  assert.match(overflow.body.error, /full|max/i);
  assert.strictEqual(overflow.body.limit, MAX_TEAMS, 'the cap is reported back');

  const after = (await send('GET', `/api/tournaments/${tid}`)).body.tournament.teamCount;
  assert.strictEqual(after, MAX_TEAMS, 'count unchanged after the refusal');
});

test('round robin refuses past its own lower cap', async () => {
  const tid = await newTournament('round_robin');
  const ids: string[] = [];
  for (let i = 0; i < 25; i += 1) ids.push(await newTeam(`RR${i}`));

  for (let i = 0; i < 24; i += 1) {
    assert.strictEqual((await send('POST', `/api/tournaments/${tid}/teams`, { teamId: ids[i] })).status, 200);
  }
  const overflow = await send('POST', `/api/tournaments/${tid}/teams`, { teamId: ids[24] });
  assert.strictEqual(overflow.status, 409);
  assert.strictEqual(overflow.body.limit, 24);
});

test('the same team cannot be added twice', async () => {
  const tid = await newTournament();
  const id = await newTeam('Solo');
  assert.strictEqual((await send('POST', `/api/tournaments/${tid}/teams`, { teamId: id })).status, 200);
  const again = await send('POST', `/api/tournaments/${tid}/teams`, { teamId: id });
  assert.strictEqual(again.status, 400, 'a duplicate is a bad request, not a full tournament');
});

test('removing a team from a tournament leaves it in the registry', async () => {
  const tid = await newTournament();
  const id = await newTeam('Stays');
  await send('POST', `/api/tournaments/${tid}/teams`, { teamId: id });

  const removed = await send('DELETE', `/api/tournaments/${tid}/teams/${id}`);
  assert.strictEqual(removed.status, 200);
  assert.strictEqual(removed.body.teamCount, 0);
  assert.strictEqual((await send('GET', `/api/teams/${id}`)).status, 200, 'still in the registry');
});

test('deleting a team from the registry pulls it out of every tournament', async () => {
  const a = await newTournament();
  const b = await newTournament('double_elim');
  const id = await newTeam('Everywhere');
  await send('POST', `/api/tournaments/${a}/teams`, { teamId: id });
  await send('POST', `/api/tournaments/${b}/teams`, { teamId: id });

  assert.strictEqual((await send('DELETE', `/api/teams/${id}`)).status, 200);
  assert.strictEqual((await send('GET', `/api/tournaments/${a}`)).body.tournament.teamCount, 0);
  assert.strictEqual((await send('GET', `/api/tournaments/${b}`)).body.tournament.teamCount, 0);
  assert.strictEqual((await send('GET', `/api/teams/${id}`)).status, 404);
});

test('seeds control the order teams come back in', async () => {
  const tid = await newTournament();
  const first = await newTeam('Alpha');
  const second = await newTeam('Beta');
  await send('POST', `/api/tournaments/${tid}/teams`, { teamId: first });
  await send('POST', `/api/tournaments/${tid}/teams`, { teamId: second });

  await send('PUT', `/api/tournaments/${tid}/teams/${first}/seed`, { seed: 9 });
  const teams = (await send('GET', `/api/tournaments/${tid}/teams`)).body.teams;
  assert.deepStrictEqual(teams.map((t: any) => t.name), ['Beta', 'Alpha']);
});

// ---- LOGO ----

test('a team logo is stored under the team id, never the team name', async () => {
  const id = await newTeam('../../evil name');

  const up = await send('POST', `/api/teams/${id}/logo`, undefined, { body: PNG, type: 'image/png' });
  assert.strictEqual(up.status, 200);
  assert.strictEqual(up.body.team.logo.ext, 'png');
  assert.ok(up.body.team.logo.v > 0, 'version stamped for cache busting');

  const files = fs.readdirSync(path.join(TMP, 'media', 'team-logos'));
  assert.ok(files.includes(`${id}.png`), `saved as ${id}.png, got ${files.join(', ')}`);
  assert.ok(
    files.every((f) => /^[a-z0-9][a-z0-9-]*\.(png|jpg|webp)$/.test(f)),
    'no file name derived from the typed team name'
  );

  const cleared = await send('DELETE', `/api/teams/${id}/logo`);
  assert.strictEqual(cleared.body.team.logo.v, 0);
  assert.ok(!fs.readdirSync(path.join(TMP, 'media', 'team-logos')).includes(`${id}.png`));
});

test('a logo upload must really be the type it claims', async () => {
  const id = await newTeam('Liar');
  const bad = await send('POST', `/api/teams/${id}/logo`, undefined, { body: NOT_PNG, type: 'image/png' });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.body.error, /do not match/i);

  const wrongType = await send('POST', `/api/teams/${id}/logo`, undefined, { body: PNG, type: 'image/gif' });
  assert.strictEqual(wrongType.status, 415);
});

test('logo endpoints 404 for an unknown team', async () => {
  assert.strictEqual(
    (await send('POST', '/api/teams/nope/logo', undefined, { body: PNG, type: 'image/png' })).status,
    404
  );
  assert.strictEqual((await send('DELETE', '/api/teams/nope/logo')).status, 404);
});

// ---- ทะเบียนทีม: ประวัติและหน้าเว็บ ----

test('the history endpoint carries the team alongside its record', async () => {
  const id = await newTeam('Historian');

  const { status, body } = await send('GET', `/api/teams/${id}/history`);
  assert.strictEqual(status, 200);
  assert.strictEqual(body.team.name, 'Historian', 'the page needs the team itself, not a second call');
  assert.deepStrictEqual(body.matches, []);
  assert.deepStrictEqual(body.tournaments, []);
  assert.strictEqual(body.record.played, 0);
});

test('the history endpoint 404s for an unknown team', async () => {
  const res = await send('GET', '/api/teams/nope/history');
  assert.strictEqual(res.status, 404);
  assert.match(res.body.error, /not found/i);
});

test('summaries come back for the whole registry in one call', async () => {
  const tid = await newTournament();
  const id = await newTeam('Counted');
  await send('POST', `/api/tournaments/${tid}/teams`, { teamId: id });

  const { status, body } = await send('GET', '/api/team-summaries');
  assert.strictEqual(status, 200);
  const mine = body.summaries.find((s: any) => s.teamId === id);
  assert.ok(mine, 'a team that entered a tournament has a summary');
  assert.strictEqual(mine.tournaments, 1);
  assert.strictEqual(mine.won, 0);
});

test('the team directory and profile pages are served with absolute asset paths', async () => {
  const directory = await send('GET', '/teams');
  assert.strictEqual(directory.status, 200);
  assert.ok(String(directory.body).includes('/js/teams.js'), 'serves the directory page');

  // /teams/:id ลึกกว่าหน้าอื่นหนึ่งชั้นเหมือน /tournament/:id
  // path สัมพัทธ์จะไปโผล่ที่ /teams/js/... แล้ว 404 เงียบๆ
  const profile = await send('GET', '/teams/anything');
  assert.strictEqual(profile.status, 200);
  assert.ok(String(profile.body).includes('/js/team.js'), 'serves the profile page');
  assert.ok(!String(profile.body).includes('src="js/'), 'no relative script paths');
  assert.ok(!String(profile.body).includes('href="css/'), 'no relative stylesheet paths');
});

// หน้าที่ใช้ buildPlayerRows ต้องโหลด team-ui.js ก่อนสคริปต์ของตัวเอง
// ลืมแท็กนี้ = หน้าตายตั้งแต่บรรทัด destructure โดยไม่มีอะไรบอกว่าเพราะอะไร
test('every page that builds player rows loads the shared team module', async () => {
  const pages = [
    { url: '/teams', script: '/js/teams.js' },
    { url: '/teams/anything', script: '/js/team.js' },
    { url: '/tournament/anything', script: '/js/tournament.js' },
    // หน้า match session ใช้ badge() กับ on() จากโมดูลเดียวกัน
    { url: '/tournament/anything/bracket', script: '/js/bracket.js' }
  ];

  for (const page of pages) {
    const html = String((await send('GET', page.url)).body);
    const libAt = html.indexOf('/js/lib/team-ui.js');
    assert.ok(libAt > -1, `${page.url} loads team-ui.js`);
    assert.ok(libAt < html.indexOf(page.script), `${page.url} loads it before ${page.script}`);
  }
});

// ---- overlay รายชื่อทีม (Phase 7) ----

test('the team list overlay and the operator team page are different pages', async () => {
  const overlay = await send('GET', '/overlay-teams');
  const operator = await send('GET', '/teams');

  assert.strictEqual(overlay.status, 200);
  assert.strictEqual(operator.status, 200);

  // เคยวางแผนให้ overlay ใช้ /teams (ดู Appendix A ของแผน) แล้ว Phase 6
  // เอา /teams ไปใช้เป็นหน้าคนคุมงานก่อน ถ้าชนกันเมื่อไหร่หน้าหนึ่งจะหายไปเงียบๆ
  assert.ok(String(overlay.body).includes('/js/overlay-teams.js'), 'the overlay serves its own script');
  assert.ok(String(operator.body).includes('/js/teams.js'), 'the operator page is untouched');
  assert.ok(!String(overlay.body).includes('/js/teams.js'), 'the two pages do not share a script');
});

test('the team list overlay is a view-only page: no control token machinery', async () => {
  const html = String((await send('GET', '/overlay-teams')).body);

  // overlay ทุกหน้าต่อ socket เปล่าๆ ไม่ผ่าน app-client.js ซึ่งแนบโทเคนให้
  // ถ้าหลุดเข้ามา หน้าที่เอาไว้โชว์บนสตรีมจะกลายเป็นหน้าที่สั่งงานได้
  assert.ok(!html.includes('app-client.js'), 'no control client on a broadcast page');
  assert.ok(html.includes('/socket.io/socket.io.js'), 'but it still takes state updates');

  // overlay-size.js อ่านตัวแปร socket ที่ overlay-teams.js ประกาศไว้
  // สลับลำดับเมื่อไหร่ ขนาดจอกับภาพพื้นหลังจะหยุดตามค่าที่เลือกไว้
  assert.ok(
    html.indexOf('/js/overlay-teams.js') < html.indexOf('/js/overlay-size.js'),
    'overlay-teams.js is loaded before overlay-size.js reads its socket'
  );
});
