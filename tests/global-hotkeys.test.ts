// เทสต์คีย์ลัดระดับระบบ
//
// ตั้ง env ก่อน import อะไรก็ตาม เพราะ config อ่านตอน import
//
// เรื่องที่ต้องถูกที่สุดคือ "ปุ่มแบบไหนห้ามจอง"
// การจองคีย์ลัดระดับระบบคือการยึดปุ่มไปจากทุกโปรแกรมในเครื่อง
// พลาดตรงนี้ทีเดียวคือคนใช้พิมพ์ปุ่มนั้นไม่ได้ทั้งเครื่อง โดยไม่มีทางเดาถูกว่าเพราะอะไร

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-globalkeys-test-'));
process.env.ROV_USER_DATA_DIR = path.join(TMP, 'data');
process.env.ROV_USER_MEDIA_DIR = path.join(TMP, 'media');
process.env.CONTROL_TOKEN = '';

const { createApp } = require('../server/index') as typeof import('../server/index');
const { closeDatabase } = require('../server/store/db') as typeof import('../server/store/db');
const settings = require('../server/domain/settings') as typeof import('../server/domain/settings');
const liveState = require('../server/store/live-state') as typeof import('../server/store/live-state');
const draftEngine = require('../server/services/draft-engine') as typeof import('../server/services/draft-engine');

const { toAccelerator, sanitizeGlobalHotkeys, GLOBAL_HOTKEY_DEFAULTS, CARRIED_OVER_KEYS } = settings;

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
          try { body = text ? JSON.parse(text) : null; } catch { body = text; }
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
      const address = server.address();
      base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      resolve();
    });
  });
});

test.after(async () => {
  // startDraftPhase เปิด setInterval ไว้ ถ้าไม่หยุด process ของเทสต์จะไม่ยอมจบ
  draftEngine.stopDraftTimer();
  closeDatabase();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ระบบเก็บเอง */ }
});

// ---- กฎที่ห้ามพัง ----

test('a system-wide hotkey without a modifier cannot be built at all', () => {
  const bare = { code: 'Space', ctrl: false, shift: false, alt: false, meta: false };
  assert.strictEqual(toAccelerator(bare), null, 'a bare Space would be taken from the whole machine');

  const withCtrl = { ...bare, ctrl: true };
  assert.strictEqual(toAccelerator(withCtrl), 'Control+Space');
});

test('modifiers come out in a fixed order, so the same binding is always the same string', () => {
  const all = { code: 'KeyH', ctrl: true, shift: true, alt: true, meta: true };
  assert.strictEqual(toAccelerator(all), 'Control+Alt+Shift+Super+H');
});

test('keys the accelerator table does not know are refused, not guessed at', () => {
  assert.strictEqual(toAccelerator({ code: 'Alt', ctrl: true, shift: false, alt: false, meta: false }), null);
  assert.strictEqual(toAccelerator({ code: 'Nonsense', ctrl: true, shift: false, alt: false, meta: false }), null);
  assert.strictEqual(toAccelerator(null), null);
  assert.strictEqual(
    toAccelerator({ code: 'ArrowLeft', ctrl: true, shift: false, alt: true, meta: false }),
    'Control+Alt+Left',
    'DOM code names are translated, not passed through'
  );
});

test('a binding that cannot be registered falls back to the default rather than being kept', () => {
  const cleaned = sanitizeGlobalHotkeys({
    enabled: true,
    bindings: { undo: { code: 'KeyZ', ctrl: false, shift: false, alt: false, meta: false } }
  });
  assert.deepStrictEqual(cleaned.bindings.undo, GLOBAL_HOTKEY_DEFAULTS.bindings.undo);
  assert.strictEqual(cleaned.enabled, true);
});

test('it is off unless switched on, and junk never switches it on', () => {
  assert.strictEqual(GLOBAL_HOTKEY_DEFAULTS.enabled, false, 'installing this app takes no keys');
  assert.strictEqual(sanitizeGlobalHotkeys({}).enabled, false);
  assert.strictEqual(sanitizeGlobalHotkeys({ enabled: 'yes' }).enabled, false);
  assert.strictEqual(sanitizeGlobalHotkeys(null).enabled, false);
  assert.deepStrictEqual(sanitizeGlobalHotkeys(null).bindings, GLOBAL_HOTKEY_DEFAULTS.bindings);
});

test('the setting survives a reset, the way theme and hotkeys do', () => {
  assert.ok(
    (CARRIED_OVER_KEYS as readonly string[]).includes('globalHotkeys'),
    'switching a match must not silently drop the keys a caster is holding'
  );
});

// ---- ทางที่ Electron ใช้ ----

test('the app can ask what to register, and gets accelerators rather than raw bindings', async () => {
  const before = await request('GET', '/api/global-hotkeys');
  assert.strictEqual(before.status, 200);
  assert.strictEqual(before.body.enabled, false);
  // ปิดอยู่ก็ยังบอกได้ว่าถ้าเปิดจะจองอะไร ตัวจองเป็นคนตัดสินใจว่าจะจองหรือไม่
  assert.strictEqual(before.body.accelerators.undo, 'Control+Alt+Z');
});

test('firing an action does nothing while the feature is switched off', async () => {
  const state = liveState.getState();
  state.globalHotkeys = { ...state.globalHotkeys, enabled: false };

  const refused = await request('POST', '/api/global-hotkeys/fire', { action: 'toggleBanner' });
  assert.strictEqual(refused.status, 409, 'a stray request cannot drive the broadcast');
});

test('an unknown action is refused rather than ignored quietly', async () => {
  const state = liveState.getState();
  state.globalHotkeys = { ...state.globalHotkeys, enabled: true };

  assert.strictEqual((await request('POST', '/api/global-hotkeys/fire', { action: 'rm -rf' })).status, 400);
  assert.strictEqual((await request('POST', '/api/global-hotkeys/fire', {})).status, 400);
});

test('firing toggleBanner really moves the overlay on and off air', async () => {
  const state = liveState.getState();
  state.globalHotkeys = { ...state.globalHotkeys, enabled: true };
  state.overlayVisible = true;

  const off = await request('POST', '/api/global-hotkeys/fire', { action: 'toggleBanner' });
  assert.strictEqual(off.status, 200);
  assert.strictEqual(liveState.getState().overlayVisible, false, 'the banner went off air');

  await request('POST', '/api/global-hotkeys/fire', { action: 'toggleBanner' });
  assert.strictEqual(liveState.getState().overlayVisible, true, 'and back on');
});

test('firing nextPhase and prevPhase walks the draft, and prev stops at the first phase', async () => {
  const state = liveState.getState();
  state.globalHotkeys = { ...state.globalHotkeys, enabled: true };
  state.draftPhaseIndex = 0;

  await request('POST', '/api/global-hotkeys/fire', { action: 'nextPhase' });
  assert.strictEqual(liveState.getState().draftPhaseIndex, 1);

  await request('POST', '/api/global-hotkeys/fire', { action: 'prevPhase' });
  assert.strictEqual(liveState.getState().draftPhaseIndex, 0);

  await request('POST', '/api/global-hotkeys/fire', { action: 'prevPhase' });
  assert.strictEqual(liveState.getState().draftPhaseIndex, 0, 'never below the first phase');
});

test('undo reports that nothing changed instead of failing when there is nothing to undo', async () => {
  const state = liveState.getState();
  state.globalHotkeys = { ...state.globalHotkeys, enabled: true };

  const reply = await request('POST', '/api/global-hotkeys/fire', { action: 'undo' });
  assert.strictEqual(reply.status, 200, 'a caster pressing undo at OBS gets no dialog either way');
  assert.strictEqual(typeof reply.body.changed, 'boolean');
});

// ---- หน้าตั้งค่า ----

test('the hotkeys page offers the system-wide panel and no longer says it is impossible', async () => {
  const html = String((await request('GET', '/hotkeys')).body);
  assert.ok(html.includes('id="globalPanel"'), 'the panel is there to switch on');
  assert.ok(html.includes('id="globalEnabled"'), 'with a switch of its own');
  assert.ok(
    !/cannot register system-wide shortcuts/.test(html),
    'the page must not still claim this is impossible'
  );
});
