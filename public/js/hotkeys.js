// หน้าตั้งค่าคีย์ลัด
//
// ตัวจับคู่และตัวแปลงชื่อปุ่มอยู่ที่ hotkey-utils.js ใช้ร่วมกับ control.js
// หน้านี้ทำแค่บันทึกปุ่มที่กด แล้วส่งขึ้น server

const { controlToken, socket, showToast, fetchJson } = window.RovClient;

const { ACTIONS, DEFAULTS, bindingLabel, sameBinding, bindingFromEvent, isModifierBinding } = window.HotkeyUtils;

let hotkeys = { ...DEFAULTS };
let recordingAction = null;

socket.on('connect_error', (error) => showToast(error.message || 'Connection error', 'red'));
socket.on('stateUpdate', (state) => {
  if (state && state.hotkeys) hotkeys = { ...DEFAULTS, ...state.hotkeys };
  render();
});

// ปุ่มเดียวกันถูกผูกไว้สองที่ = ปุ่มหลังชนะเงียบๆ ต้องบอกให้เห็น
function conflictsFor(action) {
  return ACTIONS
    .filter((other) => other.key !== action && sameBinding(hotkeys[other.key], hotkeys[action]))
    .map((other) => other.label);
}

function render() {
  const wrap = document.getElementById('keyRows');
  if (!wrap) return;
  wrap.textContent = '';

  ACTIONS.forEach((action) => {
    const binding = hotkeys[action.key];
    const clashes = conflictsFor(action.key);

    const row = document.createElement('div');
    row.className = 'krow';
    if (recordingAction === action.key) row.classList.add('recording');
    if (clashes.length) row.classList.add('conflict');
    if (!sameBinding(binding, DEFAULTS[action.key])) row.classList.add('changed');

    const main = document.createElement('div');
    main.className = 'krow-main';
    const label = document.createElement('div');
    label.className = 'krow-label';
    label.textContent = t(action.label);
    main.appendChild(label);
    if (action.note) {
      const note = document.createElement('div');
      note.className = 'krow-note';
      note.textContent = t(action.note);
      main.appendChild(note);
    }
    if (clashes.length) {
      const warn = document.createElement('div');
      warn.className = 'krow-conflict';
      warn.textContent = tf('Same key as: {others}', { others: clashes.join(', ') });
      main.appendChild(warn);
    }

    const cap = document.createElement('div');
    cap.className = 'kcap';
    cap.textContent = recordingAction === action.key ? t('Press a key...') : bindingLabel(binding);

    const actions = document.createElement('div');
    actions.className = 'krow-actions';

    const change = document.createElement('button');
    change.type = 'button';
    change.className = 'tlink';
    change.textContent = recordingAction === action.key ? t('CANCEL') : t('CHANGE');
    change.addEventListener('click', () => {
      recordingAction = recordingAction === action.key ? null : action.key;
      render();
    });
    actions.appendChild(change);

    if (!sameBinding(binding, DEFAULTS[action.key])) {
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'tlink';
      reset.textContent = t('DEFAULT');
      reset.addEventListener('click', () => save(action.key, { ...DEFAULTS[action.key] }));
      actions.appendChild(reset);
    }

    row.append(main, cap, actions);
    wrap.appendChild(row);
  });
}

// คีย์ลัดระดับระบบ ----------------------------------------------------------
//
// ตัวจองจริงคือ process หลักของ Electron (ดู electron-main.js) หน้านี้ทำแค่เก็บค่า
//
// เปิดในเบราว์เซอร์ธรรมดาก็ยังเห็นแผงนี้ แต่กดอะไรไม่ได้และบอกไว้ว่าทำไม
// ซ่อนทิ้งไปเลยจะเรียบกว่า แต่แปลว่าคนที่เปิดหน้านี้ในเบราว์เซอร์
// จะไม่มีทางรู้เลยว่าฟีเจอร์นี้มีอยู่ ซึ่งเป็นราคาที่แพงกว่าปุ่มที่กดไม่ได้หนึ่งแถว
const IS_DESKTOP_APP = / Electron\//.test(navigator.userAgent);

let globalHotkeys = null;
// accelerator ที่เซิร์ฟเวอร์แปลงให้แล้ว ไม่ได้แปลงเอง
// ตารางปุ่มอยู่ใน server/domain/settings.ts ที่เดียว ถ้าหน้านี้มีของตัวเองอีกชุด
// วันหนึ่งมันจะโชว์ปุ่มหนึ่งแต่ Electron ไปจองอีกปุ่มหนึ่ง
let globalAccelerators = {};
// ปุ่มที่แอพเดสก์ท็อปจองติดจริงบนเครื่องนี้ null = ยังไม่มีใครรายงานมา
let globalHeld = null;
let recordingGlobal = null;

async function loadGlobalAccelerators() {
  try {
    const data = await fetchJson('/api/global-hotkeys');
    globalAccelerators = data.accelerators || {};
    globalHeld = Array.isArray(data.held) ? data.held : null;
  } catch (error) {
    globalAccelerators = {};
    globalHeld = null;
  }
  renderGlobal();
}

function renderGlobal() {
  const panel = document.getElementById('globalPanel');
  if (!panel || !globalHotkeys) return;
  panel.hidden = false;
  panel.classList.toggle('unavailable', !IS_DESKTOP_APP);

  const toggle = /** @type {HTMLInputElement} */ (document.getElementById('globalEnabled'));
  if (toggle) {
    if (document.activeElement !== toggle) toggle.checked = globalHotkeys.enabled;
    toggle.disabled = !IS_DESKTOP_APP;
  }

  const wrap = document.getElementById('globalRows');
  if (!wrap) return;
  wrap.className = globalHotkeys.enabled ? '' : 'off';
  wrap.textContent = '';

  ACTIONS.forEach((action) => {
    const binding = globalHotkeys.bindings[action.key];
    const accelerator = globalAccelerators[action.key];

    const row = document.createElement('div');
    row.className = 'krow';
    if (recordingGlobal === action.key) row.classList.add('recording');
    if (!accelerator || (globalHeld !== null && !globalHeld.includes(accelerator))) {
      row.classList.add('conflict');
    }

    const main = document.createElement('div');
    main.className = 'krow-main';

    const label = document.createElement('div');
    label.className = 'krow-label';
    label.textContent = t(action.label);
    main.appendChild(label);

    // สามสถานะ ไม่ใช่สอง: จองติด / โปรแกรมอื่นในเครื่องยึดไว้ก่อน / ปุ่มนี้จองไม่ได้เลย
    // สองอันหลังต่างกันตรงทางแก้: อันหนึ่งเลือกปุ่มอื่น อีกอันต้องไปจัดการโปรแกรมที่ยึดอยู่
    const taken = Boolean(accelerator) && globalHeld !== null && !globalHeld.includes(accelerator);
    const accel = document.createElement('div');
    accel.className = accelerator && !taken ? 'krow-accel' : 'krow-accel taken';
    if (!accelerator) accel.textContent = t('This key cannot be registered system-wide');
    else if (taken) accel.textContent = `${accelerator} - ${t('another program is holding this key')}`;
    else accel.textContent = `${t('Registered as')} ${accelerator}`;
    main.appendChild(accel);

    const cap = document.createElement('div');
    cap.className = 'kcap';
    cap.textContent = recordingGlobal === action.key
      ? t('Press a key...')
      : bindingLabel(binding);

    const actions = document.createElement('div');
    actions.className = 'krow-actions';

    const change = document.createElement('button');
    change.type = 'button';
    change.className = 'tlink';
    change.textContent = recordingGlobal === action.key ? t('CANCEL') : t('CHANGE');
    change.disabled = !IS_DESKTOP_APP;
    change.addEventListener('click', () => {
      recordingGlobal = recordingGlobal === action.key ? null : action.key;
      recordingAction = null;
      render();
      renderGlobal();
    });
    actions.appendChild(change);

    row.append(main, cap, actions);
    wrap.appendChild(row);
  });
}

// เก็บแล้วรอ state กลับมา ไม่ได้เขียนค่าลงตัวแปรเองก่อน
// เซิร์ฟเวอร์เป็นคนตัดสินว่าปุ่มนี้ใช้ได้ไหม (ดู sanitizeGlobalHotkeys)
// ถ้าหน้านี้แสดงค่าที่ส่งไปทันที มันจะโชว์ปุ่มที่ถูกปฏิเสธไปแล้วเหมือนตั้งสำเร็จ
function saveGlobal(action, binding) {
  recordingGlobal = null;
  socket.emit('updateGlobalHotkeys', { bindings: { [action]: binding } });
  showToast(tf('{action}: {key}', {
    action: t(ACTIONS.find((a) => a.key === action).label),
    key: bindingLabel(binding)
  }), 'green');
}

function save(action, binding) {
  hotkeys[action] = binding;
  recordingAction = null;
  render();
  socket.emit('updateHotkeys', { [action]: binding });
  showToast(tf('{action}: {key}', {
    action: t(ACTIONS.find((a) => a.key === action).label),
    key: bindingLabel(binding)
  }), 'green');
}

// ระหว่างบันทึก ต้องกิน event ทุกปุ่ม ไม่งั้น Tab จะย้ายโฟกัส
// หรือ Ctrl+W จะปิดหน้าต่างแทนที่จะถูกจับเป็นคีย์ลัด
document.addEventListener('keydown', (event) => {
  if (!recordingAction && !recordingGlobal) return;
  event.preventDefault();
  event.stopPropagation();

  if (event.key === 'Escape') {
    recordingAction = null;
    recordingGlobal = null;
    render();
    renderGlobal();
    showToast(t('Cancelled'), 'blue');
    return;
  }

  // ปุ่ม modifier ต้องรอ keyup ถึงจะรู้ว่าแตะเดี่ยวๆ หรือกดค้างเป็นคีย์ผสม
  if (window.HotkeyUtils.MODIFIER_CODES.includes(event.key)) return;

  if (recordingGlobal) {
    const binding = bindingFromEvent(event);
    // ห้ามปุ่มเปล่า เพราะการจองแบบนั้นคือการยึดปุ่มไปจากทั้งเครื่อง
    // เซิร์ฟเวอร์ก็ปฏิเสธอยู่แล้ว แต่ถ้าไม่บอกตรงนี้ คนกดจะเห็นแค่ค่าเด้งกลับเป็นของเดิม
    if (!binding.ctrl && !binding.alt && !binding.shift && !binding.meta) {
      showToast(t('A system-wide hotkey needs Ctrl, Alt, Shift or Win'), 'red');
      return;
    }
    saveGlobal(recordingGlobal, binding);
    return;
  }

  save(recordingAction, bindingFromEvent(event));
}, true);

document.addEventListener('keyup', (event) => {
  if (!recordingAction) return;   // คีย์ลัดระดับระบบไม่รับ modifier เดี่ยวๆ
  if (!window.HotkeyUtils.MODIFIER_CODES.includes(event.key)) return;
  // ปล่อยโดยไม่มีปุ่มอื่นกดค้างอยู่ = ตั้งใจใช้ modifier ตัวนี้เป็นคีย์ลัด
  if (event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
  event.preventDefault();
  save(recordingAction, bindingFromEvent(event));
}, true);

document.getElementById('resetAll')?.addEventListener('click', () => {
  recordingAction = null;
  hotkeys = { ...DEFAULTS };
  render();
  socket.emit('resetHotkeys');
  showToast(t('All hotkeys reset'), 'blue');
});

document.getElementById('globalEnabled')?.addEventListener('change', (event) => {
  const on = /** @type {HTMLInputElement} */ (event.target).checked;
  socket.emit('updateGlobalHotkeys', { enabled: on });
  showToast(on ? t('System-wide hotkeys on') : t('System-wide hotkeys off'), on ? 'green' : 'blue');
});

render();
renderGlobal();
fetch(controlToken ? `/api/state?token=${encodeURIComponent(controlToken)}` : '/api/state')
  .then((r) => r.json())
  .then((state) => {
    if (state.hotkeys) hotkeys = { ...DEFAULTS, ...state.hotkeys };
    if (state.globalHotkeys) globalHotkeys = state.globalHotkeys;
    render();
    renderGlobal();
  })
  .catch(() => showToast(t('Could not load hotkeys'), 'red'));

loadGlobalAccelerators();

// ในแอพเดสก์ท็อปต้องถามซ้ำเรื่อยๆ เพราะ "จองติดหรือไม่" เป็นคำตอบที่มาทีหลัง
// ตัวจองอยู่คนละ process และเห็นค่าที่เพิ่งเซฟช้ากว่าหน้านี้ราวสองวินาที
// ถามครั้งเดียวตอนเซฟจึงได้คำตอบของค่าเก่าเสมอ
if (IS_DESKTOP_APP) setInterval(loadGlobalAccelerators, 3000);
