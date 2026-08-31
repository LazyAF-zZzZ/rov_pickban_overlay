// สลับภาษาของหน้าคู่มือ
//
// เนื้อหาทั้งสองภาษาอยู่ในหน้าเลยตั้งแต่แรก ไม่ได้โหลดทีหลัง
// คู่มือต้องเปิดอ่านได้ตอนที่อย่างอื่นพังอยู่ ยิ่งพึ่งอะไรน้อยยิ่งดี
// ไม่ใช้ app-client.js ด้วยเหตุผลเดียวกัน หน้านี้ไม่ต้องต่อ socket ไม่ต้องมีโทเคน
//
// จำภาษาที่เลือกไว้ใน localStorage คนคุมงานคนเดิมเปิดคู่มือหลายรอบใน
// วันเดียวกัน ไม่ต้องมากดสลับใหม่ทุกครั้ง

(function () {
  const buttons = {
    en: document.getElementById('btnEn'),
    th: document.getElementById('btnTh')
  };

  function apply(lang) {
    const other = lang === 'th' ? 'en' : 'th';

    const show = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(`[data-lang="${lang}"]`));
    const hide = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(`[data-lang="${other}"]`));
    show.forEach((el) => { el.hidden = false; });
    hide.forEach((el) => { el.hidden = true; });

    buttons.en.setAttribute('aria-pressed', String(lang === 'en'));
    buttons.th.setAttribute('aria-pressed', String(lang === 'th'));
    document.documentElement.lang = lang;

    try {
      localStorage.setItem('rovGuideLang', lang);
    } catch (error) {
      // เปิดในโหมดส่วนตัวหรือปิด storage ไว้ ก็แค่ไม่จำ ไม่ใช่เรื่องใหญ่
    }
  }

  let saved = null;
  try {
    saved = localStorage.getItem('rovGuideLang');
  } catch (error) {
    saved = null;
  }

  // ยังไม่เคยเลือก ให้เดาจากภาษาของเบราว์เซอร์ แอพนี้ใช้กันในไทยเป็นหลัก
  const guessThai = saved === null && String(navigator.language || '').toLowerCase().startsWith('th');
  apply(saved === 'th' || guessThai ? 'th' : 'en');

  buttons.en.addEventListener('click', () => apply('en'));
  buttons.th.addEventListener('click', () => apply('th'));
})();
