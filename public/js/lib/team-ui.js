// ชิ้นส่วนหน้าจอที่เกี่ยวกับ "ทีม" ซึ่งมีมากกว่าหนึ่งหน้าใช้
//
// ทำไมต้องแยกออกมา: แผน §4 เขียนไว้ว่าฟอร์มสร้างทีมกับฟอร์มแก้ทีม
// เคยเขียนแยกกันสองที่แล้วค่อยๆ เพี้ยนออกจากกัน จึงรวมเป็น buildPlayerRows ตัวเดียว
// พอ Phase 6 มีหน้า /teams กับ /teams/:id เพิ่มมาอีกสองหน้า
// ถ้าปล่อยให้ helper ยังอยู่ใน tournament.js ก็ต้องก็อปเป็นชุดที่สามและสี่
// ซึ่งคือความผิดพลาดเดิมซ้ำอีกรอบ ย้ายมาไว้ที่เดียวตั้งแต่ยังมีสองที่จะง่ายกว่า
//
// วิธีใช้:
//   <script src="/socket.io/socket.io.js"></script>
//   <script src="/js/lib/app-client.js"></script>
//   <script src="/js/lib/team-ui.js"></script>
//   <script src="/js/หน้าใหม่.js"></script>
// แล้วในไฟล์ js ขึ้นต้นด้วย
//   const { badge, buildPlayerRows, logoImage, sendLogo } = window.RovTeamUI;
//
// ต้องโหลดหลัง app-client.js เสมอ เพราะ sendLogo อ่านโทเคนจาก window.RovClient

(function (global) {
  // เท่ากับ ROSTER_SIZE ฝั่งเซิร์ฟเวอร์ (server/domain/team.ts)
  // ฝั่งนั้นเป็นคนตัดสินจริง ตรงนี้แค่วาดช่องให้ครบตามนั้น
  const ROSTER_SIZE = 5;

  // ต้องตรงกับ POSITIONS / POSITION_LABELS ใน server/domain/position.ts
  // สคริปต์ฝั่งเบราว์เซอร์เป็นแบบคลาสสิก import จาก server/ ไม่ได้ จึงต้องมีสำเนา
  // มีเทสต์ใน tests/position.test.ts กันไว้ว่าสองที่ต้องไม่หลุดจากกัน
  const POSITIONS = [
    { value: '', label: 'Position' },
    { value: 'jungle', label: 'Jungle' },
    { value: 'carry', label: 'Carry' },
    { value: 'midlane', label: 'Mid lane' },
    { value: 'offlane', label: 'Off lane' },
    { value: 'support', label: 'Support' }
  ];
  const LOGO_MAX_BYTES = 4 * 1024 * 1024;

  function badge(text, cls = '') {
    const el = document.createElement('span');
    el.className = `badge ${cls}`.trim();
    el.textContent = text;
    return el;
  }

  // ห้าช่องผู้เล่นพร้อมปุ่มเลือกกัปตัน
  //
  // คืนฟังก์ชันอ่าน/ล้างค่ากลับไป ผู้เรียกจึงไม่ต้องรู้ว่าข้างในวางโครงยังไง
  // captainGroup ต้องไม่ซ้ำกันในหน้าเดียว ไม่งั้น radio ของคนละทีมจะไปตัดกันเอง
  function buildPlayerRows(container, players, captainGroup) {
    container.textContent = '';

    const rows = Array.from({ length: ROSTER_SIZE }, (_, i) => {
      const player = players?.[i] || {};

      const row = document.createElement('div');
      row.className = 'player-row';

      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.textContent = String(i + 1);

      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'pname';
      name.maxLength = 24;
      name.placeholder = `Player ${i + 1}`;
      name.value = player.name || '';

      // ตำแหน่ง (เลน) เป็นชุดปิดห้าค่า ไม่ใช่ช่องพิมพ์อิสระเหมือนเดิม
      //
      // ค่านี้ถูกเอาไปเลือกไฟล์ไอคอนบนกราฟิกออกอากาศ
      // (public/images/positions/<slug>.png) ข้อความอิสระจึงใช้ไม่ได้:
      // พิมพ์ "Jungle" กับ "jungle" กับเว้นวรรคเกินต้องได้ไอคอนเดียวกัน
      // และคำที่ไม่รู้จักต้องไม่กลายเป็นชื่อไฟล์
      const role = document.createElement('select');
      role.className = 'prole';
      role.title = t('Player position');
      POSITIONS.forEach(({ value, label }) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value === '' ? t('Position') : t(label);
        role.appendChild(opt);
      });
      role.value = POSITIONS.some((p) => p.value === player.position) ? player.position : '';

      const capLabel = document.createElement('label');
      capLabel.className = 'cap';
      const cap = document.createElement('input');
      cap.type = 'radio';
      cap.name = captainGroup;
      cap.checked = player.isCaptain === true;
      capLabel.append(cap, document.createTextNode('Captain'));

      row.append(slot, name, role, capLabel);
      container.appendChild(row);
      return { name, role, cap };
    });

    return {
      read: () => rows.map((r) => ({
        name: r.name.value,
        position: r.role.value,
        isCaptain: r.cap.checked
      })),
      clear: () => rows.forEach((r) => {
        r.name.value = '';
        r.role.value = '';
        r.cap.checked = false;
      }),
      focusFirst: () => rows[0]?.name.focus()
    };
  }

  // โลโก้: v = 0 คือยังไม่มีภาพ ตัวเลขอื่นคือเวลาที่อัปโหลด ใช้กัน cache
  // ไม่มีภาพก็วาดกล่องตัวอักษรย่อแทน จะได้ไม่มีช่องโหว่ในแถว
  function logoImage(team) {
    if (team.logo?.v && team.logo?.ext) {
      const img = document.createElement('img');
      img.className = 'team-logo';
      img.alt = '';
      img.src = `/images/team-logos/${encodeURIComponent(team.id)}.${team.logo.ext}?v=${team.logo.v}`;
      return img;
    }
    const box = document.createElement('div');
    box.className = 'team-logo placeholder';
    box.textContent = (team.tag || team.name || '?').slice(0, 3).toUpperCase();
    return box;
  }

  // ส่งไฟล์ดิบ ไม่ใช้ multipart ให้ตรงกับที่ฝั่งเซิร์ฟเวอร์รับ
  //
  // ใช้ fetchJson ไม่ได้เพราะ body เป็นไฟล์ ไม่ใช่ JSON จึงต้องประกอบ header เอง
  // อ่าน RovClient ตอนถูกเรียก ไม่ใช่ตอนโหลดไฟล์ เผื่อลำดับ script สลับกัน
  // โยน error ออกไป ผู้เรียกเป็นคนตัดสินใจว่าจะบอกผู้ใช้ยังไง
  async function sendLogo(teamId, file) {
    if (file.size > LOGO_MAX_BYTES) throw new Error('Logo must be 4 MB or smaller');

    const { controlToken, withToken } = global.RovClient;
    const response = await fetch(withToken(`/api/teams/${encodeURIComponent(teamId)}/logo`), {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        ...(controlToken ? { Authorization: `Bearer ${controlToken}` } : {})
      },
      body: file
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || response.statusText);
    return data;
  }

  // ตัวเลือกไฟล์ที่ซ่อนไว้ ใช้ปุ่มที่จัดสไตล์แล้วกดแทน input file ดิบๆ
  function hiddenFilePicker(onPick) {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/png,image/jpeg,image/webp';
    picker.hidden = true;
    picker.addEventListener('change', () => {
      onPick(picker.files?.[0] || null);
      picker.value = ''; // เลือกไฟล์เดิมซ้ำต้องยิง change อีกครั้ง
    });
    document.body.appendChild(picker);
    return picker;
  }

  // ผูก event แบบทนต่อ element ที่หายไป
  //
  // เรียก getElementById(...).addEventListener ตรงๆ แล้ว element หาย (เช่นเบราว์เซอร์
  // ยัง cache html เก่าอยู่แต่โหลด js ใหม่มาแล้ว) จะโยน TypeError
  // แล้วบรรทัดที่เหลือทั้งหมดใต้จุดนั้นไม่ถูกรันเลย รวมถึง load()
  // อาการที่ผู้ใช้เจอคือหน้าขึ้นมาแต่กดอะไรไม่ได้สักอย่าง โดยไม่มีอะไรบอกว่าพัง
  function on(id, event, handler) {
    const el = document.getElementById(id);
    if (!el) {
      console.warn(`#${id} is missing, its ${event} handler was skipped`);
      return null;
    }
    el.addEventListener(event, handler);
    return el;
  }

  global.RovTeamUI = {
    ROSTER_SIZE,
    LOGO_MAX_BYTES,
    badge,
    buildPlayerRows,
    logoImage,
    sendLogo,
    hiddenFilePicker,
    on
  };
})(window);
