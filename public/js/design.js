// หน้าตั้งค่าภาพพื้นหลังที่ออกแบบเอง
//
// แยกจาก Control Panel เพราะเป็นงานที่ทำก่อนแข่ง ไม่ใช่ตอนคุมไฟท์
// ไฟล์นี้ยืนอยู่ได้ด้วยตัวเอง ไม่ต้องพึ่ง control.js

const { controlToken, socket, withToken, showToast } = window.RovClient;

// ขนาดจริงของแต่ละพื้นที่ วัดจาก layout ที่ใช้อยู่จริง
// ภาพถูกยืดเต็มพื้นที่ (background-size: 100% 100%) ไม่ได้ครอบตัด
// ถ้าอัตราส่วนไม่ตรง ภาพจะบิด จึงต้องบอกขนาดเป็น px ตรงๆ
//
// แยก 1080p กับ 1440p คนละไฟล์ ขนาดที่วาดจริงไม่เท่ากัน
// หน้า result ถึงจะ layout เหมือนกัน แต่ตอน 1440p ถูกขยาย 4/3
// ภาพ 1080p ที่เอาไปใช้กับ 1440p จึงถูกขยายตามแล้วเบลอ
//
// ถ้าแก้ layout ใน overlay.css / overlay-1440.css / result.css
// อย่าลืมแก้ตัวเลขตรงนี้ และใน public/images/skins/README.md ด้วย
const SKIN_SLOTS = [
  { key: 'overlayBottom1080', size: '1080', group: 'Overlay', part: 'Banner', w: 1920, h: 430, note: 'แถบเดียวรวม ban + pick + score' },
  { key: 'resultTop1080', size: '1080', group: 'Result', part: 'Top', w: 1920, h: 540, note: 'ครึ่งบน: ทีมน้ำเงิน' },
  { key: 'resultBottom1080', size: '1080', group: 'Result', part: 'Bottom', w: 1920, h: 540, note: 'ครึ่งล่าง: ทีมแดง' },

  { key: 'overlayBottom1440', size: '1440', group: 'Overlay', part: 'Banner', w: 2560, h: 573, note: 'แถบเดียวรวม ban + pick + score' },
  { key: 'resultTop1440', size: '1440', group: 'Result', part: 'Top', w: 2560, h: 720, note: 'ครึ่งบน: ทีมน้ำเงิน' },
  { key: 'resultBottom1440', size: '1440', group: 'Result', part: 'Bottom', w: 2560, h: 720, note: 'ครึ่งล่าง: ทีมแดง' }
];
const SKIN_FILES = {
  overlayTop1080: 'overlay-top-1080',
  overlayTop1440: 'overlay-top-1440',
  overlayBottom1080: 'overlay-bottom-1080',
  overlayBottom1440: 'overlay-bottom-1440',
  resultTop1080: 'result-top-1080',
  resultTop1440: 'result-top-1440',
  resultBottom1080: 'result-bottom-1080',
  resultBottom1440: 'result-bottom-1440'
};
const EXTS = ['png', 'jpg', 'webp'];

socket.on('connect', () => showToast(t('Connected'), 'green'));
socket.on('disconnect', () => showToast(t('Disconnected'), 'red'));
socket.on('controlError', (error) => showToast(error.message || 'Control blocked', 'red'));
socket.on('stateUpdate', (state) => {
  renderSkin(state && state.skin);
  renderTheme(state && state.theme);
  renderPreviewSize(state && state.overlaySize);
});

function buildDesignGrid() {
  const grid = document.getElementById('designGrid');
  if (!grid) return;
  grid.textContent = '';

  let lastSize = null;
  SKIN_SLOTS.forEach(({ key, size, group, part, note, w, h }) => {
    if (size !== lastSize) {
      lastSize = size;
      const banner = document.createElement('div');
      banner.className = 'dsize-banner';
      banner.innerHTML = `<span class="dsize-chip">${size}p</span>` +
        `<span>สำหรับ Browser Source ขนาด <b>${size === '1080' ? '1920 x 1080' : '2560 x 1440'}</b></span>`;
      grid.appendChild(banner);
    }

    const card = document.createElement('div');
    card.className = 'dslot';

    const title = document.createElement('div');
    title.className = 'dslot-title';
    title.innerHTML = `${group} <b>${part}</b>`;
    card.dataset.size = size;

    const noteEl = document.createElement('div');
    noteEl.className = 'dslot-note';
    noteEl.textContent = note;

    // ขนาดที่ต้องทำ บอกเป็น px ตรงๆ พร้อมอัตราส่วนและชื่อไฟล์
    const sizeBox = document.createElement('div');
    sizeBox.className = 'dslot-size';
    sizeBox.innerHTML =
      `<div class="dsize-row">` +
      `<span class="dsize-px"><b>W ${w}</b> &times; <b>H ${h}</b> px</span>` +
      `<span class="dsize-ratio">${(w / h).toFixed(2)} : 1</span>` +
      `</div>` +
      `<div class="dsize-file">${SKIN_FILES[key]}.png</div>`;

    const preview = document.createElement('div');
    preview.className = 'dslot-preview';
    preview.id = `skinPreview_${key}`;
    preview.textContent = 'ยังไม่มีภาพ';

    // input file ซ่อนไว้ ให้ปุ่มปกติเป็นตัวกด หน้าตาจะได้เข้าชุดกัน
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/png,image/jpeg,image/webp';
    file.style.display = 'none';
    file.addEventListener('change', () => {
      if (file.files[0]) uploadSkin(key, file.files[0]);
      file.value = '';
    });

    const upload = document.createElement('button');
    upload.className = 'tlink';
    upload.type = 'button';
    upload.textContent = t('UPLOAD');
    upload.addEventListener('click', () => file.click());

    const clear = document.createElement('button');
    clear.className = 'tlink danger';
    clear.type = 'button';
    clear.textContent = t('CLEAR');
    clear.addEventListener('click', () => clearSkin(key));

    const actions = document.createElement('div');
    actions.className = 'dslot-actions';
    actions.append(upload, clear);

    card.append(title, noteEl, sizeBox, preview, actions, file);
    grid.appendChild(card);
  });
}

async function uploadSkin(slot, file) {
  if (file.size > 8 * 1024 * 1024) {
    showToast(t('File must be under 8 MB'), 'red');
    return;
  }
  try {
    const response = await fetch(withToken(`/api/skin/${slot}`), {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        ...(controlToken ? { Authorization: `Bearer ${controlToken}` } : {})
      },
      body: file
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || response.statusText);
    showToast('อัปโหลดแล้ว', 'green');
  } catch (error) {
    showToast(error.message || 'Upload failed', 'red');
  }
}

async function clearSkin(slot) {
  try {
    const response = await fetch(withToken(`/api/skin/${slot}`), {
      method: 'DELETE',
      headers: controlToken ? { Authorization: `Bearer ${controlToken}` } : {}
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || response.statusText);
    showToast('ลบภาพแล้ว', 'red');
  } catch (error) {
    showToast(error.message || 'Clear failed', 'red');
  }
}

function updateSkinOptions() {
  socket.emit('updateSkinOptions', {
    enabled: /** @type {HTMLInputElement} */ (document.getElementById('skinEnabled'))?.checked,
    showPanels: /** @type {HTMLInputElement} */ (document.getElementById('skinShowPanels'))?.checked
  });
}

function renderSkin(skin) {
  if (!skin) return;

  const enabled = /** @type {HTMLInputElement} */ (document.getElementById('skinEnabled'));
  const panels = /** @type {HTMLInputElement} */ (document.getElementById('skinShowPanels'));
  if (enabled && document.activeElement !== enabled) enabled.checked = skin.enabled === true;
  if (panels && document.activeElement !== panels) panels.checked = skin.showPanels !== false;

  SKIN_SLOTS.forEach(({ key, w, h }) => {
    const preview = document.getElementById(`skinPreview_${key}`);
    if (!preview) return;
    const version = skin.slots?.[key] || 0;

    if (!version) {
      preview.style.backgroundImage = '';
      preview.classList.remove('filled');
      preview.dataset.version = '';
      preview.textContent = 'ยังไม่มีภาพ';
      return;
    }
    if (preview.dataset.version === String(version)) return;
    preview.dataset.version = String(version);
    preview.textContent = '';
    preview.classList.add('filled');

    // นามสกุลไม่ได้เก็บไว้ใน state จึงลองทีละแบบจนกว่าจะโหลดได้
    EXTS.reduce((chain, ext) => chain.then((found) => {
      if (found) return found;
      const url = `images/skins/${SKIN_FILES[key]}.${ext}?v=${version}`;
      return new Promise((res) => {
        const img = new Image();
        img.onload = () => res(url);
        img.onerror = () => res(null);
        img.src = url;
      });
    }), Promise.resolve(null)).then((url) => {
      if (url) preview.style.backgroundImage = `url("${url}")`;
    });
  });
}

// THEME EDITOR --------------------------------------------------------
//
// ทุกแถวผูกกับ CSS custom property ตัวหนึ่งใน overlay.css
// ค่า default ต้องตรงกับ THEME_DEFAULTS ใน server.js และ :root ใน overlay.css
// ทั้งสามที่ ไม่งั้นปุ่ม Reset จะพาไปคนละหน้าตากับของเดิม
const THEME_DEFAULTS = {
  blue: '#38bdf8', red: '#f87171', accent: '#f59e0b',
  text: '#ffffff', label: '#c0c0c0',
  typeCaption: 14, typePlayer: 18, typeTournament: 18,
  typeTitle: 24, typeScore: 42, typeTimer: 40,
  logoSize: 138, logoInset: 10
};

// จัดกลุ่มตามตำแหน่งบนแถบ ไม่ใช่ตามชนิดของค่า
// อยากแก้สกอร์ก็ไปดูที่ "Centre column" ไม่ต้องรู้ว่ามันเป็นสีหรือขนาด
const THEME_FIELDS = {
  themeTeamColours: [
    { key: 'blue', label: 'Blue team', type: 'color' },
    { key: 'red', label: 'Red team', type: 'color' }
  ],
  themeCentre: [
    { key: 'typeTournament', label: 'Tournament name', min: 10, max: 48 },
    { key: 'typeScore', label: 'Score', min: 12, max: 96 },
    { key: 'typeTimer', label: 'Timer', min: 12, max: 96 },
    { key: 'typeTitle', label: 'Match title', min: 10, max: 60 },
    { key: 'text', label: 'Text colour', type: 'color' },
    { key: 'accent', label: 'Accent / urgent', type: 'color' }
  ],
  themeCards: [
    { key: 'typePlayer', label: 'Player name', min: 10, max: 48 }
  ],
  themeLabels: [
    { key: 'typeCaption', label: 'Label size (BAN, phase, VS)', min: 8, max: 40 },
    { key: 'label', label: 'Label colour', type: 'color' }
  ],
  themeLogo: [
    { key: 'logoSize', label: 'Logo size', min: 40, max: 260 },
    { key: 'logoInset', label: 'Distance from centre', min: -40, max: 200 }
  ]
};

let theme = { ...THEME_DEFAULTS };
const themeRows = {};

function buildThemeEditor() {
  Object.entries(THEME_FIELDS).forEach(([wrapId, fields]) => {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    wrap.textContent = '';
    fields.forEach((field) => wrap.appendChild(themeRow(field)));
  });
}

function themeRow(field) {
  const row = document.createElement('div');
  row.className = 'trow';

  const head = document.createElement('div');
  head.className = 'trow-head';
  const label = document.createElement('span');
  label.className = 'trow-label';
  label.textContent = field.label;
  const value = document.createElement('span');
  value.className = 'trow-value';
  head.append(label, value);

  const inputs = document.createElement('div');
  inputs.className = 'trow-inputs';

  if (field.type === 'color') {
    const swatch = document.createElement('input');
    swatch.type = 'color';
    const hex = document.createElement('input');
    hex.type = 'text';
    hex.maxLength = 7;
    hex.spellcheck = false;

    // ลากทีละพิกเซลไม่ต้องยิงทุก frame แต่ต้องเห็นผลทันที
    swatch.addEventListener('input', () => {
      hex.value = swatch.value;
      hex.classList.remove('invalid');
      pushTheme(field.key, swatch.value);
    });
    // พิมพ์เองได้ แต่ส่งเฉพาะตอนที่เป็น #rrggbb จริงๆ
    hex.addEventListener('input', () => {
      const v = hex.value.trim();
      const ok = /^#[0-9a-f]{6}$/i.test(v);
      hex.classList.toggle('invalid', Boolean(v) && !ok);
      if (ok) { swatch.value = v.toLowerCase(); pushTheme(field.key, v.toLowerCase()); }
    });

    inputs.append(swatch, hex);
    themeRows[field.key] = { row, value, set: (v) => { swatch.value = v; hex.value = v; hex.classList.remove('invalid'); } };
  } else {
    const range = document.createElement('input');
    range.type = 'range';
    range.min = field.min;
    range.max = field.max;
    range.step = '1';
    range.addEventListener('input', () => pushTheme(field.key, Number(range.value)));
    inputs.appendChild(range);
    themeRows[field.key] = { row, value, set: (v) => { range.value = v; } };
  }

  row.append(head, inputs);
  return row;
}

function pushTheme(key, value) {
  theme[key] = value;
  renderThemeValues();
  socket.emit('updateTheme', { [key]: value });
}

function renderThemeValues() {
  Object.entries(themeRows).forEach(([key, row]) => {
    const current = theme[key];
    const isColor = typeof current === 'string';
    row.value.textContent = isColor ? current : `${current}px`;
    row.row.classList.toggle('changed', current !== THEME_DEFAULTS[key]);
  });
}

function renderTheme(next) {
  if (!next || typeof next !== 'object') return;
  theme = { ...THEME_DEFAULTS, ...next };
  Object.entries(themeRows).forEach(([key, row]) => {
    // ไม่เขียนทับตัวที่กำลังลาก/พิมพ์อยู่ ไม่งั้นค่ากระตุกกลับ
    if (row.row.contains(document.activeElement)) return;
    row.set(theme[key]);
  });
  renderThemeValues();
}

document.getElementById('themeReset')?.addEventListener('click', () => {
  socket.emit('resetTheme');
  showToast(t('Theme reset to original'), 'blue');
});

// LIVE PREVIEW --------------------------------------------------------
// iframe ของ /overlay จริงๆ ย่อลงมา ไม่ได้วาดจำลอง
// มัน socket ของมันเอง ธีมเปลี่ยนเมื่อไหร่ก็เห็นทันทีโดยหน้านี้ไม่ต้องทำอะไร
const PREVIEW_DISPLAY_WIDTH = 480;
let previewSize = null;

function renderPreviewSize(overlaySize) {
  const size = overlaySize === '1440' ? '1440' : '1080';
  if (size === previewSize) return; // อย่าโหลด iframe ใหม่ทุก state update
  previewSize = size;

  const frame = document.getElementById('tpFrame');
  const iframe = document.getElementById('themePreview');
  if (!frame || !iframe) return;

  const w = size === '1440' ? 2560 : 1920;
  const h = size === '1440' ? 1440 : 1080;
  frame.style.setProperty('--tp-w', `${w}px`);
  frame.style.setProperty('--tp-h', `${h}px`);
  frame.style.setProperty('--tp-scale', String(PREVIEW_DISPLAY_WIDTH / w));

  const caption = document.getElementById('tpCaption');
  if (caption) caption.textContent = `Live preview - ${w} x ${h}`;

  loadPreview(size);
}

function loadPreview(size) {
  const iframe = /** @type {HTMLIFrameElement} */ (document.getElementById('themePreview'));
  if (!iframe) return;
  iframe.src = withToken(size === '1440' ? '/overlay-1440' : '/overlay');
}

document.getElementById('tpReload')?.addEventListener('click', () => {
  loadPreview(previewSize || '1080');
  showToast(t('Preview reloaded'), 'blue');
});

document.querySelectorAll('.tp-bd').forEach((/** @type {HTMLElement} */ btn) => {
  btn.addEventListener('click', () => {
    const frame = document.getElementById('tpFrame');
    frame.classList.remove('checker', 'dark', 'light');
    frame.classList.add(btn.dataset.bd);
    document.querySelectorAll('.tp-bd').forEach((b) => b.classList.toggle('active', b === btn));
    localStorage.setItem('rovPreviewBackdrop', btn.dataset.bd);
  });
});

// จำพื้นหลังที่เลือกไว้ คนคุมมักดูบนพื้นเดิมทุกครั้ง
(() => {
  const saved = localStorage.getItem('rovPreviewBackdrop') || 'checker';
  /** @type {HTMLElement} */ (document.querySelector(`.tp-bd[data-bd="${saved}"]`))?.click();
})();

buildThemeEditor();
buildDesignGrid();
fetch(withToken('/api/state'))
  .then((r) => r.json())
  .then((state) => { renderSkin(state.skin); renderTheme(state.theme); renderPreviewSize(state.overlaySize); })
  .catch(() => showToast('โหลดสถานะไม่สำเร็จ', 'red'));
