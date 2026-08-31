// หน้าตั้งค่าคีย์ลัด
//
// ตัวจับคู่และตัวแปลงชื่อปุ่มอยู่ที่ hotkey-utils.js ใช้ร่วมกับ control.js
// หน้านี้ทำแค่บันทึกปุ่มที่กด แล้วส่งขึ้น server

const { controlToken, socket, showToast } = window.RovClient;

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
    label.textContent = action.label;
    main.appendChild(label);
    if (action.note) {
      const note = document.createElement('div');
      note.className = 'krow-note';
      note.textContent = action.note;
      main.appendChild(note);
    }
    if (clashes.length) {
      const warn = document.createElement('div');
      warn.className = 'krow-conflict';
      warn.textContent = `Same key as: ${clashes.join(', ')}`;
      main.appendChild(warn);
    }

    const cap = document.createElement('div');
    cap.className = 'kcap';
    cap.textContent = recordingAction === action.key ? 'Press a key...' : bindingLabel(binding);

    const actions = document.createElement('div');
    actions.className = 'krow-actions';

    const change = document.createElement('button');
    change.type = 'button';
    change.className = 'tlink';
    change.textContent = recordingAction === action.key ? 'CANCEL' : 'CHANGE';
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

function save(action, binding) {
  hotkeys[action] = binding;
  recordingAction = null;
  render();
  socket.emit('updateHotkeys', { [action]: binding });
  showToast(`${ACTIONS.find((a) => a.key === action).label}: ${bindingLabel(binding)}`, 'green');
}

// ระหว่างบันทึก ต้องกิน event ทุกปุ่ม ไม่งั้น Tab จะย้ายโฟกัส
// หรือ Ctrl+W จะปิดหน้าต่างแทนที่จะถูกจับเป็นคีย์ลัด
document.addEventListener('keydown', (event) => {
  if (!recordingAction) return;
  event.preventDefault();
  event.stopPropagation();

  if (event.key === 'Escape') {
    recordingAction = null;
    render();
    showToast(t('Cancelled'), 'blue');
    return;
  }

  // ปุ่ม modifier ต้องรอ keyup ถึงจะรู้ว่าแตะเดี่ยวๆ หรือกดค้างเป็นคีย์ผสม
  if (window.HotkeyUtils.MODIFIER_CODES.includes(event.key)) return;

  save(recordingAction, bindingFromEvent(event));
}, true);

document.addEventListener('keyup', (event) => {
  if (!recordingAction) return;
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

render();
fetch(controlToken ? `/api/state?token=${encodeURIComponent(controlToken)}` : '/api/state')
  .then((r) => r.json())
  .then((state) => { if (state.hotkeys) hotkeys = { ...DEFAULTS, ...state.hotkeys }; render(); })
  .catch(() => showToast(t('Could not load hotkeys'), 'red'));
