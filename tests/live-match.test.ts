// เทสต์การเอาแมตช์ขึ้นจอ และการบันทึกดราฟต์ระหว่างเล่น
//
// ส่วนที่สำคัญที่สุดคือ "บันทึกระหว่างเล่น ไม่ใช่ตอนจบ"
// เกมที่ดราฟต์ไปก่อนมีตัวบันทึก กู้คืนไม่ได้เลย จึงต้องมีเทสต์ยืนยันว่า
// แค่เปลี่ยน pick/ban ก็ถูกเก็บทันทีโดยไม่ต้องมีใครสั่งเซฟ

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-live-test-'));
process.env.ROV_USER_DATA_DIR = path.join(TMP, 'data');
process.env.ROV_USER_MEDIA_DIR = path.join(TMP, 'media');
process.env.CONTROL_TOKEN = '';

const { getStores } = require('../server/store/index') as typeof import('../server/store/index');
const { closeDatabase } = require('../server/store/db') as typeof import('../server/store/db');
const live = require('../server/services/live-match') as typeof import('../server/services/live-match');
const liveState = require('../server/store/live-state') as typeof import('../server/store/live-state');
const { heroesData } = require('../server/domain/heroes') as typeof import('../server/domain/heroes');
import { must } from './helpers';

live.attachDraftCapture();

const [HERO_A, HERO_B, HERO_C] = heroesData.heroes;

function setupMatch(bestOf = 3) {
  const { teams, tournaments, matches } = getStores();
  const tournament = must(tournaments.create({ name: `Cup ${Math.random()}`, format: 'single_elim', bestOf }).tournament);
  const blue = must(teams.create({ name: 'FW', players: [{ name: 'ZHAN' }, { name: 'WETZ' }] }).team);
  const red = must(teams.create({ name: 'EA', players: [{ name: 'SRY' }] }).team);
  tournaments.addTeam(tournament.id, blue.id, 0);
  tournaments.addTeam(tournament.id, red.id, 1);
  const drawn = must(matches.generate(tournament.id).matches);
  return { tournament, blue, red, match: must(drawn[0]) };
}

test.after(() => {
  closeDatabase();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ระบบเก็บเอง */ }
});

test('putting a match on air loads its teams onto the overlay', () => {
  const { match, tournament } = setupMatch(5);
  const result = live.goLive(match.id);
  assert.ok(result.live, result.error ?? 'goLive failed');

  const state = liveState.getState();
  assert.strictEqual(state.teamBlue.name, 'FW');
  assert.strictEqual(state.teamRed.name, 'EA');
  assert.strictEqual(state.teamBlue.players[0], 'ZHAN');
  assert.strictEqual(state.teamRed.players[1], 'Player 2', 'empty roster slots still get a label');
  assert.match(state.matchInfo.title, /FW VS EA : GAME 1 \[BO5\]/);
  assert.strictEqual(state.matchInfo.tournament, tournament.name);
});

test('going live keeps the tool settings - theme, size and hotkeys survive', () => {
  const { match } = setupMatch();

  // ตั้งค่าเครื่องมือไว้ก่อน แล้วสลับแมตช์
  const before = liveState.getState();
  before.theme.blue = '#123456';
  before.overlaySize = '1440';
  before.overlayVisible = false;

  live.goLive(match.id);

  const after = liveState.getState();
  assert.strictEqual(after.theme.blue, '#123456', 'theme survives a match change');
  assert.strictEqual(after.overlaySize, '1440', 'screen size survives');
  assert.strictEqual(after.overlayVisible, false, 'on-air toggle survives');
});

test('a bye cannot go on air', () => {
  const { teams, tournaments, matches } = getStores();
  const t = must(tournaments.create({ name: 'Bye cup', format: 'single_elim' }).tournament);
  for (let i = 0; i < 3; i += 1) {
    const team = must(teams.create({ name: `T${i}` }).team);
    tournaments.addTeam(t.id, team.id, i);
  }
  const drawn = must(matches.generate(t.id).matches);
  const bye = must(drawn.find((m) => m.isBye));

  const result = live.goLive(bye.id);
  assert.ok(result.error);
  assert.match(result.error as string, /bye/i);
});

test('a match with an undecided team cannot go on air', () => {
  const { teams, tournaments, matches } = getStores();
  const t = must(tournaments.create({ name: 'Pending cup', format: 'single_elim' }).tournament);
  for (let i = 0; i < 4; i += 1) {
    const team = must(teams.create({ name: `P${i}` }).team);
    tournaments.addTeam(t.id, team.id, i);
  }
  const drawn = must(matches.generate(t.id).matches);
  const final = must(drawn.find((m) => m.round === 2));

  const result = live.goLive(final.id);
  assert.ok(result.error);
  assert.match(result.error as string, /decided/i);
});

// ---- การบันทึกดราฟต์ ----

test('a pick is captured the moment it is made, with nobody pressing save', () => {
  const { match } = setupMatch();
  const gameId = must(must(live.goLive(match.id).live).gameId);
  const { games } = getStores();

  assert.strictEqual(must(games.get(gameId)).slots.length, 0, 'nothing drafted yet');

  // แก้ state ตรงๆ แล้วสั่ง emit เหมือนที่ socket handler ทำ
  const state = liveState.getState();
  state.teamBlue.picks[0] = must(HERO_A);
  liveState.emitState();

  const afterPick = must(games.get(gameId));
  assert.strictEqual(afterPick.slots.length, 1, 'captured without an explicit save');
  assert.deepStrictEqual(afterPick.slots[0], { side: 'blue', kind: 'pick', idx: 0, hero: HERO_A });

  // แบนด้วย
  state.teamRed.bans[0] = must(HERO_B);
  liveState.emitState();
  const afterBan = must(games.get(gameId));
  assert.strictEqual(afterBan.slots.length, 2);
  assert.ok(afterBan.slots.some((s) => s.kind === 'ban' && s.side === 'red' && s.hero === HERO_B));
});

test('changing a pick replaces it rather than adding a second one', () => {
  const { match } = setupMatch();
  const gameId = must(must(live.goLive(match.id).live).gameId);
  const { games } = getStores();
  const state = liveState.getState();

  state.teamBlue.picks[0] = must(HERO_A);
  liveState.emitState();
  state.teamBlue.picks[0] = must(HERO_C);
  liveState.emitState();

  const game = must(games.get(gameId));
  const bluePick0 = game.slots.filter((s) => s.side === 'blue' && s.kind === 'pick' && s.idx === 0);
  assert.strictEqual(bluePick0.length, 1, 'one slot holds one hero');
  assert.strictEqual(must(bluePick0[0]).hero, HERO_C);
});

test('a draft locks once every pick and ban is filled', () => {
  const { match } = setupMatch();
  const gameId = must(must(live.goLive(match.id).live).gameId);
  const { games } = getStores();
  const state = liveState.getState();

  assert.strictEqual(must(games.get(gameId)).draftLocked, false);

  // เติมให้ครบ 10 pick + 8 ban ด้วยฮีโร่คนละตัว
  let cursor = 0;
  const nextHero = () => must(heroesData.heroes[cursor++]);
  (['teamBlue', 'teamRed'] as const).forEach((team) => {
    state[team].picks = state[team].picks.map(() => nextHero());
    state[team].bans = state[team].bans.map(() => nextHero());
  });
  liveState.emitState();

  const game = must(games.get(gameId));
  assert.strictEqual(game.slots.length, 18, 'ten picks and eight bans');
  assert.strictEqual(game.draftLocked, true, 'a full draft counts towards statistics');
});

test('a locked draft stays locked even if a pick is cleared afterwards', () => {
  const { match } = setupMatch();
  const gameId = must(must(live.goLive(match.id).live).gameId);
  const { games } = getStores();
  const state = liveState.getState();

  let cursor = 0;
  const nextHero = () => must(heroesData.heroes[cursor++]);
  (['teamBlue', 'teamRed'] as const).forEach((team) => {
    state[team].picks = state[team].picks.map(() => nextHero());
    state[team].bans = state[team].bans.map(() => nextHero());
  });
  liveState.emitState();
  assert.strictEqual(must(games.get(gameId)).draftLocked, true);

  state.teamBlue.picks[0] = null;
  liveState.emitState();
  assert.strictEqual(
    must(games.get(gameId)).draftLocked,
    true,
    'clearing a pick must not silently drop the game out of the statistics'
  );
});

test('the game record keeps the team names it was played with', () => {
  const { match, blue } = setupMatch();
  const gameId = must(must(live.goLive(match.id).live).gameId);
  const { games, teams } = getStores();

  // เปลี่ยนชื่อทีมในทะเบียนหลังจากเล่นไปแล้ว
  teams.update(blue.id, { name: 'FLASH WOLVES', players: [] });

  const game = must(games.get(gameId));
  assert.strictEqual(game.blueName, 'FW', 'the game remembers who actually played');
  assert.strictEqual(must(teams.get(blue.id)).name, 'FLASH WOLVES', 'the registry moved on');
});

test('reopening the same match continues the same game, it does not start a blank one', () => {
  const { match } = setupMatch();
  const firstId = must(must(live.goLive(match.id).live).gameId);

  const state = liveState.getState();
  state.teamBlue.picks[0] = must(HERO_A);
  liveState.emitState();

  const secondId = must(must(live.goLive(match.id).live).gameId);
  assert.strictEqual(secondId, firstId, 'same game 1, not a fresh one');
  assert.strictEqual(must(getStores().games.get(firstId)).slots.length, 1, 'the draft is still there');
  // และต้องกลับขึ้นจอด้วย ไม่ใช่แค่ยังอยู่ในฐาน
  assert.strictEqual(liveState.getState().teamBlue.picks[0], HERO_A, 'the draft is back on the overlay');
});

test('reopening a match does not blank the draft that was already stored', () => {
  // เคสนี้เคยพังจริง: เปิดแมตช์เดิมแล้ว state ถูกตั้งใหม่เป็นดราฟต์ว่าง
  // emit ครั้งถัดไปเลยเขียนความว่างทับของที่เก็บไว้ = แค่เปิดดูข้อมูลก็หาย
  const { match } = setupMatch();
  const gameId = must(must(live.goLive(match.id).live).gameId);
  const { games } = getStores();

  const state = liveState.getState();
  state.teamBlue.picks[0] = must(HERO_A);
  state.teamRed.bans[0] = must(HERO_B);
  liveState.emitState();
  assert.strictEqual(must(games.get(gameId)).slots.length, 2);

  live.goLive(match.id);        // เปิดซ้ำ
  liveState.emitState();        // แล้วมีการ emit ตามมา

  assert.strictEqual(must(games.get(gameId)).slots.length, 2, 'reopening must not erase the draft');
});

test('a series moves to game 2 once the first game is scored', () => {
  const { match } = setupMatch(3);
  const first = must(must(live.goLive(match.id).live).gameNo);
  assert.strictEqual(first, 1);

  getStores().matches.setResult(match.id, 1, 0);

  const second = must(live.goLive(match.id).live);
  assert.strictEqual(second.gameNo, 2, 'the next game of the series');
  assert.notStrictEqual(second.gameId, null);
  assert.strictEqual(must(getStores().games.forMatch(match.id)).length, 2, 'both games are kept');
});

test('with nothing on air, drafting captures nowhere and throws nothing', () => {
  live.clearLive();
  const state = liveState.getState();
  state.teamBlue.picks[0] = must(HERO_A);
  assert.doesNotThrow(() => liveState.emitState(), 'a quick match outside a tournament still works');
  assert.strictEqual(live.describeLive().matchId, null);
});

// เปลี่ยนแมตช์แล้ว ประวัติ undo ของแมตช์เก่าต้องไม่ตามมาด้วย
//
// undoStack อยู่ระดับโมดูลและไม่เคยถูกล้าง ส่วน setState แทนที่ state ทั้งก้อน
// กด Ctrl+Z ครั้งเดียวหลังสลับคู่จึงเอาทีมของคู่ก่อนหน้า ทั้งชื่อ ผู้เล่น โลโก้ และดราฟต์
// กลับขึ้นออกอากาศทับคู่ที่กำลังจะเล่น ซึ่งคนดูเห็นทันทีบนจอ
//
// Ctrl+Z เป็นคีย์ลัดที่ผูกไว้ให้อยู่แล้วบนหน้า Control และใช้ได้แม้เคอร์เซอร์อยู่ในช่องกรอก
test('undo history does not follow the overlay from one match to the next', () => {
  const first = setupMatch();
  must(live.goLive(first.match.id).live);

  // ดราฟต์ไปหนึ่งช่อง แบบเดียวกับที่ handler ของ updatePick ทำ
  liveState.pushUndo();
  liveState.getState().teamBlue.picks[0] = must(HERO_A);
  liveState.emitState();
  assert.strictEqual(liveState.getState().teamBlue.name, 'FW');

  // คู่ถัดไปขึ้นจอ
  const second = setupMatch();
  must(live.goLive(second.match.id).live);
  const onAir = liveState.getState().teamBlue.name;

  assert.strictEqual(liveState.popUndo(), false, 'a fresh match starts with nothing to undo');
  assert.strictEqual(liveState.getState().teamBlue.name, onAir, 'the match on air is untouched');
  assert.strictEqual(liveState.getState().teamBlue.picks[0], null, 'and keeps its own empty draft');
});

test('undo still works within the match that is on air', () => {
  const { match } = setupMatch();
  must(live.goLive(match.id).live);

  liveState.pushUndo();
  liveState.getState().teamBlue.picks[0] = must(HERO_B);
  liveState.emitState();
  assert.strictEqual(liveState.getState().teamBlue.picks[0], must(HERO_B));

  assert.strictEqual(liveState.popUndo(), true, 'clearing the stack must not disable undo itself');
  assert.strictEqual(liveState.getState().teamBlue.picks[0], null, 'the pick was rolled back');
});

// ตำแหน่งของผู้เล่นต้องเดินทางจากทะเบียนทีมไปถึง state ที่กราฟิกอ่าน
//
// กราฟิกออกอากาศไม่ได้ถือโทเคนและเรียก API ทะเบียนเองไม่ได้ ถ้าค่าไม่ติดมากับ
// stateUpdate ไอคอนตำแหน่งก็ไม่มีทางขึ้น และจะเงียบแบบไม่มีอะไรบอกว่าทำไม
test('putting a match on air carries each player position onto the overlay', () => {
  const { teams, tournaments, matches } = getStores();
  const tournament = must(tournaments.create({ name: `Positions ${Math.random()}`, format: 'single_elim', bestOf: 1 }).tournament);
  const blue = must(teams.create({
    name: 'POS',
    players: [
      { name: 'A', position: 'jungle' },
      { name: 'B', position: 'Mid lane' },
      { name: 'C', position: 'nonsense' }
    ]
  }).team);
  const red = must(teams.create({ name: 'OTHER', players: [{ name: 'X', position: 'support' }] }).team);
  tournaments.addTeam(tournament.id, blue.id, 0);
  tournaments.addTeam(tournament.id, red.id, 1);
  const drawn = must(matches.generate(tournament.id).matches);

  must(live.goLive(must(drawn[0]).id).live);

  const state = liveState.getState();
  assert.deepStrictEqual(state.teamBlue.positions, ['jungle', 'midlane', '', '', ''],
    'known positions survive, junk is dropped rather than becoming a filename');
  assert.deepStrictEqual(state.teamRed.positions, ['support', '', '', '', '']);
});

test('loading one team from the registry brings its positions and leaves the other side alone', () => {
  const { teams } = getStores();
  const picked = must(teams.create({
    name: 'SOLO', players: [{ name: 'A', position: 'carry' }, { name: 'B', position: 'offlane' }]
  }).team);

  const before = [...liveState.getState().teamRed.positions];
  must(live.loadTeamIntoSide('teamBlue', picked.id).state);

  assert.deepStrictEqual(liveState.getState().teamBlue.positions, ['carry', 'offlane', '', '', '']);
  assert.deepStrictEqual(liveState.getState().teamRed.positions, before, 'the other side is untouched');
});
