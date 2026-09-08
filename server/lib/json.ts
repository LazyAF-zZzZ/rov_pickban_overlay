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
  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    // ยังไม่มีไฟล์เป็นเรื่องปกติตอนเปิดแอพครั้งแรก quiet มีไว้สำหรับกรณีนี้
    if (!options.quiet) {
      console.warn(`Could not load ${filePath}: ${(error as Error).message}`);
    }
    return deepClone(fallback);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    // ไฟล์มีอยู่แต่อ่านไม่ออก คนละเรื่องกับไฟล์ที่ยังไม่มี
    //
    // ตรงนี้กำลังจะทิ้งข้อมูลของผู้ใช้แล้วใช้ค่าเริ่มต้นแทน ซึ่งบนหน้าจอ
    // จะเห็นเป็น "ทุกอย่างว่างเปล่า" โดยไม่มีอะไรบอกว่าเกิดอะไรขึ้น
    // จึงต้องดังเสมอ แม้จะสั่ง quiet มา เพราะ quiet แปลว่า "ไม่มีไฟล์ก็ไม่เป็นไร"
    // ไม่ได้แปลว่า "ไฟล์พังก็ไม่ต้องบอก"
    console.warn(`${filePath} is not valid JSON and was ignored: ${(error as Error).message}`);
    return deepClone(fallback);
  }
}

// เขียนลงไฟล์ชั่วคราวก่อน แล้วค่อย rename ทับของเดิม
//
// writeFileSync ทับไฟล์เดิมตรงๆ แปลว่าระหว่างเขียน ไฟล์จริงถูกตัดเหลือศูนย์ไบต์ไปก่อน
// แล้วค่อยถูกเติมกลับ ถ้าโดนปิดโปรแกรมหรือไฟดับตรงจังหวะนั้น จะเหลือ state.json
// ที่ว่างหรือขาดครึ่ง แล้วรอบหน้า loadJson จะถอยไปใช้ค่าเริ่มต้น
// = ชื่อทีม ผู้เล่น ดราฟต์ที่กรอกไว้ ธีมที่ปรับทั้งวัน หายหมดในครั้งเดียว
//
// ไม่ใช่โอกาสน้อยด้วย: ระหว่างจับเวลาดราฟต์ ไฟล์นี้ถูกเขียนใหม่ทุกวินาที
// และคนใช้เครื่องมือนี้ปิดแอพด้วยการกดกากบาทกลางงานเป็นเรื่องปกติ
//
// rename บนไฟล์ระบบเดียวกันเป็นการสลับชื่อแบบ atomic ไฟล์จริงจึงมีได้สองสถานะเท่านั้น
// คือของเก่าที่ครบ หรือของใหม่ที่ครบ ไม่มีสถานะครึ่งๆ ให้โหลดเจอ
export function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}
