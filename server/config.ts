// ค่าคงที่ระดับแอพ: พอร์ต, โทเคน, และตำแหน่งโฟลเดอร์ทั้งหมด
//
// โมดูลนี้อยู่ใน server/ แต่ไฟล์ข้อมูลกับ public/ อยู่ที่ราก
// ทุก path จึงต้องอ้างจาก ROOT_DIR ไม่ใช่ __dirname ของไฟล์นี้
//
// ระวัง: หลังคอมไพล์ ไฟล์นี้ไปอยู่ที่ build/server/config.js
// ต้องขึ้นสองชั้นถึงรากโปรเจกต์ ไม่ใช่ชั้นเดียวเหมือนตอนเป็น server/config.js
//
// อ่าน env ตอน require ห้าม cache ไว้ก่อนหน้านั้น
// electron-main.js ตั้ง ROV_USER_DATA_DIR / ROV_USER_MEDIA_DIR
// แล้วค่อย require server.js ถ้าอ่านเร็วกว่านั้นจะได้ค่าว่าง

import path from 'path';

export const ROOT_DIR = path.join(__dirname, '..', '..');

export const PORT = Number(process.env.PORT) || 3000;
export const HOST = process.env.HOST || '127.0.0.1';
export const CONTROL_TOKEN = process.env.CONTROL_TOKEN || '';

// APP_DATA_DIR = ข้อมูลที่มากับตัวแอพ (heroes.json) อ่านอย่างเดียว
// DATA_DIR     = ข้อมูลของผู้ใช้ เขียนได้ ตอนแพ็กเป็น exe จะย้ายออกนอก asar
export const APP_DATA_DIR = path.join(ROOT_DIR, 'data');
export const DATA_DIR = process.env.ROV_USER_DATA_DIR || APP_DATA_DIR;
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

export const STATE_PATH = path.join(DATA_DIR, 'state.json');

// ข้อมูลทัวร์นาเมนต์กับทีมอยู่ใน SQLite แยกจาก state.json
//
// ที่ไม่ยัดรวมใน state.json เพราะ sanitizeState เก็บเฉพาะคีย์ที่รู้จัก
// คีย์แปลกปลอมถูกทิ้งตอนเซฟรอบถัดไป เปิดด้วยเวอร์ชันเก่าทีเดียวข้อมูลหายหมด
// อยู่คนละไฟล์แล้วเวอร์ชันเก่าจะมองไม่เห็น ไม่ไปยุ่ง ข้อมูลจึงรอด
export const TOURNAMENT_DB_PATH = path.join(DATA_DIR, 'tournament.db');

// ที่เก็บภาพที่ผู้ใช้อัปโหลด (โลโก้ทีม + ภาพพื้นหลัง)
//
// ตอนแพ็กเป็น .exe โค้ดทั้งก้อนอยู่ใน app.asar ซึ่งเป็น "ไฟล์" ไม่ใช่โฟลเดอร์
// เขียนไฟล์ลง __dirname/public/... จึงพังด้วย ENOTDIR
// เหมือนกับ state.json ที่ย้ายไป ROV_USER_DATA_DIR ภาพก็ต้องออกมาอยู่นอก
// asar เช่นกัน ตอนรันจาก source (ไม่ได้ตั้ง env) ใช้ public/images ตามเดิม
// ของเก่าที่มีอยู่แล้วจะได้ยังใช้ได้
export const USER_MEDIA_DIR = process.env.ROV_USER_MEDIA_DIR || path.join(PUBLIC_DIR, 'images');

export const HERO_IMAGE_DIR = path.join(PUBLIC_DIR, 'images', 'heroes');

// เสียงเอฟเฟกต์ที่ผู้ใช้เอามาวางเอง อยู่ใต้โฟลเดอร์ media เดียวกับโลโก้และภาพพื้นหลัง
// เพราะเป็นของผู้ใช้ ไม่ใช่ของที่มากับตัวแอพ จึงต้องอยู่นอก asar เหมือนกัน
export const USER_SOUND_DIR = path.join(USER_MEDIA_DIR, 'sounds');
