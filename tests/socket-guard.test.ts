// คำสั่งทาง socket ที่พัง ต้องไม่ล้มทั้งเซิร์ฟเวอร์
//
// ตั้ง env ก่อน import อะไรก็ตาม เพราะ config อ่านตอน import
//
// socket.io ไม่ได้ดัก exception ที่หลุดออกจาก event handler ให้เลย
// มันลอยขึ้นไปเป็น uncaughtException แล้ว Node ปิด process ทิ้ง
// เซิร์ฟเวอร์ตัวเดียวนี้เสิร์ฟทั้ง overlay และหน้า Control การล้มจึงแปลว่า
// ภาพบนอากาศดับพร้อมกันกลางรายการ เพราะกดปุ่มเดียวบนหน้าคุมงาน
//
// จำลองความพังด้วยการปิดฐานข้อมูลทิ้งทั้งที่ store ยังถืออ้างอิงเดิมอยู่
// ซึ่งเป็นรูปเดียวกับที่เกิดจริงตอน SQLITE_BUSY, ดิสก์เต็ม หรือเปิดไฟล์ .db ไม่สำเร็จ

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-socket-guard-test-'));
process.env.ROV_USER_DATA_DIR = path.join(TMP, 'data');
process.env.ROV_USER_MEDIA_DIR = path.join(TMP, 'media');
process.env.CONTROL_TOKEN = '';

const { createServer } = require('../server/index') as typeof import('../server/index');
const { getStores } = require('../server/store/index') as typeof import('../server/store/index');
const { closeDatabase } = require('../server/store/db') as typeof import('../server/store/db');
const { io: connect } = require('socket.io-client');

let server: http.Server;
let base = '';
const clients: any[] = [];

test.before(async () => {
  const made = createServer();
  server = made.server;
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
      resolve();
    });
  });
});

test.after(() => {
  clients.forEach((socket) => socket.close());
  server.close();
  closeDatabase();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ระบบเก็บเอง */ }
});

function newClient(): Promise<any> {
  return new Promise((resolve) => {
    const socket = connect(base, { transports: ['websocket'], forceNew: true });
    clients.push(socket);
    socket.on('connect', () => resolve(socket));
  });
}

test('a command that throws reports the failure instead of killing the server', async () => {
  const socket = await newClient();

  // store ยังถือฐานตัวเดิมอยู่ แต่ฐานถูกปิดไปแล้ว คำสั่งถัดไปที่แตะฐานจึงโยน exception
  // updateScore เขียนคะแนนต่อลงตารางแข่ง (pushOverlayScoreToMatch) จึงแตะฐานแน่นอน
  getStores();
  closeDatabase();

  const failure = await new Promise<any>((resolve) => {
    socket.on('controlError', resolve);
    socket.emit('updateScore', { team: 'teamBlue', score: 1 });
    setTimeout(() => resolve(null), 1500);
  });

  assert.ok(failure, 'the operator is told the command failed');
  assert.match(String(failure.message), /updateScore/, 'and which command it was');

  // ข้อสำคัญที่สุด: เซิร์ฟเวอร์ยังอยู่ และคำสั่งที่ไม่แตะฐานยังทำงานได้ตามปกติ
  const state = await new Promise<any>((resolve) => {
    socket.on('stateUpdate', resolve);
    socket.emit('updatePhase', 'PICK');
    setTimeout(() => resolve(null), 1500);
  });

  assert.ok(state, 'the connection survived');
  assert.strictEqual(state.currentPhase, 'PICK', 'and still does what it is told');
});
