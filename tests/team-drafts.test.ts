// กราฟิก "ฮีโร่ที่สองทีมนี้หยิบ/แบนบ่อยสุดในรายการนี้"
//
// ต่างจาก /api/matchup ตรงขอบเขตการนับ ไม่ใช่ตรงหน้าตา
//   matchup      นับเฉพาะเกมที่สองทีมนี้เจอกันเอง
//   team-drafts  นับทุกเกมของแต่ละทีมในรายการนี้
//
// เทสต์ที่สำคัญที่สุดในไฟล์นี้จึงเป็นตัวที่พิสูจน์ว่าสองอันนี้ให้คำตอบต่างกันจริง
// ถ้าวันหนึ่งมันเท่ากันเสมอ แปลว่าหน้าใหม่ไม่มีเหตุผลที่จะมีอยู่
//
// ตั้ง env ก่อน import อะไรก็ตาม เหตุผลเดียวกับ tournament-api.test.ts

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-team-drafts-'));
process.env.ROV_USER_DATA_DIR = path.join(TMP, 'data');
process.env.ROV_USER_MEDIA_DIR = path.join(TMP, 'media');
process.env.ROV_USER_SOUND_DIR = path.join(TMP, 'sounds');
process.env.CONTROL_TOKEN = '';

const { createApp } = require('../server/index') as typeof import('../server/index');
const { getStores } = require('../server/store/index') as typeof import('../server/store/index');
const { closeDatabase } = require('../server/store/db') as typeof import('../server/store/db');
const { defaultState } = require('../server/domain/match') as typeof import('../server/domain/match');
const { heroesData } = require('../server/domain/heroes') as typeof import('../server/domain/heroes');

const HEROES = heroesData.heroes;

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
  closeDatabase();
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* โฟลเดอร์ชั่วคราวค้างไว้ ระบบจะเก็บเอง */
  }
});

// ดราฟต์หนึ่งเกมลงในแมตช์ที่ระบุ
//
// เขียนผ่าน store โดยตรง ไม่ผ่าน socket
// ของจริงเข้าทาง attachDraftCapture ซึ่งฟัง emitState แต่ตัวที่เขียนจริงคือ
// games.captureDraft ตัวเดียวกันนี้ การจำลอง socket ไม่ได้พิสูจน์อะไรเพิ่ม
//
// ฝั่งต้องอ่านจากสำเนาแช่แข็ง ไม่ใช่ตั้งเอง ไม่งั้น captureDraft จะเห็นว่า
// กระดานเป็นของเกมอื่น (orientation = different) แล้วไม่ยอมเขียน
function draft(
  matchId: string, gameNo: number,
  bluePicks: string[], redPicks: string[],
  blueBans: string[], redBans: string[],
  winner: 'blue' | 'red' | null = null
) {
  const { games } = getStores();
  const first = games.forMatch(matchId)[0];
  assert.ok(first, 'the match already has its frozen game 1');

  const game = games.ensure(matchId, gameNo, {
    blueTeamId: first.blueTeamId, redTeamId: first.redTeamId,
    blueName: first.blueName, redName: first.redName
  });
  games.captureDraft(game.id, {
    ...defaultState,
    teamBlue: { ...defaultState.teamBlue, name: first.blueName, picks: bluePicks, bans: blueBans },
    teamRed: { ...defaultState.teamRed, name: first.redName, picks: redPicks, bans: redBans }
  });
  if (winner) games.setWinner(game.id, winner);
  return { game, blueTeamId: first.blueTeamId, redTeamId: first.redTeamId };
}

// รายการพบกันหมด 3 ทีม = ทุกทีมเจอกันครบ ซึ่งเป็นรูปที่ทำให้
// "เฉพาะคู่นี้" กับ "ทั้งรายการ" ต่างกันได้จริง
async function buildCup(name: string) {
  const cup = (await request('POST', '/api/tournaments', {
    name, format: 'round_robin', bestOf: 3
  })).body.tournament;

  const teams: Record<string, string> = {};
  for (const teamName of ['ALPHA', 'BRAVO', 'CHARLIE']) {
    const team = (await request('POST', '/api/teams', { name: teamName })).body.team;
    teams[teamName] = team.id;
    await request('POST', `/api/tournaments/${cup.id}/teams`, { teamId: team.id });
  }

  const matches = (await request('POST', `/api/tournaments/${cup.id}/matches`, {})).body.matches;
  assert.strictEqual(matches.length, 3, 'three teams meet in three matches');

  // หาแมตช์จากคู่ที่ต้องการ ไม่เดาจากลำดับที่จับสายออกมา
  function matchOf(x: string, y: string) {
    const found = matches.find((m: any) => (
      (m.teamAId === teams[x] && m.teamBId === teams[y])
      || (m.teamAId === teams[y] && m.teamBId === teams[x])
    ));
    assert.ok(found, `${x} vs ${y} was drawn`);
    return found;
  }

  return { cup, teams, matchOf };
}

// ดราฟต์ครบชุดหนึ่งเกม 5 พิค 4 แบนต่อฝั่ง = draft_locked
// analytics นับเฉพาะเกมที่ล็อกแล้ว ดราฟต์ครึ่งเดียวจะไม่ขยับตัวเลขเลย
function full(picks: string[], bans: string[]) {
  assert.strictEqual(picks.length, 5);
  assert.strictEqual(bans.length, 4);
  return { picks, bans };
}

test('the board answers for the two named teams, scoped to the named tournament', async () => {
  const { cup, teams, matchOf } = await buildCup('Scope Cup');

  // ALPHA หยิบ HEROES[0] ในทั้งสองคู่ที่ตัวเองลง
  // BRAVO ไม่เคยหยิบตัวนั้นเลย
  const ab = matchOf('ALPHA', 'BRAVO');
  const ac = matchOf('ALPHA', 'CHARLIE');

  const alpha = full(HEROES.slice(0, 5), HEROES.slice(30, 34));
  const other = full(HEROES.slice(10, 15), HEROES.slice(40, 44));

  // ฝั่งไหนเป็นน้ำเงินขึ้นกับการจับสาย ต้องดูจากสำเนาแช่แข็งแล้วใส่ให้ถูกฝั่ง
  const { games } = getStores();
  function sidesFor(matchId: string, teamId: string) {
    const first = games.forMatch(matchId)[0];
    assert.ok(first);
    return first.blueTeamId === teamId;
  }

  const alphaIsBlueInAB = sidesFor(ab.id, teams.ALPHA!);
  draft(ab.id, 1,
    alphaIsBlueInAB ? alpha.picks : other.picks,
    alphaIsBlueInAB ? other.picks : alpha.picks,
    alphaIsBlueInAB ? alpha.bans : other.bans,
    alphaIsBlueInAB ? other.bans : alpha.bans);

  const alphaIsBlueInAC = sidesFor(ac.id, teams.ALPHA!);
  draft(ac.id, 1,
    alphaIsBlueInAC ? alpha.picks : other.picks,
    alphaIsBlueInAC ? other.picks : alpha.picks,
    alphaIsBlueInAC ? alpha.bans : other.bans,
    alphaIsBlueInAC ? other.bans : alpha.bans);

  const { status, body } = await request(
    'GET',
    `/api/team-drafts?a=${teams.ALPHA}&b=${teams.BRAVO}&tournament=${cup.id}`
  );
  assert.strictEqual(status, 200);

  assert.strictEqual(body.tournament.id, cup.id);
  assert.strictEqual(body.tournament.name, 'Scope Cup');
  assert.strictEqual(body.a.teamId, teams.ALPHA);
  assert.strictEqual(body.a.name, 'ALPHA');
  assert.strictEqual(body.b.name, 'BRAVO');

  assert.strictEqual(body.a.games, 2, 'ALPHA played in both of its matches');
  assert.strictEqual(body.b.games, 1, 'BRAVO only played ALPHA');

  const topPick = body.a.topPicks[0];
  assert.strictEqual(topPick.hero, HEROES[0]);
  assert.strictEqual(topPick.picked, 2, 'counted once per game, not once per slot');
  assert.strictEqual(body.a.topBans[0].hero, HEROES[30]);

  // แบนที่นับคือแบนที่ทีมนั้นเป็นคนกด ไม่ใช่แบนที่โดนใส่
  // (หน้าเว็บเขียนว่า "Most banned by them" ตามนี้)
  assert.ok(
    body.a.topBans.every((h: any) => !alpha.picks.includes(h.hero)),
    'a ban row never shows what the team picked'
  );

  assert.ok(
    body.b.topPicks.every((h: any) => h.hero !== HEROES[0]),
    'BRAVO never picked ALPHA signature hero'
  );
});

// เหตุผลทั้งหมดที่หน้านี้มีอยู่: คู่ที่ยังไม่เคยเจอกันก็ยังมีอะไรให้ขึ้นจอ
test('it fills a board for two teams that have never met, where head to head is blank', async () => {
  const { cup, teams, matchOf } = await buildCup('First Round Cup');

  // BRAVO กับ CHARLIE ยังไม่ได้เจอกัน แต่ทั้งคู่เคยเล่นกับ ALPHA มาแล้ว
  const ab = matchOf('ALPHA', 'BRAVO');
  const ac = matchOf('ALPHA', 'CHARLIE');
  draft(ab.id, 1, HEROES.slice(0, 5), HEROES.slice(5, 10), HEROES.slice(30, 34), HEROES.slice(34, 38));
  draft(ac.id, 1, HEROES.slice(0, 5), HEROES.slice(5, 10), HEROES.slice(30, 34), HEROES.slice(34, 38));

  const url = `?a=${teams.BRAVO}&b=${teams.CHARLIE}`;
  // ตารางจับคู่พบกันหมดวางคู่นี้ไว้แล้ว แต่ยังไม่ได้ลงเล่น
  // หัวต่อหัวจึงมีนัดอยู่ในตาราง แต่ไม่มีดราฟต์และไม่มีเกมที่ชนะสักเกม
  const head = (await request('GET', `/api/matchup${url}`)).body.matchup;
  assert.strictEqual(head.a.topPicks.length, 0, 'they have no shared history to show');
  assert.strictEqual(head.a.topBans.length, 0);
  assert.strictEqual(head.a.gamesWon, 0);
  assert.strictEqual(head.b.gamesWon, 0);

  const mine = (await request('GET', `/api/team-drafts${url}&tournament=${cup.id}`)).body;
  assert.strictEqual(mine.a.games, 1);
  assert.strictEqual(mine.b.games, 1);
  assert.ok(mine.a.topPicks.length > 0, 'but each of them has played, so the board is not empty');
});

// ขอบเขตเป็นของรายการนั้น ไม่ใช่ของทั้งเครื่อง
test('games played in another tournament are not counted', async () => {
  const first = await buildCup('Cup One');
  const ab = first.matchOf('ALPHA', 'BRAVO');
  draft(ab.id, 1, HEROES.slice(0, 5), HEROES.slice(5, 10), HEROES.slice(30, 34), HEROES.slice(34, 38));

  // ทีมชุดใหม่ในรายการที่สอง แล้วเอา id ของรายการนั้นมาถามด้วย id ทีมของรายการแรก
  const second = (await request('POST', '/api/tournaments', {
    name: 'Cup Two', format: 'round_robin', bestOf: 3
  })).body.tournament;
  await request('POST', `/api/tournaments/${second.id}/teams`, { teamId: first.teams.ALPHA });
  await request('POST', `/api/tournaments/${second.id}/teams`, { teamId: first.teams.BRAVO });
  await request('POST', `/api/tournaments/${second.id}/matches`, {});

  const inSecond = (await request(
    'GET',
    `/api/team-drafts?a=${first.teams.ALPHA}&b=${first.teams.BRAVO}&tournament=${second.id}`
  )).body;
  assert.strictEqual(inSecond.a.games, 0, 'the other cup drafts stay in the other cup');
  assert.deepStrictEqual(inSecond.a.topPicks, []);
  assert.strictEqual(inSecond.tournament.name, 'Cup Two');
});

// URL เดียวใช้ได้ทั้งงาน ไม่ต้องแก้ browser source ทุกครั้งที่เปลี่ยนคู่
test('with nothing in the query it follows the match on air', async () => {
  const { cup, teams, matchOf } = await buildCup('On Air Cup');
  const ab = matchOf('ALPHA', 'BRAVO');
  draft(ab.id, 1, HEROES.slice(0, 5), HEROES.slice(5, 10), HEROES.slice(30, 34), HEROES.slice(34, 38));

  assert.strictEqual((await request('POST', `/api/matches/${ab.id}/live`)).status, 200);

  const { status, body } = await request('GET', '/api/team-drafts');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.tournament.id, cup.id);

  const named = [body.a.teamId, body.b.teamId].sort();
  assert.deepStrictEqual(named, [teams.ALPHA, teams.BRAVO].sort(), 'it picked up both sides');
});

test('with nothing on air and no teams named it says so instead of guessing', async () => {
  // ปลดแมตช์ที่เทสต์ก่อนหน้าเปิดค้างไว้
  await request('POST', '/api/reset-state');

  const { status, body } = await request('GET', '/api/team-drafts');
  assert.strictEqual(status, 404);
  assert.match(body.error, /no match is on air/i);
});

test('a team cannot be asked to play itself', async () => {
  const { cup, teams } = await buildCup('Mirror Cup');
  const { status, body } = await request(
    'GET',
    `/api/team-drafts?a=${teams.ALPHA}&b=${teams.ALPHA}&tournament=${cup.id}`
  );
  assert.strictEqual(status, 400);
  assert.match(body.error, /itself/i);
});

// จำนวนต่อแถวมาจาก URL ซึ่งเป็นค่าที่ผู้ใช้พิมพ์เอง
test('top is clamped, and rubbish falls back to the default', async () => {
  const { cup, teams, matchOf } = await buildCup('Clamp Cup');
  const ab = matchOf('ALPHA', 'BRAVO');
  // สิบพิคต่อฝั่งไม่มีจริงในเกม แต่ต้องมีฮีโร่มากพอให้แถวยาวเกินลิมิตได้
  draft(ab.id, 1, HEROES.slice(0, 5), HEROES.slice(5, 10), HEROES.slice(30, 34), HEROES.slice(34, 38));
  draft(ab.id, 2, HEROES.slice(10, 15), HEROES.slice(15, 20), HEROES.slice(40, 44), HEROES.slice(44, 48));
  draft(ab.id, 3, HEROES.slice(20, 25), HEROES.slice(25, 30), HEROES.slice(50, 54), HEROES.slice(54, 58));

  const base = `/api/team-drafts?a=${teams.ALPHA}&b=${teams.BRAVO}&tournament=${cup.id}`;

  const wide = (await request('GET', `${base}&top=999`)).body;
  assert.strictEqual(wide.a.topPicks.length, 10, 'ten is the ceiling');

  const narrow = (await request('GET', `${base}&top=1`)).body;
  assert.strictEqual(narrow.a.topPicks.length, 1);

  const junk = (await request('GET', `${base}&top=abc`)).body;
  assert.strictEqual(junk.a.topPicks.length, 5, 'the default stands');
});

// หน้านี้เป็นกราฟิกออกอากาศ อ่านอย่างเดียว จึงต้องเปิดได้โดยไม่มีโทเคน
// เหมือน /api/matchup กับ /api/analytics (โทเคนอยู่ที่หน้าคนคุมงานเท่านั้น)
test('the page and its data need no control token', async () => {
  const page = await request('GET', '/overlay-team-drafts');
  assert.strictEqual(page.status, 200);
  assert.match(String(page.body), /overlay-team-drafts\.js/);
});

// ทีมที่ถูกลบออกจากทะเบียนแล้วต้องยังมีชื่อขึ้นจอ
//
// games.blue_team_id ไม่มี foreign key ผูกกับตาราง teams (ดู migrations.ts)
// ลบทีมออกจากทะเบียนแล้วแถวเกมยังอ้าง id เดิมอยู่ สถิติจึงยังนับเกมพวกนั้นได้ครบ
// แต่ teams.get(id) คืน undefined ผลคือกระดานมีข้อมูลครบทุกช่องแต่ชื่อทีมหาย
// หัวเรื่องกลายเป็น "FLASH WOLVES vs " แล้วการ์ดฝั่งนั้นขึ้นคำว่า RED แทนชื่อจริง
//
// matchup.ts แก้เรื่องนี้ไว้แล้วด้วย nameOf() ที่ตกไปอ่านสำเนาแช่แข็ง
// หน้านี้ต้องตกไปที่เดียวกัน ไม่งั้นสองกราฟิกที่หน้าตาเหมือนกันจะตอบไม่เหมือนกัน
test('a team deleted from the registry keeps the name it played under', async () => {
  const { cup, teams, matchOf } = await buildCup('Ghost Cup');
  const ab = matchOf('ALPHA', 'BRAVO');
  draft(ab.id, 1, HEROES.slice(0, 5), HEROES.slice(5, 10), HEROES.slice(30, 34), HEROES.slice(34, 38));

  assert.strictEqual((await request('DELETE', `/api/teams/${teams.BRAVO}`)).status, 200);

  const { status, body } = await request(
    'GET',
    `/api/team-drafts?a=${teams.ALPHA}&b=${teams.BRAVO}&tournament=${cup.id}`
  );
  assert.strictEqual(status, 200);

  // ดราฟต์ยังอยู่ครบ นี่คือสิ่งที่ทำให้ชื่อที่หายไปเป็นบั๊ก ไม่ใช่ช่องว่างที่ถูกต้อง
  assert.strictEqual(body.b.games, 1, 'the game it played is still counted');
  assert.ok(body.b.topPicks.length > 0, 'and its draft is still there');

  assert.strictEqual(body.b.name, 'BRAVO', 'so its name must still be there too');
});

// ข้อความที่ชี้ไปผิดจุดแย่กว่าไม่มีข้อความ
//
// ระบุสองทีมมาครบแล้วแต่ลืม ?tournament= เป็นเรื่องที่เกิดจริง เพราะสองตัวแรก
// ก๊อปมาจากหน้าทีมได้ ส่วนตัวที่สามต้องไปหาเอง ข้อความเดิมบอกว่า
// "ไม่ได้ระบุทีมมา" ทั้งที่ระบุมาแล้ว คนอ่านจะไปแก้ที่ a กับ b ซึ่งไม่ผิด
test('naming both teams without a tournament says which part is missing', async () => {
  const { teams } = await buildCup('Message Cup');
  await request('POST', '/api/reset-state');

  const named = await request('GET', `/api/team-drafts?a=${teams.ALPHA}&b=${teams.BRAVO}`);
  assert.strictEqual(named.status, 404);
  assert.match(named.body.error, /tournament/i, 'it names the parameter that is missing');

  const nothing = await request('GET', '/api/team-drafts');
  assert.strictEqual(nothing.status, 404);
  assert.match(nothing.body.error, /no teams were named/i);
});

// พิมพ์ id เดียวกันสองช่อง ต้องบอกว่าพิมพ์ผิด ไม่ใช่บอกว่าไม่มีแมตช์ออกอากาศ
test('the same team twice is reported as such, even with nothing on air', async () => {
  const { teams } = await buildCup('Mirror Cup Two');
  await request('POST', '/api/reset-state');

  const { status, body } = await request(
    'GET',
    `/api/team-drafts?a=${teams.ALPHA}&b=${teams.ALPHA}`
  );
  assert.strictEqual(status, 400, 'not the 404 that sends the reader looking at the wrong thing');
  assert.match(body.error, /itself/i);
});
