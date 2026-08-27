// เทสต์การซิงก์แบบเรียลไทม์ระหว่างหน้าต่างๆ
//
// ตั้ง env ก่อน import อะไรก็ตาม เพราะ config อ่านตอน import
//
// เทสต์นี้ต่อ socket จริง ไม่ได้ mock: ใช้ createServer() ซึ่งผูก io เข้ากับ
// live-state ให้ แล้วยิง HTTP เข้าไปจริงๆ แล้วรอฟังสัญญาณที่ฝั่งไคลเอนต์
// การ mock ตรงนี้จะพิสูจน์แค่ว่าเราเรียกฟังก์ชันที่เรา mock ไว้เอง

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-sync-test-'));
process.env.ROV_USER_DATA_DIR = path.join(TMP, 'data');
process.env.ROV_USER_MEDIA_DIR = path.join(TMP, 'media');
process.env.CONTROL_TOKEN = '';

const { createServer } = require('../server/index') as typeof import('../server/index');
const { closeDatabase } = require('../server/store/db') as typeof import('../server/store/db');
const { io: connect } = require('socket.io-client');

import { must } from './helpers';

let server: http.Server;
let base = '';
const clients: any[] = [];

function send(method: string, url: string, payload?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = payload === undefined ? null : Buffer.from(JSON.stringify(payload));
    const headers: Record<string, string> = {};
    if (data) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(data.length);
    }
    const req = http.request(`${base}${url}`, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        try { resolve(JSON.parse(text)); } catch { resolve(text); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function newClient(join: boolean): Promise<any> {
  return new Promise((resolve) => {
    const socket = connect(base, { transports: ['websocket'], forceNew: true });
    clients.push(socket);
    socket.on('connect', () => {
      if (join) socket.emit('data:join');
      // ให้เซิร์ฟเวอร์ประมวลผลคำขอเข้าห้องก่อน ไม่งั้นสัญญาณแรกอาจมาก่อนเข้าห้องสำเร็จ
      setTimeout(() => resolve(socket), 60);
    });
  });
}

// รอสัญญาณตัวถัดไปที่ตรงเงื่อนไข
function nextChange(socket: any, match: (c: any) => boolean, ms = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('dataChanged', handler);
      reject(new Error('no matching dataChanged within ' + ms + 'ms'));
    }, ms);
    function handler(change: any) {
      if (!match(change)) return;
      clearTimeout(timer);
      socket.off('dataChanged', handler);
      resolve(change);
    }
    socket.on('dataChanged', handler);
  });
}

test.before(async () => {
  const created = createServer();
  server = created.server;
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      resolve();
    });
  });
});

test.after(() => {
  clients.forEach((c) => c.close());
  server?.close();
  closeDatabase();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ระบบเก็บเอง */ }
});

test('creating a team tells every open page', async () => {
  const socket = await newClient(true);
  const waiting = nextChange(socket, (c) => c.topic === 'teams');

  const created = await send('POST', '/api/teams', { name: 'Sync FC' });
  const change = await waiting;

  assert.strictEqual(change.topic, 'teams');
  assert.strictEqual(change.teamId, created.team.id, 'the signal names which team moved');
});

test('a roster change carries the tournament it belongs to', async () => {
  const socket = await newClient(true);
  const team = (await send('POST', '/api/teams', { name: 'Roster FC' })).team;
  const tournament = (await send('POST', '/api/tournaments', { name: 'Sync Cup' })).tournament;

  const waiting = nextChange(socket, (c) => c.topic === 'roster');
  await send('POST', `/api/tournaments/${tournament.id}/teams`, { teamId: team.id });
  const change = await waiting;

  // หน้าอื่นต้องแยกออกว่าเป็นทัวร์นาเมนต์ที่ตัวเองเปิดอยู่หรือเปล่า
  assert.strictEqual(change.tournamentId, tournament.id);
});

test('drawing and scoring matches both signal, scoped to that tournament', async () => {
  const socket = await newClient(true);
  const tournament = (await send('POST', '/api/tournaments', { name: 'Score Cup' })).tournament;
  for (const name of ['S1', 'S2']) {
    const team = (await send('POST', '/api/teams', { name })).team;
    await send('POST', `/api/tournaments/${tournament.id}/teams`, { teamId: team.id });
  }

  const drawing = nextChange(socket, (c) => c.topic === 'matches');
  const drawn = await send('POST', `/api/tournaments/${tournament.id}/matches`, { randomise: false });
  assert.strictEqual((await drawing).tournamentId, tournament.id);

  const match = must(drawn.matches[0]);
  const scoring = nextChange(socket, (c) => c.topic === 'matches');
  await send('PUT', `/api/matches/${match.id}/result`, { scoreA: 2, scoreB: 0 });
  assert.strictEqual((await scoring).tournamentId, tournament.id);
});

test('putting a match on air signals the live topic', async () => {
  const socket = await newClient(true);
  const tournament = (await send('POST', '/api/tournaments', { name: 'Air Cup' })).tournament;
  for (const name of ['A1', 'A2']) {
    const team = (await send('POST', '/api/teams', { name })).team;
    await send('POST', `/api/tournaments/${tournament.id}/teams`, { teamId: team.id });
  }
  const drawn = await send('POST', `/api/tournaments/${tournament.id}/matches`, { randomise: false });

  const waiting = nextChange(socket, (c) => c.topic === 'live');
  await send('POST', `/api/matches/${must(drawn.matches[0]).id}/live`, {});
  assert.strictEqual((await waiting).tournamentId, tournament.id);
});

// ---- ห้องต้องกันคนที่ไม่ได้ขอเข้าจริงๆ ----

test('a page that never joined the room is not sent anything', async () => {
  const outsider = await newClient(false);   // เช่น overlay ที่ไม่สนใจข้อมูลฝั่งคนคุม
  const insider = await newClient(true);

  let outsiderHeard = 0;
  outsider.on('dataChanged', () => { outsiderHeard += 1; });

  const waiting = nextChange(insider, (c) => c.topic === 'teams');
  await send('POST', '/api/teams', { name: 'Quiet FC' });
  await waiting;

  // ให้เวลาผ่านไปอีกหน่อย เผื่อข้อความหลงมาช้าๆ
  await new Promise((r) => setTimeout(r, 150));
  assert.strictEqual(outsiderHeard, 0, 'overlays must not pay for operator data churn');
});
