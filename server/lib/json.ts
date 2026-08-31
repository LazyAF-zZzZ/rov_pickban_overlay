// อ่าน/เขียนไฟล์ JSON แบบไม่โยน exception ออกไปข้างนอก
//
// loadJson คืนค่า fallback เสมอเมื่ออ่านไม่ได้ ผู้เรียกจึงไม่ต้อง try/catch
// quiet = true สำหรับไฟล์ที่ "ยังไม่มี" เป็นเรื่องปกติ (state.json ครั้งแรก)
// จะได้ไม่รกคอนโซลตอนเปิดแอพครั้งแรก

import fs from 'fs';
import path from 'path';

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// คืนชนิดเป็น unknown ตั้งใจ ไม่ใช่ T
// สิ่งที่อยู่ในไฟล์อาจเป็นอะไรก็ได้ ผู้ใช้แก้เองได้ ไฟล์อาจมาจากเวอร์ชันเก่า
// การประกาศว่าเป็น T ทั้งที่ยังไม่ได้ตรวจ เท่ากับโกหกตัวตรวจชนิด
// ผู้เรียกต้องส่งผลลัพธ์ผ่าน sanitize ของตัวเองก่อนใช้เสมอ
export function loadJson(
  filePath: string,
  fallback: unknown,
  options: { quiet?: boolean } = {}
): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    if (!options.quiet) {
      console.warn(`Could not load ${filePath}: ${(error as Error).message}`);
    }
    return deepClone(fallback);
  }
}

export function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
