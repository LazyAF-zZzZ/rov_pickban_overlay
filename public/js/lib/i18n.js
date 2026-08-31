// ระบบสองภาษาของหน้าคนคุมงาน ไทยเป็นค่าเริ่มต้น
//
// กุญแจของคำแปลคือ "ข้อความภาษาอังกฤษ" ตัวมันเอง ไม่ใช่รหัสอย่าง btn.save
//
// ทำแบบนี้เพราะต้นฉบับอยู่ใน HTML อยู่แล้ว การใส่รหัสให้ครบ 300 กว่าจุดแปลว่า
// ต้องแก้ HTML ทุกบรรทัดและตั้งชื่อรหัสให้ไม่ชนกัน ซึ่งพังง่ายกว่าและอ่านยากกว่า
// วิธีนี้ HTML แค่ติดป้าย data-i18n ไว้เฉยๆ ตัวระบบจำข้อความอังกฤษเดิมไว้เอง
// สลับกลับเป็นอังกฤษได้เสมอเพราะต้นฉบับไม่เคยถูกทิ้ง
//
// คำเดียวกันที่แปลไม่เหมือนกันตามบริบท ให้ใส่รหัสเองเป็น data-i18n="ban.clear"
// แล้วเพิ่มรหัสนั้นในตารางคำแปล
//
// วิธีใช้ในหน้าใหม่ (ต้องโหลดก่อนสคริปต์ของหน้า):
//   <script src="/js/lib/i18n.js"></script>
// ข้อความที่ JS สร้างเอง ให้ครอบด้วย t() พร้อมภาษาอังกฤษเป็นค่าตั้งต้น:
//   showToast(t('Saved'), 'green');
//
// overlay กับ result ไม่โหลดไฟล์นี้ ตัวหนังสือบนจอคนดูเป็นอังกฤษตลอด
// เป็นการตัดสินใจของงานถ่ายทอด ไม่ใช่ของหน้าคนคุม

(function (global) {
  const STORE_KEY = 'rovLang';

  // ตารางคำแปล กุญแจ = ข้อความอังกฤษ (หรือรหัสที่ตั้งเอง)
  const TH = {
    // แถบบนและเมนู
    'HOME': 'หน้าแรก',
    'TEAMS': 'ทีม',
    'ANALYTICS': 'สถิติ',
    'CONTROL': 'คุมงาน',
    'DESIGN': 'ดีไซน์',
    'HOTKEYS': 'คีย์ลัด',
    'GUIDE': 'คู่มือ',
    'BACK': 'กลับ',

    // ปุ่มและคำที่ใช้ซ้ำทั้งแอพ
    'SAVE CHANGES': 'บันทึก',
    'REVERT': 'ย้อนกลับ',
    'CREATE': 'สร้าง',
    'CONFIRM': 'ยืนยัน',
    'CANCEL': 'ยกเลิก',
    'CLOSE': 'ปิด',
    'CLEAR': 'ล้าง',
    'CLEAR FORM': 'ล้างฟอร์ม',
    'DELETE': 'ลบ',
    'UPLOAD': 'อัปโหลด',
    'OPEN': 'เปิด',
    'COPY URL': 'คัดลอก URL',
    'TEST': 'ลองฟัง',
    'PLAY': 'เล่น',
    'CHANGE': 'เปลี่ยน',
    'RESET': 'รีเซ็ต',
    'RESET ALL': 'รีเซ็ตทั้งหมด',
    'RELOAD': 'โหลดใหม่',
    'Search': 'ค้นหา',
    'Name': 'ชื่อ',
    'Note': 'โน้ต',
    'Note (optional)': 'โน้ต (จะใส่หรือไม่ก็ได้)',
    'Status': 'สถานะ',
    'Format': 'รูปแบบการแข่ง',
    'Series length': 'จำนวนเกมต่อคู่',

    // สถานะการเชื่อมต่อ (JS เป็นคนใส่)
    'Connecting': 'กำลังเชื่อมต่อ',
    'Live': 'เชื่อมต่อแล้ว',
    'Server offline': 'เซิร์ฟเวอร์ไม่ทำงาน',
    'No connection': 'เชื่อมต่อไม่ได้',
    'Connected': 'เชื่อมต่อแล้ว',
    'Disconnected': 'หลุดการเชื่อมต่อ',

    // หน้าแรก
    'Tournaments': 'ทัวร์นาเมนต์',
    '+ NEW TOURNAMENT': '+ สร้างทัวร์นาเมนต์',
    'Tournament name': 'ชื่อทัวร์นาเมนต์',
    'Banner on air': 'แบนเนอร์ออกอากาศอยู่',
    'Banner hidden': 'ซ่อนแบนเนอร์อยู่',

    // ทะเบียนทีม
    'Team registry': 'ทะเบียนทีม',
    'Teams': 'ทีม',
    'Team': 'ทีม',
    '+ NEW TEAM': '+ สร้างทีม',
    'CREATE TEAM': 'สร้างทีม',
    'Team name': 'ชื่อทีม',
    'Team Name': 'ชื่อทีม',
    'Team details': 'ข้อมูลทีม',
    'Team logo': 'โลโก้ทีม',
    'Team Logo': 'โลโก้ทีม',
    'Tag': 'ตัวย่อ',
    'CHOOSE LOGO': 'เลือกโลโก้',
    'UPLOAD LOGO': 'อัปโหลดโลโก้',
    'CLEAR LOGO': 'ลบโลโก้',
    'DELETE TEAM': 'ลบทีม',
    '← ALL TEAMS': '← ทีมทั้งหมด',
    'Match history': 'ประวัติการแข่ง',

    // ทัวร์นาเมนต์
    '← ALL TOURNAMENTS': '← ทัวร์นาเมนต์ทั้งหมด',
    '← TOURNAMENT': '← ทัวร์นาเมนต์',
    'Tournament': 'ทัวร์นาเมนต์',
    'Tournament details': 'ข้อมูลทัวร์นาเมนต์',
    'DELETE TOURNAMENT': 'ลบทัวร์นาเมนต์',
    '+ ADD TEAM': '+ เพิ่มทีม',
    'Add a team already in the registry': 'เลือกทีมที่มีอยู่ในทะเบียนแล้ว',
    'ADD TO TOURNAMENT': 'เพิ่มเข้าทัวร์นาเมนต์',
    '…or create a new team': '…หรือสร้างทีมใหม่',
    'CREATE & ADD': 'สร้างแล้วเพิ่มเลย',
    'OPEN MATCH SESSION': 'เปิดสายการแข่ง',
    'OBS browser sources': 'browser source สำหรับ OBS',

    // สายการแข่ง
    'Match session': 'สายการแข่ง',
    'DRAW MATCHES': 'จับสาย',

    // หน้าคุมงาน
    'Blue Team': 'ทีมน้ำเงิน',
    'Red Team': 'ทีมแดง',
    'Draft Timer': 'จับเวลาดราฟต์',
    'Sound effects': 'เสียงเอฟเฟกต์',
    'FROM REGISTRY': 'เลือกจากทะเบียน',
    'From registry': 'เลือกจากทะเบียน',
    'Auto-saves': 'บันทึกอัตโนมัติ',
    'Saved': 'บันทึกแล้ว',
    'SCORE': 'คะแนน',
    'NICKNAME': 'ชื่อในเกม',
    'HERO PICK': 'ฮีโร่ที่เลือก',
    'BAN': 'แบน',
    'SIZE': 'ขนาด',
    'BANNER': 'แบนเนอร์',
    'SHOW': 'แสดง',
    'HIDE': 'ซ่อน',
    'START': 'เริ่ม',
    'PAUSE': 'หยุด',
    'RESUME': 'ไปต่อ',
    'PREV': 'ก่อนหน้า',
    'NEXT': 'ถัดไป',
    '↶ UNDO': '↶ ย้อนกลับ',
    'SWITCH TEAMS': 'สลับฝั่ง',
    'RESET MATCH': 'เริ่มแมตช์ใหม่',
    'CLEAR PICKS & BANS': 'ล้างพิคและแบน',
    'READY': 'พร้อม',
    'Choose a team…': 'เลือกทีม…',
    'No saved teams yet': 'ยังไม่มีทีมที่บันทึกไว้',
    'Pick': 'พิค',
    'Ban': 'แบน',
    'Timer': 'เวลา',

    // คีย์ลัด
    'Control panel hotkeys': 'คีย์ลัดของหน้าคุมงาน',
    'Click CHANGE, then press the key you want': 'กด CHANGE แล้วกดปุ่มที่ต้องการ',
    'Fixed keys': 'ปุ่มที่เปลี่ยนไม่ได้',
    'Text editing, not rebindable': 'ใช้ตอนพิมพ์ เปลี่ยนไม่ได้',

    // ดีไซน์
    'Custom Design': 'ภาพพื้นหลังของคุณเอง',
    'Overlay theme': 'ธีมของ overlay',
    'RESET TO ORIGINAL': 'กลับเป็นค่าเดิม',
    'Team colours': 'สีของทีม',
    'Hero cards': 'การ์ดฮีโร่',
    'Centre column': 'คอลัมน์กลาง',
    'Ban row and labels': 'แถวแบนและป้ายกำกับ',

    // สถิติ
    'Pick & ban analytics': 'สถิติพิคและแบน',
    'ALL GAMES': 'ทุกเกม',

    // หน้าตรวจเสียง
    'Sound files': 'ไฟล์เสียง',
    'How to read this': 'อ่านผลยังไง',

    // คำใบ้ในช่องกรอก
    'Find a hero': 'ค้นหาฮีโร่',
    'Team name or tag': 'ชื่อทีมหรือตัวย่อ',
    'Match Title': 'ชื่อแมตช์',

    // เลือกหลายทีมแล้วลบทีเดียว
    'Select all shown': 'เลือกทั้งหมดที่แสดงอยู่',
    'Select': 'เลือก',
    'Select for bulk delete': 'ติ๊กเพื่อเลือกไว้ลบพร้อมกัน',
    'selected': 'ทีมถูกเลือก',
    'CLEAR SELECTION': 'ล้างที่เลือก',
    'DELETE SELECTED': 'ลบที่เลือก',
    'Delete selected teams': 'ลบทีมที่เลือกไว้',
    'Delete these teams from the registry?': 'ลบทีมเหล่านี้ออกจากทะเบียนใช่ไหม',
    'Delete team': 'ลบทีม',
    'Delete this team from the registry?': 'ลบทีมนี้ออกจากทะเบียนใช่ไหม',
    'They are dropped from every tournament they entered. Match history keeps the names as they were on the day.':
      'ทีมพวกนี้จะหลุดจากทุกทัวร์นาเมนต์ที่เคยลงแข่ง ส่วนประวัติการแข่งยังเก็บชื่อ ณ วันที่ลงเล่นไว้เหมือนเดิม',
    'It is dropped from every tournament it entered. Match history keeps the name as it was on the day.':
      'ทีมนี้จะหลุดจากทุกทัวร์นาเมนต์ที่เคยลงแข่ง ส่วนประวัติการแข่งยังเก็บชื่อ ณ วันที่ลงเล่นไว้เหมือนเดิม',
    'Teams deleted': 'ลบทีมแล้ว',
    'Could not delete the teams': 'ลบทีมไม่สำเร็จ',
    'Could not delete the team': 'ลบทีมไม่สำเร็จ',
    'and': 'และอีก',
    'more': 'ทีม',


    // ข้อความที่ JS สร้างขึ้น (toast, กล่องยืนยัน, ปุ่มที่สร้างเอง)
    'Team saved': 'บันทึกทีมแล้ว',
    'Team added': 'เพิ่มทีมแล้ว',
    'Team deleted': 'ลบทีมแล้ว',
    'Team loaded': 'โหลดทีมขึ้นจอแล้ว',
    'Team not found': 'ไม่พบทีมนี้',
    'Team name is required': 'ต้องใส่ชื่อทีม',
    'Tournament name is required': 'ต้องใส่ชื่อทัวร์นาเมนต์',
    'Tournament not found': 'ไม่พบทัวร์นาเมนต์นี้',
    'Removed from tournament': 'เอาออกจากทัวร์นาเมนต์แล้ว',
    'Reverted to saved values': 'ย้อนกลับเป็นค่าที่บันทึกไว้',
    'Form cleared': 'ล้างฟอร์มแล้ว',
    'Logo uploaded': 'อัปโหลดโลโก้แล้ว',
    'Logo cleared': 'ลบโลโก้แล้ว',
    'Logo must be under 4 MB': 'โลโก้ต้องเล็กกว่า 4 MB',
    'File must be under 8 MB': 'ไฟล์ต้องเล็กกว่า 8 MB',
    'PNG, JPG or WEBP, up to 4 MB': 'PNG, JPG หรือ WEBP ไม่เกิน 4 MB',
    'URL copied': 'คัดลอก URL แล้ว',
    'Copy failed': 'คัดลอกไม่สำเร็จ',
    'Copy failed - select the URL and copy it by hand':
      'คัดลอกไม่สำเร็จ ให้คลิกที่ URL แล้วกด Ctrl+C เอง',
    'Bracket cleared': 'ล้างสายแล้ว',
    'Could not load this match session': 'เปิดสายการแข่งนี้ไม่ได้',
    'Could not load hotkeys': 'โหลดคีย์ลัดไม่ได้',
    'All hotkeys reset': 'รีเซ็ตคีย์ลัดทั้งหมดแล้ว',
    'Cancelled': 'ยกเลิกแล้ว',
    'Draft started': 'เริ่มดราฟต์แล้ว',
    'Paused': 'หยุดชั่วคราว',
    'Resumed': 'ไปต่อแล้ว',
    'Timer reset': 'รีเซ็ตเวลาแล้ว',
    'Reset match': 'เริ่มแมตช์ใหม่',
    'State reset': 'รีเซ็ตข้อมูลแล้ว',
    'Teams switched': 'สลับฝั่งแล้ว',
    'Clear picks and bans': 'ล้างพิคและแบน',
    'All picks and bans cleared': 'ล้างพิคและแบนแล้ว',
    'Hero not found': 'ไม่พบฮีโร่นี้',
    'Delete tournament': 'ลบทัวร์นาเมนต์',
    'DELETE FOREVER': 'ลบถาวร',
    'DELETE FROM REGISTRY': 'ลบออกจากทะเบียน',
    'Theme reset to original': 'คืนธีมเป็นค่าเดิมแล้ว',
    'Preview reloaded': 'โหลดตัวอย่างใหม่แล้ว',
    'Could not play that sound': 'เล่นเสียงนี้ไม่ได้',
    'Some controls on this page failed to start - try a hard reload':
      'บางส่วนของหน้านี้เริ่มทำงานไม่สำเร็จ ลองรีโหลดแบบล้างแคช',
    'No matches yet. Draw a bracket in a tournament this team has entered.':
      'ยังไม่มีแมตช์ ต้องจับสายในทัวร์นาเมนต์ที่ทีมนี้ลงแข่งก่อน',
    'This team has not been added to a tournament yet.':
      'ทีมนี้ยังไม่ได้ถูกเพิ่มเข้าทัวร์นาเมนต์ไหนเลย',
    'ON AIR': 'กำลังออกอากาศ',
    'SAVE TEAM': 'บันทึกทีม',
    'PROFILE': 'โปรไฟล์',
    'EDIT': 'แก้ไข',
    'DEFAULT': 'ค่าเริ่มต้น',
    'Seed': 'ลำดับวางสาย',
    'Role': 'ตำแหน่ง',
    'Players': 'ผู้เล่น',
    'to be decided': 'ยังไม่รู้คู่แข่ง',
    'no opponent': 'ไม่มีคู่แข่ง',
    'clear': 'ล้าง',

    // ข้อความว่าง
    'No tournaments yet. Create one to get started.':
      'ยังไม่มีทัวร์นาเมนต์ กดสร้างเพื่อเริ่มใช้งาน'
  };

  function read() {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved === 'en' || saved === 'th') return saved;
    } catch (error) {
      // โหมดส่วนตัวหรือปิด storage ไว้ ใช้ค่าเริ่มต้น
    }
    return 'th';   // คนใช้เครื่องมือนี้เป็นคนไทยเป็นหลัก
  }

  let lang = read();
  const listeners = [];

  // แปลข้อความหนึ่งชิ้น ภาษาอังกฤษคือค่าตั้งต้นเสมอ
  // ไม่มีคำแปลก็คืนอังกฤษไป ดีกว่าโชว์รหัสหรือช่องว่าง
  function t(key, english) {
    const fallback = english === undefined ? key : english;
    if (lang !== 'th') return fallback;
    return Object.prototype.hasOwnProperty.call(TH, key) ? TH[key] : fallback;
  }

  // จำต้นฉบับอังกฤษไว้ที่ตัว element เอง ครั้งแรกที่เจอ
  // ถ้าไม่จำ พอสลับเป็นไทยแล้วสลับกลับ ข้อความอังกฤษจะหายไปตลอดกาล
  function sourceOf(el, attr) {
    const store = attr ? `i18nSrc_${attr}` : 'i18nSrc';
    if (el.dataset[store] === undefined) {
      el.dataset[store] = attr ? (el.getAttribute(attr) || '') : el.textContent.trim();
    }
    return el.dataset[store];
  }

  function applyTo(root) {
    const scope = root || document;

    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const explicit = el.getAttribute('data-i18n');
      const source = sourceOf(el);
      const key = explicit || source;
      el.textContent = t(key, source);
    });

    // แอตทริบิวต์ที่ผู้ใช้เห็น ต้องแปลด้วย ไม่งั้นคำใบ้ในช่องกรอกยังเป็นอังกฤษ
    [['data-i18n-placeholder', 'placeholder'], ['data-i18n-title', 'title']].forEach(([flag, attr]) => {
      scope.querySelectorAll(`[${flag}]`).forEach((el) => {
        const explicit = el.getAttribute(flag);
        const source = sourceOf(el, attr);
        const key = explicit === '' ? source : explicit;
        el.setAttribute(attr, t(key, source));
      });
    });

    document.documentElement.lang = lang;
  }

  function set(next) {
    if (next !== 'en' && next !== 'th') return;
    lang = next;
    try {
      localStorage.setItem(STORE_KEY, lang);
    } catch (error) {
      // จำไม่ได้ก็ยังใช้ได้ในรอบนี้
    }
    applyTo(document);
    syncToggle();
    // หน้าที่วาดเนื้อหาด้วย JS ต้องวาดใหม่เอง ตัวระบบไม่รู้จักของที่ยังไม่ได้สร้าง
    listeners.forEach((fn) => {
      try { fn(lang); } catch (error) { /* หน้าหนึ่งพังต้องไม่ลากหน้าอื่นลงไปด้วย */ }
    });
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.push(fn);
  }

  // ปุ่มสลับภาษาใส่ให้เองทุกหน้า ไม่ต้องไปแก้ HTML ทีละหน้า
  // ลืมใส่หน้าใดหน้าหนึ่ง = หน้านั้นสลับภาษาไม่ได้ ซึ่งหาสาเหตุยากกว่าที่ควร
  let toggle = null;

  function syncToggle() {
    if (!toggle) return;
    toggle.textContent = lang === 'th' ? 'EN' : 'ไทย';
    toggle.title = lang === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย';
  }

  function mountToggle() {
    const bar = document.querySelector('.topbar');
    const nav = bar && bar.querySelector('.topnav');
    if (!bar || toggle) return;

    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'tlink lang-toggle';
    toggle.addEventListener('click', () => set(lang === 'th' ? 'en' : 'th'));
    syncToggle();

    // วางไว้ท้ายสุดของแถบเมนู ถัดจากหน้าสุดท้าย
    if (nav) nav.appendChild(toggle);
    else bar.appendChild(toggle);
  }

  function boot() {
    mountToggle();
    applyTo(document);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.RovI18n = { t, apply: applyTo, set, onChange, get lang() { return lang; } };
  // ทางลัด หน้าไหนก็เรียก t() ได้เลยโดยไม่ต้อง destructure
  global.t = t;
})(window);
