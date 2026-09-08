// ของที่กราฟิกออกอากาศทุกหน้าใช้เหมือนกันเป๊ะ
//
// ก่อนมีไฟล์นี้ intParam กับ note ถูกคัดลอกไว้หน้าละชุด รวมหกชุดต่อฟังก์ชัน
// ทั้งหกชุดยังเหมือนกันทุกตัวอักษรตอนที่ย้ายมารวม แต่เพื่อนบ้านของมันไม่ใช่:
// settleSoon มีหกชุดที่ต่างกันห้าแบบแล้ว และ fitToStage มีสี่ชุดที่ต่างกันทั้งสี่
// ซึ่งเป็นเหตุผลที่ต้องมีไฟล์นี้ ไม่ใช่เพราะโค้ดซ้ำแล้วดูไม่สวย
//
// กับดักที่ตามมาด้วยจริงๆ: fitToStage ของ /overlay-standings ยังเป็นเวอร์ชันที่
// วัดจากขอบกล่องแทนที่จะวัดจากการ์ดใบแรก ทั้งที่อีกสามหน้าแก้ไปแล้ว
// การแก้ที่เดียวแล้วอีกห้าที่ยังเป็นของเก่าคือรูปแบบความพังที่ CLAUDE.md เตือนไว้
// (กฎเดียวกับ team-ui.js และ obs-sources.js)
//
// วิธีใช้:
//   <script src="/js/lib/overlay-common.js"></script>
//   <script src="/js/หน้าของคุณ.js"></script>
// แล้วเรียก
//   const params = new URLSearchParams(window.location.search);
//   const rounds = RovOverlay.intParam(params, 'rounds', 15, 1, 15);
//
// ไม่แตะธีมและตัวแปลภาษา จึงโหลดในหน้าออกอากาศได้ ไม่ต้องมีโทเคน

(function (global) {
  // อ่านตัวเลขจาก URL แบบมีค่าเริ่มต้นจริงๆ
  //
  // ระวัง: Number(null) เป็น 0 และ 0 ผ่าน Number.isFinite ได้
  // เช็คแค่ isFinite พารามิเตอร์ที่ไม่ได้ใส่มาจะกลายเป็น 0 ไม่ใช่ค่าเริ่มต้น
  //
  // เคยเป็นบั๊กจริงสองครั้ง:
  //   ?vol= ที่ไม่ได้ใส่ กลายเป็น 0 แล้วเสียงเงียบทั้งงาน (ดู CLAUDE.md)
  //   ?stagger= ที่ไม่ได้ใส่ ใน /overlay-teams กลายเป็น 0 แล้วการ์ดเข้าพร้อมกันหมด
  //   อนิเมชันยังเล่นอยู่ ไม่มีอะไรพัง จึงมองไม่เห็นว่าหายไปจนกว่าจะจ้องดู
  //
  // ค่าที่อ่านไม่ออกตกไปที่ fallback ไม่ใช่ตกไปที่ min
  // กราฟิกที่ย่อลงเหลือค่าต่ำสุดเพราะพิมพ์ผิด อ่านบนจอเหมือนข้อมูลจริง ไม่เหมือนพิมพ์ผิด
  function intParam(params, name, fallback, min, max) {
    const value = params.get(name);
    if (value === null || value.trim() === '') return fallback;
    const raw = Number(value);
    if (!Number.isFinite(raw)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(raw)));
  }

  // ข้อความสถานะกลางกระดาน ทุกหน้ามี <div id="note" hidden> ของตัวเอง
  // ส่งข้อความว่างหรือ null = ซ่อน ไม่ใช่แสดงบรรทัดว่าง
  function note(message) {
    const el = document.getElementById('note');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  global.RovOverlay = { intParam, note };
})(window);
