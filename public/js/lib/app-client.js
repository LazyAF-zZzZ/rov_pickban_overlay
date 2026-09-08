// ของที่ทุกหน้าฝั่งควบคุมต้องใช้เหมือนกันหมด: โทเคน, socket, fetch, toast
//
// เดิมโค้ดก้อนนี้ถูกคัดลอกไว้ใน home.js / control.js / design.js / hotkeys.js
// ไฟล์ละชุด แก้ทีหนึ่งต้องไล่แก้ทุกที่
//
// วิธีใช้ในหน้าใหม่ (เช่น หน้าทัวร์นาเมนต์ / รายชื่อทีม / สถิติ):
//   <script src="/socket.io/socket.io.js"></script>
//   <script src="js/lib/app-client.js"></script>
//   <script src="js/หน้าใหม่.js"></script>
// แล้วในไฟล์ js ขึ้นต้นด้วย
//   const { socket, fetchJson, showToast } = window.RovClient;
//
// หมายเหตุ: หน้า overlay กับ result ไม่ใช้ไฟล์นี้ เพราะเป็นหน้าดูอย่างเดียว
// ต่อ socket เปล่าๆ ไม่ต้องมีโทเคน และไม่มีกล่อง toast ให้แสดง

(function (global) {
  const params = new URLSearchParams(window.location.search);

  // localStorage โยน error ได้ ไม่ใช่แค่คืน null
  //
  // เบราว์เซอร์ที่ตั้งค่าบล็อกข้อมูลเว็บไซต์ไว้ (รวมถึง localhost) จะโยน SecurityError
  // ตั้งแต่ตอน "อ่าน" property เลย ไม่ใช่ตอนเรียกเมธอด
  //
  // สองบรรทัดนี้เป็นคำสั่งแรกสุดของโมดูลที่ทุกหน้าคนคุมงานโหลด ถ้ามันโยนที่นี่
  // window.RovClient จะไม่ถูกสร้างเลย แล้วทุกหน้าจะตายตั้งแต่บรรทัดแรกที่ destructure
  // มันออกมา = หน้าขาวทั้งหน้า ไม่มี handler สักตัว และ error ชี้ไปที่โค้ดที่อ่านแล้วปกติดี
  // เป็นอาการเดียวกับที่ CLAUDE.md อธิบายไว้ตอนลืมแท็ก team-ui.js
  //
  // ที่อื่นในโปรเจกต์ (i18n.js, tournament.js) กันไว้แล้วพร้อมคอมเมนต์เรื่องนี้
  // ตรงนี้เป็นจุดเดียวที่หลุด และเป็นจุดที่เสียหายมากที่สุด
  function recall(key) {
    try { return localStorage.getItem(key) || ''; } catch { return ''; }
  }
  function remember(key, value) {
    try { localStorage.setItem(key, value); } catch { /* จำไม่ได้ก็ยังใช้ได้ในรอบนี้ */ }
  }

  const controlToken = params.get('token') || recall('rovControlToken');
  if (controlToken) remember('rovControlToken', controlToken);

  const socket = global.io
    ? global.io({ auth: { token: controlToken }, query: controlToken ? { token: controlToken } : {} })
    : null;

  // แนบโทเคนไปกับ URL ไว้ให้ลิงก์ที่เปิดหน้าต่างใหม่ยังคุมได้
  function withToken(url) {
    if (!controlToken) return url;
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(controlToken)}`;
  }

  // URL เต็มรวมโดเมน ไว้ก๊อปไปวางใน OBS
  function absoluteUrl(path) {
    const url = new URL(path, window.location.origin);
    if (controlToken) url.searchParams.set('token', controlToken);
    return url.toString();
  }

  async function fetchJson(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (controlToken) headers.Authorization = `Bearer ${controlToken}`;

    // มี body แต่ไม่ได้บอกชนิด = เซิร์ฟเวอร์ไม่แกะให้เลย
    //
    // fetch() ตั้ง Content-Type ให้เป็น text/plain เองเมื่อ body เป็นสตริง
    // ส่วน express.json() แกะเฉพาะ application/json มันจึงข้ามไปเงียบๆ
    // req.body กลายเป็น {} แล้วเซิร์ฟเวอร์ก็เดินต่อด้วยค่าเริ่มต้นเหมือนไม่มีอะไรผิด
    //
    // เห็นกับตาแล้ว: ปุ่มจับสายรอบน็อกเอาต์ส่ง perGroup = 2 ไป แต่ฝั่งเซิร์ฟเวอร์
    // อ่านไม่เจอ เลยได้ค่าต่ำสุดคือ 1 ผลคือผ่านเข้ารอบกลุ่มละทีมเดียว
    // ไม่มี error ไม่มีอะไรบนจอบอกว่าเลขที่กรอกไปถูกทิ้ง
    //
    // ผู้เรียกทุกคนที่มีอยู่ตั้ง header นี้เองอยู่แล้ว การตั้งให้ตรงนี้จึงไม่เปลี่ยน
    // พฤติกรรมของใคร แต่ทำให้ "ลืมตั้ง" ไม่ใช่ความผิดพลาดที่เป็นไปได้อีกต่อไป
    if (options.body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(withToken(url), { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || response.statusText);
    return data;
  }

  // ชนิดของ toast -> โทเคนสีในธีม
  //
  // 'green' เป็นชื่อที่หน้าต่างๆ เรียกกันมาตั้งแต่ต้น และเป็นค่าเริ่มต้นของ showToast
  // แต่ธีมนี้ไม่มีสีเขียว (theme.css มีแค่ทอง/น้ำเงิน/แดง) --green จึงไม่เคยถูกประกาศเลย
  //
  // var() ที่ชี้ไปยังตัวแปรที่ไม่มีอยู่ ไม่ได้ถูกมองข้ามเฉยๆ แต่ทำให้พร็อพเพอร์ตี้นั้น
  // ตกไปเป็นค่า unset ซึ่งของ border-left-color (ไม่ถ่ายทอด) คือ currentColor
  // ขอบซ้ายของ toast สำเร็จจึงกลายเป็นสีตัวหนังสือ (ขาวนวล) ทุกครั้ง
  // ทั้งที่ .toast ใน CSS ตั้งไว้เป็นทอง = เสียการแยกสีไปทั้งชนิด โดยไม่มี error ให้เห็น
  //
  // ทองคือสีของ "สำเร็จ / กำลังเกิดขึ้นตอนนี้" ในธีมนี้ ตามกฎใน CLAUDE.md
  const TOAST_COLORS = { green: 'var(--gold)', blue: 'var(--blue)', red: 'var(--red)' };

  function showToast(msg, type = 'green') {
    const el = document.getElementById('toast_el');
    if (!el) return;
    el.style.borderLeftColor = TOAST_COLORS[type] || TOAST_COLORS.green;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // กล่องยืนยันกลาง สำหรับงานที่ทำแล้วย้อนกลับไม่ได้
  //
  // ไม่ใช้ window.confirm() ด้วยเหตุผลเดียวกับกล่องยืนยันในหน้า Control:
  // ใน Electron กล่องของระบบเป็น modal ของทั้งหน้าต่าง ปิดแล้วคีย์บอร์ดหลุด
  // และเขียนข้อความหลายบรรทัดให้อ่านง่ายไม่ได้
  //
  // สองหน้านั้นมี markup ของกล่องอยู่ในตัวเอง หน้าอื่นไม่มี ตัวนี้จึงสร้าง DOM
  // เองตอนถูกเรียก โดยใช้คลาสชุดเดียวกัน (สไตล์อยู่ใน app.css)
  //
  // body รับได้ทั้งข้อความเดียวและอาร์เรย์ของย่อหน้า ทุกบรรทัดวางด้วย
  // textContent เพราะชื่อทัวร์นาเมนต์กับชื่อทีมเป็นข้อความจากผู้ใช้
  function confirmBox({ title, body, confirmLabel, cancelLabel, danger = false }) {
    const translate = typeof global.t === 'function' ? global.t : (key) => key;
    const okText = confirmLabel || translate('CONFIRM');
    const cancelText = cancelLabel || translate('CANCEL');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';

    const box = document.createElement('div');
    box.className = 'modal';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');

    const head = document.createElement('div');
    head.className = 'modal-title';
    head.textContent = title;

    const text = document.createElement('div');
    text.className = 'modal-body';
    (Array.isArray(body) ? body : [body]).forEach((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      text.appendChild(p);
    });

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'tlink';
    cancelBtn.textContent = cancelText;

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = danger ? 'tlink danger' : 'tlink primary';
    okBtn.textContent = okText;

    actions.append(cancelBtn, okBtn);
    box.append(head, text, actions);
    backdrop.appendChild(box);

    const previousFocus = /** @type {HTMLElement | null} */ (document.activeElement);
    document.body.appendChild(backdrop);

    // งานที่ลบของทิ้งเริ่มที่ปุ่มยกเลิก เคาะ Enter ทันทีแล้วต้องไม่มีอะไรหาย
    (danger ? cancelBtn : okBtn).focus();

    return new Promise((resolve) => {
      const close = (answer) => {
        backdrop.remove();
        document.removeEventListener('keydown', onKey, true);
        if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
        resolve(answer);
      };

      // ดักชั้น capture เพื่อกินคีย์ก่อนใครทั้งหมด แล้วหยุดไม่ให้ไหลต่อ
      // ไม่งั้น Esc จะปิดกล่องแล้วเด้งย้อนหน้าต่อไปอีกทีด้วยการกดครั้งเดียว
      const onKey = (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close(false);
      };
      document.addEventListener('keydown', onKey, true);

      cancelBtn.addEventListener('click', () => close(false));
      okBtn.addEventListener('click', () => close(true));
      backdrop.addEventListener('mousedown', (event) => {
        if (event.target === backdrop) close(false);   // คลิกนอกกล่อง
      });
    });
  }

  // Esc = ย้อนกลับไปหน้าก่อนหน้า
  //
  // แอปเปิดในหน้าต่าง Electron ที่ไม่มีปุ่ม Back ของเบราว์เซอร์ให้กด
  // คนคุมงานจึงต้องมีทางถอยออกจากหน้าย่อย (สายแมตช์ / หน้าทีม) ด้วยคีย์บอร์ด
  //
  // ดักที่ window ชั้น bubble ซึ่งเป็นชั้นสุดท้าย เพื่อให้หน้าที่ Esc มีความหมาย
  // อยู่ก่อนแล้วได้ทำงานก่อน: กล่องยืนยันของหน้า Control เรียก preventDefault()
  // หรือ stopPropagation() ไว้ กด Esc ปิดกล่องจึงไม่เด้งออกจากหน้าไปด้วย
  //
  // event.target คือช่องที่โฟกัสอยู่ตอนกดเสมอ แม้ handler ของหน้าจะ blur ทิ้งไปแล้ว
  // ก่อนมาถึงตรงนี้ ดูจาก target จึงเชื่อถือได้กว่า document.activeElement
  /** @param {EventTarget | null} target */
  function isTypingTarget(target) {
    const el = /** @type {HTMLElement | null} */ (target);
    if (!el || !el.tagName) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return el.isContentEditable === true;
  }

  // ไม่มีประวัติให้ถอย (เปิดหน้านี้ตรงๆ จากลิงก์) ก็ใช้ลิงก์ย้อนกลับของหน้าเอง
  // หน้าไหนไม่มีลิงก์นั้นให้กลับหน้าแรก ยกเว้นตัวเองเป็นหน้าแรกอยู่แล้ว
  //
  // history.length อย่างเดียวไม่พอ ในแท็บเบราว์เซอร์ที่เพิ่งเปิดใหม่จะนับหน้าว่าง
  // about:blank เป็นประวัติหนึ่งช่องด้วย ถอยไปแล้วจะได้จอขาวแทนที่จะได้หน้าแอป
  // ต้องเห็น referrer เป็นโดเมนเดียวกันด้วย ถึงจะแน่ใจว่าหน้าก่อนหน้าคือหน้าของแอป
  function cameFromApp() {
    if (!document.referrer) return false;
    try {
      return new URL(document.referrer).origin === window.location.origin;
    } catch {
      return false;
    }
  }

  function goBack() {
    if (window.history.length > 1 && cameFromApp()) {
      window.history.back();
      return;
    }
    const link = /** @type {HTMLAnchorElement | null} */ (document.querySelector('[data-esc-back]'));
    const href = link ? link.getAttribute('href') : (window.location.pathname === '/' ? '' : '/');
    if (href) window.location.href = withToken(href);
  }

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.repeat) return;
    if (event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
    if (isTypingTarget(event.target)) return;
    // เผื่อหน้าไหนมีกล่องทึบแต่ยังไม่ได้ดัก Esc เอง ปิดกล่องสำคัญกว่าถอยหน้า
    if (document.querySelector('.modal-backdrop:not([hidden])')) return;
    goBack();
  });

  // รับสัญญาณว่าข้อมูลฝั่งทัวร์นาเมนต์เปลี่ยน แล้วให้หน้าไปดึงเฉพาะส่วนที่ตัวเองสนใจ
  //
  // สัญญาณมีแค่หัวข้อกับ id ไม่มีข้อมูลจริงติดมา (ดู server/services/sync.ts)
  //
  // ต้องขอเข้าห้องใหม่ทุกครั้งที่ต่อใหม่ ห้องของ socket.io ไม่ตามมาเองหลัง reconnect
  // เน็ตกระตุกทีเดียวแล้วหน้าจะเงียบไปตลอดกาลโดยไม่มีอะไรบอก
  function onDataChange(handler) {
    if (!socket) return;
    const join = () => socket.emit('data:join');
    socket.on('connect', join);
    if (socket.connected) join();
    socket.on('dataChanged', (change) => handler(change || {}));
  }

  // ตอนนี้มีคนกำลังพิมพ์อยู่ในส่วนนี้ไหม
  //
  // การรีเฟรชอัตโนมัติห้ามวาดทับช่องที่กำลังถูกกรอก
  // ไม่งั้นกรอกชื่อทีมค้างไว้ครึ่งทาง อีกจอกดอะไรสักอย่าง แล้วที่พิมพ์ไว้หายทันที
  // เป็นกฎเดียวกับที่ control.js ใช้อยู่แล้ว (เช็ค activeElement ก่อนเขียนทับ)
  function isEditingWithin(root) {
    const active = document.activeElement;
    if (!active) return false;
    const tag = active.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return false;
    return !root || root.contains(active);
  }

  // รีเฟรชทันทีถ้าไม่มีใครกรอกอยู่ ถ้ามี ก็รอจนกว่าจะกรอกเสร็จแล้วค่อยทำ
  //
  // การข้ามไปเฉยๆ ไม่พอ: ถ้าคนกำลังพิมพ์ตอนที่ข้อมูลเปลี่ยนพอดี
  // หน้าจะค้างกับของเก่าไปจนกว่าจะมีคนแก้อะไรอีกครั้ง ซึ่งอาจไม่เกิดขึ้นเลย
  //
  // เช็คด้วยตัวจับเวลา ไม่ใช่รอ event focusout
  //
  // focusout ดูเป็นทางที่ตรงกว่า แต่มันไม่ยิงเลยเมื่อหน้าต่างไม่ได้ถูกโฟกัส
  // (document.hasFocus() เป็น false) ซึ่งเกิดได้จริงตอนคุมงาน:
  // คนคุมสลับไปหน้าต่าง OBS ทั้งที่เคอร์เซอร์ยังค้างอยู่ในช่องกรอก
  // แล้วหน้านั้นจะไม่รีเฟรชอีกเลยทั้งที่ข้อมูลเปลี่ยนไปนานแล้ว
  // ตัวจับเวลาไม่สนใจว่าหน้าต่างถูกโฟกัสหรือเปล่า จึงเชื่อถือได้กว่า
  //
  // ตัวจับเวลาเกิดเฉพาะตอนมีงานค้าง และหยุดตัวเองทันทีที่ทำงานเสร็จ
  const CHECK_MS = 400;
  const pendingRefresh = new WeakSet();

  function deferWhileEditing(root, run) {
    if (!root || !isEditingWithin(root)) {
      run();
      return;
    }
    if (pendingRefresh.has(root)) return;   // นัดไว้แล้ว รอบเดียวพอ
    pendingRefresh.add(root);

    const timer = setInterval(() => {
      if (isEditingWithin(root)) return;
      clearInterval(timer);
      pendingRefresh.delete(root);
      run();
    }, CHECK_MS);
  }

  global.RovClient = {
    controlToken, socket, withToken, absoluteUrl, fetchJson, showToast, goBack, confirmBox,
    onDataChange, isEditingWithin, deferWhileEditing
  };
})(window);
