// เส้นทางของหน้าเว็บ (ไม่ใช่ API)
//
// เพิ่มหน้าใหม่ที่นี่ที่เดียว เช่น หน้าทัวร์นาเมนต์ / รายชื่อทีม / สถิติ
// แล้วเพิ่มไฟล์ html ใน public/

import path from 'path';
import express, { Router } from 'express';
import { PUBLIC_DIR } from '../config';

// route -> ไฟล์ใน public/
export const PAGES: Record<string, string> = {
  // / เป็นหน้าแรกแล้ว ไม่ใช่ control panel
  // control ย้ายไป /control ส่วน /index.html ทิ้ง redirect ไว้ให้ของเก่าที่ bookmark ไว้
  '/': 'home.html',
  // ทะเบียนทีมกลาง อยู่คนละระดับกับทีมในทัวร์นาเมนต์
  //
  // ระวัง: overlay รายชื่อทีมใน Phase 7 ห้ามใช้ /teams ซ้ำกับหน้านี้
  // ให้ไปใช้ /overlay-teams แทน (แผน Appendix A เขียน /teams ไว้ก่อนที่หน้านี้จะมี)
  '/teams': 'teams.html',
  '/analytics': 'analytics.html',
  '/control': 'control.html',
  '/overlay': 'overlay.html',
  '/overlay-1440': 'overlay-1440.html',
  '/result': 'result.html',
  // รายชื่อทีมสำหรับเปิดก่อนเริ่มงาน ชื่อ /overlay-teams เพราะ /teams เป็นหน้าคนคุมงานแล้ว
  '/overlay-teams': 'overlay-teams.html',
  // กระดานสถิติ pick/ban สำหรับขึ้นจอระหว่างพัก ชื่อขึ้นต้นด้วย overlay- ด้วยเหตุผลเดียวกัน
  // /analytics เป็นหน้าของคนคุมงานไปแล้ว
  '/overlay-analytics': 'overlay-analytics.html',
  // ตารางคะแนนของรอบแบ่งกลุ่ม
  //
  // รูปแบบพบกันหมดและแบ่งกลุ่มไม่มีสายให้ดูว่าใครไปต่อ ตารางคือตัวการแข่งขันเอง
  // ก่อนหน้านี้ไม่มีทางเอาขึ้นจอเลย คนดูจึงไม่มีทางรู้ว่าใครนำอยู่
  '/overlay-standings': 'overlay-standings.html',
  // หัวต่อหัวของสองทีมที่กำลังจะเจอกัน
  // อ่านจากดราฟต์และผู้ชนะรายเกมที่เก็บไว้อยู่แล้ว ไม่มีข้อมูลใหม่ที่ต้องกรอกเพิ่ม
  '/overlay-matchup': 'overlay-matchup.html',
  // ฮีโร่ที่สองทีมของคู่ที่ออกอากาศหยิบ/โดนแบนบ่อยสุดในรายการนี้
  // หน้าตาเหมือนกราฟิกหัวต่อหัว (ใช้แผ่นสไตล์เดียวกัน) แต่นับคนละขอบเขต
  '/overlay-team-drafts': 'overlay-team-drafts.html',
  // ดราฟต์ของรอบก่อนหน้าในซีรีส์ที่กำลังคุมอยู่ พิคกับแบนอยู่ในกระดานเดียว
  //
  // เคยเป็นสองหน้าแยกกัน (/overlay-prev-picks กับ /overlay-prev-bans)
  // รวมเป็นหน้าเดียวแล้วลบสองหน้านั้นทิ้งตามที่ผู้ใช้สั่ง 2026-09-08
  '/overlay-prev': 'overlay-prev.html',
  // หน้าตั้งค่าภาพพื้นหลัง แยกจาก Control Panel เพราะเป็นงานก่อนแข่ง
  '/design': 'design.html',
  '/hotkeys': 'hotkeys.html',
  // คู่มือผู้ใช้ ไทย/อังกฤษ อยู่ในแอพเพื่อให้เปิดอ่านได้ตอนไม่มีเน็ต
  // และตอนที่กำลังงงอยู่หน้างาน ซึ่งเป็นเวลาที่ไม่มีใครไปเปิดไฟล์ใน docs/
  '/guide': 'guide.html',
  // หน้าตรวจเสียง เปิดเป็น browser source ใน OBS ได้ ไม่ได้อยู่ในแถบเมนู
  // เพราะเป็นเครื่องมือแก้ปัญหา ไม่ใช่หน้าที่ใช้ระหว่างคุมงาน
  '/sfx-test': 'sfx-test.html'
};

export function pageRoutes(): Router {
  const router = express.Router();

  Object.entries(PAGES).forEach(([route, file]) => {
    router.get(route, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, file)));
  });

  // หน้าเดียวเสิร์ฟทุก id ตัวหน้าเว็บอ่าน id เอาเองจาก URL
  //
  // ระวัง: หน้านี้อยู่ลึกกว่าหน้าอื่นหนึ่งชั้น (/tournament/xxxx)
  // ใน tournament.html ต้องอ้าง /js/... /css/... แบบเต็ม ห้ามใช้ path สัมพัทธ์
  // ไม่งั้นเบราว์เซอร์จะไปหาที่ /tournament/js/... แล้วได้ 404
  router.get('/tournament/:id', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'tournament.html'));
  });

  // โปรไฟล์ทีม ลึกกว่าหน้าอื่นหนึ่งชั้นเหมือน /tournament/:id
  // team.html จึงต้องอ้าง /js/... /css/... แบบเต็มเช่นกัน
  router.get('/teams/:id', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'team.html'));
  });

  // สายการแข่งแบบเห็นภาพ อยู่ลึกสองชั้น (/tournament/:id/bracket)
  // path ของ asset ยิ่งต้องเป็นแบบเต็ม
  router.get('/tournament/:id/bracket', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'bracket.html'));
  });

  // ประวัติพิค/แบนของทัวร์นาเมนต์ อยู่ลึกสองชั้นเหมือนหน้าสายการแข่ง
  //
  // เป็นหน้าย่อยของทัวร์นาเมนต์ ไม่ได้เพิ่มลงแถบเมนู
  // แถบเมนูต้องเหมือนกันทุกหน้าและมีเทสต์คุมอยู่ การเพิ่มหนึ่งช่องแปลว่า
  // ต้องแก้ทุกหน้าพร้อมกัน ส่วนหน้านี้เข้าถึงจากหน้าทัวร์นาเมนต์ก็พอ
  // (แบบเดียวกับ /tournament/:id/bracket)
  router.get('/tournament/:id/drafts', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'tournament-drafts.html'));
  });

  router.get('/index.html', (_req, res) => res.redirect('/control'));

  return router;
}
