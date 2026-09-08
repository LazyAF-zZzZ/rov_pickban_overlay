// รูปฮีโร่สำหรับกราฟิกออกอากาศ เลือกโฟลเดอร์ให้ถูกและถอยให้เป็น
//
// มีรูปฮีโร่สองชุด ใช้แทนกันไม่ได้
//
//   images/heroes        รูปเต็มตัว สำหรับช่องพิคใหญ่ๆ บน overlay หลัก
//   images/heroes-icons  รูปสี่เหลี่ยมจัตุรัสเห็นหน้า สำหรับช่องเล็กทุกที่
//
// ช่องที่เป็นสี่เหลี่ยมจัตุรัสต้องใช้ไอคอน เอารูปเต็มตัวมาย่อลงกรอบ 64-92px
// แล้วครอบตรงกลางจะเหลือแต่ไหล่กับพื้นหลัง ซึ่งดูไม่ออกว่าใครเป็นใคร
// overlay.js กับ result.js ใช้กฎนี้กับช่องแบนมาก่อนแล้ว ไฟล์นี้คือที่ที่กฎนั้นควรอยู่
//
// ทำไมต้องมีทางถอย: ชื่อฮีโร่คือชื่อไฟล์ภาพ (ดู domain/heroes.ts) และกราฟิกพวกนี้
// อ่านประวัติที่บันทึกไว้ ฮีโร่ที่ถูกเปลี่ยนชื่อไฟล์ไปแล้วจะยังถูกอ้างอยู่ในดราฟต์เก่า
// ตอนนี้สองโฟลเดอร์มีครบ 129 ตัวเท่ากัน แต่ความครบนั้นไม่มีอะไรบังคับไว้
//
// วิธีใช้:
//   <script src="/js/lib/hero-art.js"></script>
//   <script src="/js/หน้าของคุณ.js"></script>
// ไม่ต้องมีโทเคน ไม่แตะธีมและตัวแปลภาษา จึงโหลดในหน้าออกอากาศได้

(function (global) {
  function iconUrl(hero) {
    if (!hero || typeof hero !== 'string') return '';
    return `/images/heroes-icons/${encodeURIComponent(hero)}.png`;
  }

  function fullUrl(hero) {
    if (!hero || typeof hero !== 'string') return '';
    return `/images/heroes/${encodeURIComponent(hero)}.png`;
  }

  // ช่องที่วาดด้วย background-image
  //
  // background-image ไม่มี onerror จึงต้องยิงภาพทดสอบเองแล้วค่อยสลับถ้าไม่มี
  // ไม่ได้เปลืองคำขอเพิ่ม: ตัวทดสอบกับ background ขอไฟล์เดียวกัน อันหลังได้จากแคช
  //
  // ตั้ง src ครั้งเดียวเท่านั้น การเขียน src ทับด้วยค่าเดิมสั่งให้โหลดใหม่
  // ซึ่งเป็นวิธีสร้างวงจรที่ยิงคำขอไม่หยุด (วัดได้ 640 ครั้งต่อวินาที ดู overlay.js)
  function paint(element, hero) {
    if (!element) return;
    if (!hero) {
      element.style.backgroundImage = '';
      return;
    }

    const icon = iconUrl(hero);
    element.style.backgroundImage = `url("${icon}")`;

    const probe = new Image();
    probe.onerror = () => {
      // ไม่มีไอคอน ใช้รูปเต็มตัวแทน ไม่ลองต่ออีก
      // ไม่มีทั้งคู่ = ช่องว่างเปล่า ซึ่งเป็นปลายทางที่ถูกแล้ว ดีกว่าวนขอไม่เลิก
      element.style.backgroundImage = `url("${fullUrl(hero)}")`;
    };
    probe.src = icon;
  }

  // ช่องที่วาดด้วย <img>
  //
  // onGone ถูกเรียกเมื่อไม่มีทั้งไอคอนและรูปเต็ม หน้าที่ต้องการตัวแทน
  // (เช่นกระดานสถิติที่ใส่อักษรย่อแทน) ส่งฟังก์ชันมาได้ ไม่ส่งก็ถอดภาพนั้นทิ้ง
  function image(hero, className, onGone) {
    const img = document.createElement('img');
    if (className) img.className = className;
    img.alt = '';
    img.src = iconUrl(hero);

    img.onerror = () => {
      // ถอยได้ครั้งเดียว รอบสองแปลว่ารูปเต็มก็ไม่มี
      img.onerror = () => {
        img.onerror = null;
        if (typeof onGone === 'function') onGone(img);
        else img.remove();
      };
      img.src = fullUrl(hero);
    };

    return img;
  }

  global.RovHeroArt = { iconUrl, fullUrl, paint, image };
})(window);
