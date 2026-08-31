import test from 'node:test';
import assert from 'node:assert';
import { defaultState, sanitizeState, isHeroTaken, dropDuplicateHeroes } from '../server/domain/match';
import { carryOverSettings, CARRIED_OVER_KEYS, sanitizeSfx, SFX_DEFAULTS } from '../server/domain/settings';
import { heroesData } from '../server/domain/heroes';

const [HERO_A, HERO_B] = heroesData.heroes;

// ระดับเสียงต่อเหตุการณ์เป็นการตั้งค่าเครื่องมือ ไม่ใช่ข้อมูลของแมตช์
//
// หรี่เสียง pick ไว้ตอนซ้อม แล้วกด RESET MATCH หรือเปิดแมตช์ถัดไปขึ้นจอ
// ค่าต้องอยู่เหมือนเดิม ไม่ใช่เด้งกลับไปดังเต็มกลางรายการ
test('sound levels survive a reset the way theme and hotkeys do', () => {
  assert.ok(
    (CARRIED_OVER_KEYS as readonly string[]).includes('sfx'),
    'sfx is carried over, not reset with the match'
  );

  const next = carryOverSettings(
    { sfx: { pick: 1, ban: 1, timer: 1 } },
    { sfx: { pick: 0.2, ban: 0.5, timer: 0.9 } }
  );
  assert.deepStrictEqual(next.sfx, { pick: 0.2, ban: 0.5, timer: 0.9 });
});

// ค่าที่ใช้ไม่ได้ต้องถอยไปที่ค่าเริ่มต้น ไม่ใช่ศูนย์
// ศูนย์คือเงียบ ซึ่งแยกไม่ออกจากของเสีย และเคยเป็นบั๊กจริงมาแล้ว
test('sound levels clamp to 0..1 and fall back to the default, never to silence', () => {
  assert.deepStrictEqual(sanitizeSfx({ pick: 0.5, ban: 0, timer: 1 }), { pick: 0.5, ban: 0, timer: 1 });
  assert.deepStrictEqual(sanitizeSfx({ pick: 5, ban: -2, timer: 0.3 }), { pick: 1, ban: 0, timer: 0.3 });

  // ไม่ได้ส่งมาเลย / ส่งขยะมา -> ค่าเริ่มต้น
  assert.deepStrictEqual(sanitizeSfx({}), SFX_DEFAULTS);
  assert.deepStrictEqual(sanitizeSfx(null), SFX_DEFAULTS);
  assert.deepStrictEqual(sanitizeSfx({ pick: 'loud' }), SFX_DEFAULTS);
});

test('sanitizeState fills every missing key from defaults (old save files still load)', () => {
  // ไฟล์ state.json รุ่นเก่าไม่มี theme / hotkeys / skin / overlaySize / logo
  const legacy = {
    teamBlue: { name: 'FW', score: 0, picks: [], bans: [], players: ['ZHAN'] },
    teamRed: { name: 'EA', score: 2, picks: [], bans: [], players: [] },
    currentPhase: 'BAN',
    matchInfo: { title: 'FW VS EA', tournament: 'RPL' }
  };
  const state = sanitizeState(legacy);

  const asRecord = state as unknown as Record<string, unknown>;
  Object.keys(defaultState).forEach((key) => {
    assert.ok(asRecord[key] !== undefined, `${key} should be present after sanitize`);
  });
  assert.strictEqual(state.teamBlue.name, 'FW');
  assert.strictEqual(state.teamRed.score, 2);
  assert.strictEqual(state.teamBlue.players.length, 5);
  assert.strictEqual(state.teamBlue.players[1], 'Player 2');
  assert.deepStrictEqual(state.teamBlue.logo, { v: 0, ext: '' });
});

test('sanitizeState drops unknown keys - tournament data must live in its own file', () => {
  // อ่านผ่าน Record เพราะคีย์พวกนี้ไม่มีใน GameState อยู่แล้ว
  // ซึ่งก็คือสิ่งที่เทสต์นี้ยืนยัน: มันต้องไม่รอดออกมาจาก sanitizeState
  const state = sanitizeState({ tournamentId: 'abc123', somethingElse: 1 }) as unknown as Record<string, unknown>;
  assert.strictEqual(state.tournamentId, undefined);
  assert.strictEqual(state.somethingElse, undefined);
});

test('sanitizeState never returns a running draft', () => {
  assert.strictEqual(sanitizeState({ draftRunning: true }).draftRunning, false);
});

test('a hero can only occupy one slot in a draft', () => {
  const state = sanitizeState({
    teamBlue: { picks: [HERO_A, null, null, null, null], bans: [] },
    teamRed: { picks: [], bans: [] }
  });

  assert.ok(isHeroTaken(state, HERO_A, null), 'already picked by blue');
  assert.ok(!isHeroTaken(state, HERO_B, null), 'untouched hero is free');
  assert.ok(
    !isHeroTaken(state, HERO_A, { team: 'teamBlue', type: 'picks', index: 0 }),
    'the slot that already holds it may keep it'
  );
  assert.strictEqual(isHeroTaken(state, null, null), false);
});

test('duplicates in a hand-edited file are reduced to the first occurrence', () => {
  const state = sanitizeState({
    teamBlue: { picks: [HERO_A, HERO_A, null, null, null], bans: [HERO_A, null, null, null] },
    teamRed: { picks: [HERO_A, null, null, null, null], bans: [] }
  });
  dropDuplicateHeroes(state);

  const all = [
    ...state.teamBlue.picks, ...state.teamBlue.bans,
    ...state.teamRed.picks, ...state.teamRed.bans
  ].filter(Boolean);
  assert.strictEqual(all.filter((h) => h === HERO_A).length, 1);
});

test('carryOverSettings keeps tool settings across a match change', () => {
  const previous = sanitizeState({
    overlaySize: '1440',
    overlayVisible: false,
    theme: { blue: '#123456' }
  });
  const next = carryOverSettings(sanitizeState(defaultState), previous);

  CARRIED_OVER_KEYS.forEach((key) => {
    assert.deepStrictEqual(next[key], previous[key], `${key} should carry over`);
  });
  // แต่ข้อมูลแมตช์ต้องกลับไปเป็นค่าเริ่มต้น
  assert.strictEqual(next.teamBlue.name, defaultState.teamBlue.name);
  assert.strictEqual(next.teamBlue.score, 0);
});

test('scores and names stay inside their limits', () => {
  const state = sanitizeState({
    teamBlue: { name: 'x'.repeat(100), score: 5000 },
    teamRed: { name: '', score: -20 }
  });
  assert.strictEqual(state.teamBlue.name.length, 24);
  assert.strictEqual(state.teamBlue.score, 99);
  assert.strictEqual(state.teamRed.name, 'RED');
  assert.strictEqual(state.teamRed.score, 0);
});
