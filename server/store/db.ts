// การเชื่อมต่อฐานข้อมูล SQLite
//
// ใช้ node:sqlite ที่ติดมากับ Node เลย ไม่ใช่ better-sqlite3
// เหตุผล: better-sqlite3 เป็น native module ต้อง rebuild ตอนแพ็กเป็น exe
// ซึ่งเป็นจุดที่พังบ่อยเวลาเปลี่ยนเวอร์ชัน Electron
// ตรวจแล้วว่า node:sqlite ใช้ได้ทั้งใน Node และใน Electron 43 (node 24.17)
//
// DatabaseSync เป็น API แบบ synchronous ตรงกับสไตล์เดิมของโปรเจกต์
// ที่ใช้ fs.readFileSync / writeFileSync อยู่แล้ว ไม่ต้องแปลงเป็น async ทั้งสาย
//
// openDatabase รับ path ได้ เพื่อให้เทสต์เปิดฐานใน ':memory:' ได้
// ห้ามให้เทสต์ไปแตะไฟล์จริงของผู้ใช้

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { TOURNAMENT_DB_PATH } from '../config';
import { MIGRATIONS } from './migrations';

export type Database = DatabaseSync;

export function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  const current = row.user_version;

  for (let version = current; version < MIGRATIONS.length; version += 1) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version] as string);
      // user_version รับพารามิเตอร์ผูกค่าไม่ได้ ต้องต่อสตริง
      // ตัวเลขมาจาก index ของอาเรย์ในโค้ด ไม่ได้มาจากผู้ใช้ จึงปลอดภัย
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${version + 1} failed: ${(error as Error).message}`);
    }
  }
}

export function openDatabase(dbPath: string = TOURNAMENT_DB_PATH): DatabaseSync {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  // ON DELETE CASCADE ใน migrations จะไม่ทำงานถ้าไม่เปิดตัวนี้
  // SQLite ปิดไว้เป็นค่าเริ่มต้นเพื่อความเข้ากันได้กับของเก่า
  db.exec('PRAGMA foreign_keys = ON');
  // WAL ทนไฟดับกว่า และอ่านพร้อมเขียนได้ เหมาะกับตอนถ่ายทอดสด
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL');

  migrate(db);
  return db;
}

// ตัวที่แอพใช้จริง เปิดครั้งเดียวตอนเรียกใช้ครั้งแรก
let appDb: DatabaseSync | null = null;

export function getDatabase(): DatabaseSync {
  if (!appDb) appDb = openDatabase();
  return appDb;
}

// ฐานถูกเปิดไปแล้วหรือยัง โดยไม่เผลอเปิดมันเสียเอง
//
// มีไว้ให้โค้ดที่อยาก "เก็บกวาดถ้ามีอะไรให้เก็บ" ถามก่อน เช่นตอน RESET MATCH
// ที่ต้องล้างตัวชี้แมตช์ที่ออกอากาศ ถ้าเรียก getStores() ตรงๆ คนที่ใช้แค่ overlay
// กับหน้า control จะได้ไฟล์ tournament.db งอกขึ้นมาเปล่าๆ ตั้งแต่กดปุ่มแรก
// ซึ่งขัดกับที่ตั้งใจให้เปิดแบบ lazy
export function isDatabaseOpen(): boolean {
  return appDb !== null;
}

export function closeDatabase(): void {
  if (appDb) {
    appDb.close();
    appDb = null;
  }
}
