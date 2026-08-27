// ของที่ทุกหน้าฝั่งควบคุมต้องใช้เหมือนกันหมด: โทเคน, socket, fetch, toast
//
// เดิมโค้ดก้อนนี้ถูกคัดลอกไว้ใน home.js / control.js / presets.js /
// design.js / hotkeys.js ไฟล์ละชุด แก้ทีต้องไล่แก้ห้าที่
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
  const controlToken = params.get('token') || localStorage.getItem('rovControlToken') || '';
  if (controlToken) localStorage.setItem('rovControlToken', controlToken);

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
    const response = await fetch(withToken(url), { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || response.statusText);
    return data;
  }

  function showToast(msg, type = 'green') {
    const el = document.getElementById('toast_el');
    if (!el) return;
    const colors = { green: 'var(--green)', blue: 'var(--blue)', red: 'var(--red)' };
    el.style.borderLeftColor = colors[type] || colors.green;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

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
    controlToken, socket, withToken, absoluteUrl, fetchJson, showToast,
    onDataChange, isEditingWithin, deferWhileEditing
  };
})(window);
