// หน้าจัดการพรีเซ็ต แยกออกมาจาก Control Panel
//
// เดิมพรีเซ็ตอยู่บนแถบบนของ control ซึ่งใส่ได้แค่ช่องชื่อกับ dropdown
// พอย้ายมาหน้านี้จึงเห็นได้ว่าแต่ละพรีเซ็ตเก็บอะไรไว้บ้างก่อนจะกดโหลด
//
// ไฟล์นี้ยืนได้ด้วยตัวเอง ไม่พึ่ง control.js เหมือนหน้า design

const { socket, fetchJson, showToast } = window.RovClient;

let details = [];
let filter = '';

// ชื่อพรีเซ็ตที่กำลังแก้อยู่ ว่าง = กำลังสร้างใหม่
let editingName = '';
// state เต็มของพรีเซ็ตที่กำลังแก้ เก็บไว้เพื่อรักษา pick/ban/score
// ที่ฟอร์มไม่มีช่องให้กรอก ถ้าไม่เก็บ กดแก้ชื่อผู้เล่นทีเดียวดราฟต์หายหมด
let editingState = null;

const PLAYER_COUNT = 5;

socket.on('connect_error', (error) => showToast(error.message || 'Connection error', 'red'));

// FORM ---------------------------------------------------------------

function buildPlayerInputs() {
  [['bluePlayers', 'fBluePlayer'], ['redPlayers', 'fRedPlayer']].forEach(([wrapId, idPrefix]) => {
    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    wrap.textContent = '';
    for (let i = 0; i < PLAYER_COUNT; i += 1) {
      const row = document.createElement('div');
      row.className = 'prow';
      const num = document.createElement('span');
      num.className = 'pnum';
      num.textContent = String(i + 1);
      const input = document.createElement('input');
      input.id = `${idPrefix}${i}`;
      input.maxLength = 24;
      input.autocomplete = 'off';
      input.placeholder = `Player ${i + 1}`;
      row.append(num, input);
      wrap.appendChild(row);
    }
  });
}

function val(id) {
  return /** @type {HTMLInputElement} */ (document.getElementById(id))?.value.trim() || '';
}

function setVal(id, value) {
  const el = /** @type {HTMLInputElement} */ (document.getElementById(id));
  if (el) el.value = value || '';
}

function readForm() {
  const players = (prefix) => Array.from(
    { length: PLAYER_COUNT },
    (_, i) => val(`${prefix}${i}`)
  );
  return {
    name: val('presetName'),
    tournament: val('fTournament'),
    title: val('fTitle'),
    blue: { name: val('fBlueName'), players: players('fBluePlayer') },
    red: { name: val('fRedName'), players: players('fRedPlayer') }
  };
}

// ประกอบเป็น state ให้ server sanitize ต่อ
// ถ้ากำลังแก้ของเดิม เอา state เดิมเป็นฐานไว้ก่อน pick/ban/score จะได้ไม่หาย
function buildStateFromForm(form) {
  const base = editingState ? JSON.parse(JSON.stringify(editingState)) : {};
  return {
    ...base,
    matchInfo: { tournament: form.tournament, title: form.title },
    teamBlue: { ...(base.teamBlue || {}), name: form.blue.name, players: form.blue.players },
    teamRed: { ...(base.teamRed || {}), name: form.red.name, players: form.red.players }
  };
}

function renderEditorMode() {
  const panel = document.querySelector('.save-panel');
  const title = document.getElementById('editorTitle');
  const note = document.getElementById('editorNote');
  const saveBtn = document.getElementById('saveBtn');
  const resetBtn = document.getElementById('resetBtn');

  panel?.classList.toggle('editing', Boolean(editingName));
  if (editingName) {
    title.textContent = `Editing "${editingName}"`;
    note.textContent = 'Picks, bans and score saved in this preset are kept.';
    saveBtn.textContent = 'SAVE CHANGES';
    resetBtn.textContent = 'CANCEL';
  } else {
    title.textContent = 'New preset';
    note.textContent = 'Type the line-up. Nothing is read from the live match.';
    saveBtn.textContent = 'SAVE PRESET';
    resetBtn.textContent = 'CLEAR FORM';
  }
  document.getElementById('saveHint').textContent = editingName
    ? ''
    : 'Reusing an existing name will ask before overwriting.';
}

function resetForm() {
  editingName = '';
  editingState = null;
  ['presetName', 'fTournament', 'fTitle', 'fBlueName', 'fRedName'].forEach((id) => setVal(id, ''));
  for (let i = 0; i < PLAYER_COUNT; i += 1) {
    setVal(`fBluePlayer${i}`, '');
    setVal(`fRedPlayer${i}`, '');
  }
  renderEditorMode();
  document.getElementById('presetName')?.focus();
}

async function editPreset(name) {
  try {
    const data = await fetchJson(`/api/presets/${encodeURIComponent(name)}`);
    const state = data.state || {};
    editingName = name;
    editingState = state;

    setVal('presetName', name);
    setVal('fTournament', state.matchInfo?.tournament);
    setVal('fTitle', state.matchInfo?.title);
    setVal('fBlueName', state.teamBlue?.name);
    setVal('fRedName', state.teamRed?.name);
    for (let i = 0; i < PLAYER_COUNT; i += 1) {
      setVal(`fBluePlayer${i}`, state.teamBlue?.players?.[i]);
      setVal(`fRedPlayer${i}`, state.teamRed?.players?.[i]);
    }

    renderEditorMode();
    document.querySelector('.save-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('presetName')?.focus();
  } catch (error) {
    showToast(error.message || 'Could not open preset', 'red');
  }
}

function matchesFilter(item) {
  if (!filter) return true;
  const haystack = [item.name, item.tournament, item.title, item.blue.name, item.red.name]
    .join(' ')
    .toLowerCase();
  return haystack.includes(filter);
}

function renderList() {
  const grid = document.getElementById('presetGrid');
  const count = document.getElementById('presetCount');
  if (!grid) return;

  const shown = details.filter(matchesFilter);
  count.textContent = details.length
    ? `${shown.length} of ${details.length} shown`
    : '';

  grid.textContent = '';

  if (!details.length) {
    grid.appendChild(emptyState(
      'No presets yet',
      'Set a match up in the Control Panel, then save it here to reuse later.'
    ));
    return;
  }
  if (!shown.length) {
    grid.appendChild(emptyState('No matches', `Nothing matches "${filter}".`));
    return;
  }

  shown.forEach((item) => grid.appendChild(presetCard(item)));
}

function emptyState(title, sub) {
  const box = document.createElement('div');
  box.className = 'empty-state';
  box.style.gridColumn = '1/-1';
  const t = document.createElement('div');
  t.className = 'es-title';
  t.textContent = title;
  const s = document.createElement('div');
  s.className = 'es-sub';
  s.textContent = sub;
  box.append(t, s);
  return box;
}

// ทุกอย่างประกอบด้วย textContent ไม่ใช่ innerHTML
// ชื่อพรีเซ็ต ชื่อทีม ชื่อรายการ มาจากผู้ใช้ทั้งหมด
function presetCard(item) {
  const card = document.createElement('div');
  card.className = 'pcard';

  const top = document.createElement('div');
  top.className = 'pcard-top';

  const name = document.createElement('div');
  name.className = 'pcard-name';
  name.textContent = item.name;

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'pcard-del';
  del.textContent = '×';
  del.title = `Remove preset "${item.name}"`;
  del.setAttribute('aria-label', `Remove preset ${item.name}`);
  del.addEventListener('click', () => deletePreset(item.name));

  top.append(name, del);

  const meta = document.createElement('div');
  meta.className = 'pcard-meta';
  const tournament = document.createElement('div');
  tournament.textContent = item.tournament || 'No tournament name';
  const title = document.createElement('div');
  title.textContent = item.title || 'No match title';
  meta.append(tournament, title);

  const teams = document.createElement('div');
  teams.className = 'pcard-teams';
  const blue = document.createElement('div');
  blue.className = 'pteam blue';
  blue.textContent = item.blue.name || 'BLUE';
  const score = document.createElement('div');
  score.className = 'pscore';
  score.textContent = `${item.blue.score} - ${item.red.score}`;
  const red = document.createElement('div');
  red.className = 'pteam red';
  red.textContent = item.red.name || 'RED';
  teams.append(blue, score, red);

  // รายชื่อผู้เล่นคือหัวใจของพรีเซ็ตแบบกรอกเอง เลยต้องเห็นบนการ์ด
  const roster = document.createElement('div');
  roster.className = 'pcard-roster';
  [['blue', item.blue], ['red', item.red]].forEach(([side, team]) => {
    const line = document.createElement('div');
    line.className = `proster ${side}`;
    const tag = document.createElement('span');
    tag.className = 'proster-tag';
    tag.textContent = team.name || (side === 'blue' ? 'BLUE' : 'RED');
    const names = document.createElement('span');
    names.className = 'proster-names';
    const filled = (team.players || []).filter((p) => p && !/^Player \d$/.test(p));
    names.textContent = filled.length ? filled.join(', ') : 'No players set';
    line.append(tag, names);
    roster.appendChild(line);
  });

  const draft = document.createElement('div');
  draft.className = 'pcard-draft';
  const picks = item.blue.picks + item.red.picks;
  const bans = item.blue.bans + item.red.bans;
  draft.textContent = picks || bans
    ? `Also holds ${picks} pick${picks === 1 ? '' : 's'} and ${bans} ban${bans === 1 ? '' : 's'}`
    : 'No picks or bans saved';

  const actions = document.createElement('div');
  actions.className = 'pcard-actions';
  const load = document.createElement('button');
  load.type = 'button';
  load.className = 'bbtn load';
  load.textContent = 'LOAD';
  load.addEventListener('click', () => loadPreset(item.name));
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'bbtn edit';
  edit.textContent = 'EDIT';
  edit.title = 'Open this preset in the form above';
  edit.addEventListener('click', () => editPreset(item.name));
  actions.append(load, edit);

  card.append(top, meta, teams, roster, draft, actions);
  return card;
}

async function refresh() {
  try {
    details = (await fetchJson('/api/presets')).details || [];
    renderList();
  } catch (error) {
    showToast(error.message || 'Could not load presets', 'red');
  }
}

async function savePreset() {
  const form = readForm();
  if (!form.name) {
    showToast('Preset name required', 'red');
    document.getElementById('presetName')?.focus();
    return;
  }

  // ชื่อซ้ำ = เขียนทับของเดิม ถามก่อน จะได้ไม่ทับโดยไม่ตั้งใจ
  // ตอนแก้อยู่แล้วใช้ชื่อเดิม ไม่ต้องถาม เพราะตั้งใจจะทับอยู่แล้ว
  const clashes = details.some((item) => item.name === form.name) && form.name !== editingName;
  if (clashes) {
    const ok = await askConfirm({
      title: 'Name already used',
      body: `A preset named "${form.name}" already exists. Overwrite it with what you have typed?`,
      confirmLabel: 'OVERWRITE',
      danger: true
    });
    if (!ok) return;
  }

  const renamed = editingName && form.name !== editingName;
  const saved = await writePreset(form.name, buildStateFromForm(form),
    renamed ? `Saved as "${form.name}"` : (editingName ? 'Changes saved' : 'Preset created'));
  if (!saved) return;

  // เปลี่ยนชื่อ = เขียนอันใหม่ ของเดิมยังอยู่ ต้องลบเองไม่งั้นได้สองอัน
  if (renamed) await removePreset(editingName, { silent: true });

  resetForm();
}

// โหลดพรีเซ็ตทับสถานะที่ออกอากาศอยู่ทันที ถามก่อนเสมอ
async function loadPreset(name) {
  const ok = await askConfirm({
    title: 'Load preset',
    body: `Load "${name}"? This replaces the match currently on the overlay.`,
    confirmLabel: 'LOAD'
  });
  if (!ok) return;

  try {
    await fetchJson('/api/presets/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    showToast(`Loaded "${name}"`, 'green');
  } catch (error) {
    showToast(error.message || 'Could not load preset', 'red');
  }
}

// ส่ง state ที่ประกอบจากฟอร์มไปเลย server จะ sanitize ให้เอง
// ไม่ปล่อยให้ server ไปหยิบ gameState ปัจจุบันมาใช้เหมือนเดิม
async function writePreset(name, state, successMessage) {
  try {
    const data = await fetchJson('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, state })
    });
    details = data.details || [];
    renderList();
    showToast(successMessage, 'green');
    return true;
  } catch (error) {
    showToast(error.message || 'Could not save preset', 'red');
    return false;
  }
}

async function deletePreset(name) {
  const ok = await askConfirm({
    title: 'Remove preset',
    body: `Remove preset "${name}"? This cannot be undone.`,
    confirmLabel: 'REMOVE',
    danger: true
  });
  if (!ok) return;
  await removePreset(name);
  if (editingName === name) resetForm(); // อย่าค้างแก้ของที่ลบไปแล้ว
}

async function removePreset(name, { silent = false } = {}) {
  try {
    const data = await fetchJson(`/api/presets/${encodeURIComponent(name)}`, { method: 'DELETE' });
    details = data.details || [];
    renderList();
    if (!silent) showToast(`Removed "${name}"`, 'red');
  } catch (error) {
    showToast(error.message || 'Could not remove preset', 'red');
  }
}

// CONFIRM DIALOG ------------------------------------------------------
// แทน window.confirm() ทั้งหมด
//
// ใน Electron dialog ของระบบเป็น modal ของทั้ง renderer พอปิดแล้ว
// หน้าต่างรับคีย์บอร์ดไม่ได้ พิมพ์ในช่องไหนก็ไม่ขึ้น จนกว่าจะคลิกออก
// ไปแล้วคลิกกลับเข้ามา ตัวนี้เป็น DOM ล้วน ไม่มีปัญหานั้น
//
// คืนค่าเป็น Promise<boolean> เรียกใช้แทนที่เดิมได้ตรงๆ
let confirmResolve = null;

function askConfirm({ title, body, confirmLabel = 'CONFIRM', danger = false }) {
  const modal = document.getElementById('confirmModal');
  const okBtn = document.getElementById('confirmOk');
  if (!modal || !okBtn) return Promise.resolve(false); // ไม่มี modal ก็อย่าเผลอลบ

  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmBody').textContent = body;
  okBtn.textContent = confirmLabel;
  okBtn.classList.toggle('danger', danger);
  okBtn.classList.toggle('confirm', !danger);

  // คืน focus ให้ของเดิมตอนปิด ไม่ให้ค้างอยู่กับปุ่มที่หายไปแล้ว
  const previousFocus = /** @type {HTMLElement} */ (document.activeElement);
  modal.hidden = false;
  okBtn.focus();

  return new Promise((resolve) => {
    confirmResolve = (answer) => {
      modal.hidden = true;
      confirmResolve = null;
      if (previousFocus && document.contains(previousFocus)) previousFocus.focus();
      resolve(answer);
    };
  });
}

document.getElementById('confirmOk')?.addEventListener('click', () => confirmResolve?.(true));
document.getElementById('confirmCancel')?.addEventListener('click', () => confirmResolve?.(false));
document.getElementById('confirmModal')?.addEventListener('mousedown', (event) => {
  if (/** @type {HTMLElement} */ (event.target).id === 'confirmModal') confirmResolve?.(false); // คลิกนอกกล่อง
});
document.addEventListener('keydown', (event) => {
  if (!confirmResolve) return;
  if (event.key === 'Escape') { event.preventDefault(); confirmResolve(false); }
});

document.getElementById('presetSearch')?.addEventListener('input', (event) => {
  filter = /** @type {HTMLInputElement} */ (event.target).value.trim().toLowerCase();
  renderList();
});

buildPlayerInputs();

// Enter ที่ช่องไหนในฟอร์มก็เซฟ ไม่ต้องเอื้อมไปกดปุ่ม
document.querySelector('.save-panel')?.addEventListener('keydown', (/** @type {KeyboardEvent} */ event) => {
  if (event.key === 'Enter' && /** @type {HTMLElement} */ (event.target).tagName === 'INPUT') {
    event.preventDefault();
    savePreset();
  }
});

renderEditorMode();
refresh();
