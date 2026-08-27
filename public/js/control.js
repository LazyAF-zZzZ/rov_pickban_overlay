const { controlToken, socket, withToken, fetchJson, showToast, onDataChange } = window.RovClient;
// ชื่อเดิมในไฟล์นี้ ใช้ตัวเดียวกับ absoluteUrl ของ app-client
const overlayUrl = window.RovClient.absoluteUrl;

let heroes = [];
let draftSequence = [];
// เริ่มด้วยค่า default ไว้ก่อน state จาก server จะมาถึง กด F5 แล้วรีบกดคีย์ลัด
// ยังใช้ได้ทันที ไม่ต้องรอ socket
let hotkeys = { ...window.HotkeyUtils.DEFAULTS };
let latestState = null;
let uiBuilt = false;
let swPl = null;
let swPk = null;
let lastFocusedPhase = null;

socket.on('connect', () => showToast('Connected', 'green'));
socket.on('disconnect', () => showToast('Disconnected', 'red'));
socket.on('connect_error', (error) => showToast(error.message || 'Connection error', 'red'));
socket.on('controlError', (error) => showToast(error.message || 'Control blocked', 'red'));
socket.on('stateUpdate', (state) => {
  latestState = state;
  if (uiBuilt) {
    loadState(state);
    updateDraftUI(state);

  }
});

// พรีเซ็ตย้ายไปหน้า /presets แล้ว หน้านี้จึงไม่ต้องโหลดรายการมาอีก
async function boot() {
  const [heroesResult, draftResult, stateResult] = await Promise.allSettled([
    fetchJson('/api/heroes'),
    fetchJson('/api/draft-sequence'),
    fetchJson('/api/state')
  ]);

  heroes = valueOf(heroesResult)?.heroes || [];
  draftSequence = valueOf(draftResult)?.sequence || [];
  latestState = valueOf(stateResult) || latestState;

  const failedLoad = [heroesResult, draftResult, stateResult]
    .find((result) => result.status === 'rejected');
  if (failedLoad) showToast(failedLoad.reason?.message || 'Control data failed to load', 'red');

  buildAllUI();
  uiBuilt = true;
  bindLogoInputs();

  if (latestState) {
    loadState(latestState);
    updateDraftUI(latestState);
  }
}

function valueOf(result) {
  return result.status === 'fulfilled' ? result.value : null;
}


// TEAM LOGOS ---------------------------------------------------------
// Uploads the raw file with its own content-type, same shape as the skin
// uploader on the design page. The server checks the magic bytes and
// names the file itself, so nothing user-typed reaches the filesystem.
const LOGO_UI = {
  teamBlue: { file: 'blueLogoFile', preview: 'blueLogoPreview' },
  teamRed: { file: 'redLogoFile', preview: 'redLogoPreview' }
};
const LOGO_FILES = { teamBlue: 'blue-team', teamRed: 'red-team' };
const LOGO_MAX_BYTES = 4 * 1024 * 1024;

// ขนาดที่ overlay วาดจริง: 138px ตอน 1080p และ 184px ตอน 1440p
// (ทั้งแถบถูกขยาย 4/3) บอกเลข 1440p เพราะย่อลงมาที่ 138 ได้คมกว่า
// ถ้าแก้ .team-logo-score ใน overlay.css อย่าลืมแก้ตรงนี้ด้วย
const LOGO_DRAW_PX = 184;
const LOGO_SIZE_HINT = `${LOGO_DRAW_PX} × ${LOGO_DRAW_PX}`;
const LOGO_SIZE_TITLE =
  `Square PNG, JPG or WEBP. Drawn at ${LOGO_DRAW_PX}×${LOGO_DRAW_PX} on 2560x1440 ` +
  `and 108×108 on 1920x1080, so ${LOGO_DRAW_PX}px or larger stays sharp on both.`;

function pickTeamLogo(team) {
  const input = document.getElementById(LOGO_UI[team]?.file);
  if (input) input.click();
}

async function uploadTeamLogo(team, file) {
  if (file.size > LOGO_MAX_BYTES) {
    showToast('Logo must be under 4 MB', 'red');
    return;
  }
  try {
    const response = await fetch(withToken(`/api/team-logo/${team}`), {
      method: 'POST',
      headers: {
        'Content-Type': file.type,
        ...(controlToken ? { Authorization: `Bearer ${controlToken}` } : {})
      },
      body: file
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || response.statusText);
    showToast('Logo uploaded', 'green');
  } catch (error) {
    showToast(error.message || 'Upload failed', 'red');
  }
}

async function clearTeamLogo(team) {
  try {
    const response = await fetch(withToken(`/api/team-logo/${team}`), {
      method: 'DELETE',
      headers: controlToken ? { Authorization: `Bearer ${controlToken}` } : {}
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || response.statusText);
    showToast('Logo cleared', 'red');
  } catch (error) {
    showToast(error.message || 'Clear failed', 'red');
  }
}

function bindLogoInputs() {
  Object.entries(LOGO_UI).forEach(([team, ids]) => {
    const input = /** @type {HTMLInputElement} */ (document.getElementById(ids.file));
    if (!input) return;
    input.addEventListener('change', () => {
      if (input.files[0]) uploadTeamLogo(team, input.files[0]);
      input.value = ''; // ให้เลือกไฟล์เดิมซ้ำได้
    });
  });
}

function renderTeamLogo(team, logo) {
  const preview = document.getElementById(LOGO_UI[team]?.preview);
  if (!preview) return;
  const version = logo?.v || 0;
  const ext = logo?.ext || '';

  preview.title = LOGO_SIZE_TITLE;

  if (!version || !ext) {
    preview.style.backgroundImage = '';
    preview.classList.remove('filled');
    preview.textContent = LOGO_SIZE_HINT;
    return;
  }
  preview.textContent = '';
  preview.classList.add('filled');
  preview.style.backgroundImage =
    `url("images/team-logos/${LOGO_FILES[team]}.${ext}?v=${version}")`;
}

async function copyOverlayUrl(path) {
  const url = overlayUrl(path);
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const input = document.createElement('input');
      input.value = url;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.left = '-9999px';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    showToast('URL copied', 'green');
  } catch (error) {
    showToast('Copy failed', 'red');
  }
}

function buildAllUI() {

  ['blue', 'red'].forEach((color) => {
    buildPPTable(color);
    buildBans(color);
  });
  buildDraftBadges();
}

// One shared dropdown, moved under whichever hero box has focus.
// A native <datalist> cannot be ranked or filtered from script, so the
// suggestion list is built by hand.
let ddEl = null;
let ddInput = null;
let ddItems = [];
let ddIndex = -1;

function ensureDropdown() {
  if (ddEl) return ddEl;
  ddEl = document.createElement('div');
  ddEl.className = 'hero-dd';
  ddEl.hidden = true;
  // mousedown, not click: click would land after blur has already closed us.
  ddEl.addEventListener('mousedown', (event) => {
    const item = /** @type {HTMLElement} */ (event.target).closest('.hero-dd-item');
    if (!item) return;
    event.preventDefault();
    chooseSuggestion(Number(/** @type {HTMLElement} */ (item).dataset.index));
  });
  document.body.appendChild(ddEl);

  // It is placed at page coordinates, so anything that moves the input out
  // from under it must dismiss it rather than leave it floating.
  //
  // Capture phase means this also sees scrolls INSIDE the list, and the list
  // is taller than its box on purpose - so the first wheel tick was closing
  // the very thing you were trying to scroll. Scrolls that start inside it
  // move nothing out from under anything, so they are ignored.
  window.addEventListener('scroll', (event) => {
    if (ddEl && event.target instanceof Node && ddEl.contains(event.target)) return;
    closeDropdown();
  }, true);
  window.addEventListener('resize', closeDropdown);

  return ddEl;
}

function openDropdown(input) {
  const el = ensureDropdown();
  ddInput = input;
  ddItems = matchHeroes(input.value, input.id);

  if (ddItems.length === 0) {
    closeDropdown();
    return;
  }

  ddIndex = 0;
  el.textContent = '';
  ddItems.forEach((hero, index) => {
    const item = document.createElement('div');
    item.className = `hero-dd-item${index === 0 ? ' active' : ''}`;
    item.dataset.index = String(index);
    item.textContent = hero;
    el.appendChild(item);
  });

  const box = input.getBoundingClientRect();
  el.style.left = `${box.left + window.scrollX}px`;
  el.style.top = `${box.bottom + window.scrollY + 2}px`;
  el.style.minWidth = `${box.width}px`;
  el.hidden = false;
  el.scrollTop = 0;
}

function closeDropdown() {
  if (!ddEl) return;
  ddEl.hidden = true;
  ddInput = null;
  ddItems = [];
  ddIndex = -1;
}

function moveDropdown(step) {
  if (ddEl?.hidden || ddItems.length === 0) return;
  ddIndex = (ddIndex + step + ddItems.length) % ddItems.length;
  Array.from(ddEl.children).forEach((child, index) => {
    child.classList.toggle('active', index === ddIndex);
  });
  ddEl.children[ddIndex]?.scrollIntoView({ block: 'nearest' });
}

function chooseSuggestion(index) {
  const input = ddInput;
  const hero = ddItems[index];
  if (!input || !hero) return;
  input.value = hero;
  closeDropdown();
  commitHeroInput(input, input._onCommit, true);
}

// Every hero already banned or picked is gone for the rest of the draft.
// exceptSlotId lets the slot being edited keep its own hero.
function takenHeroes(exceptSlotId) {
  const taken = new Set();
  if (!latestState) return taken;

  [['blue', 'teamBlue'], ['red', 'teamRed']].forEach(([color, teamKey]) => {
    [['Pick', 'picks'], ['Ban', 'bans']].forEach(([kind, field]) => {
      (latestState[teamKey]?.[field] || []).forEach((hero, index) => {
        if (!hero) return;
        if (`${color}${kind}${index}` === exceptSlotId) return;
        taken.add(hero);
      });
    });
  });

  return taken;
}


function buildPPTable(color) {
  const team = color === 'blue' ? 'teamBlue' : 'teamRed';
  const tbody = document.getElementById(`${color}_pp`);
  if (!tbody) return;
  tbody.textContent = '';

  for (let i = 0; i < 5; i++) {
    const tr = document.createElement('tr');
    tr.className = 'pp-row';
    tr.id = `${color}_row${i}`;

    tr.appendChild(cellWithNumber(i + 1));
    tr.appendChild(cellWithPlayerInput(color, team, i));
    tr.appendChild(cellWithButton('SW', `btn-sw`, `${color}_psw${i}`, () => swapPlayer(color, i, document.getElementById(`${color}_psw${i}`))));
    tr.appendChild(cellWithHeroSelect(color, team, 'pick', i));
    tr.appendChild(cellWithButton('SW', `btn-sw`, `${color}_hsw${i}`, () => swapHero(color, i, document.getElementById(`${color}_hsw${i}`))));

    tbody.appendChild(tr);
  }
}

function cellWithNumber(number) {
  const td = document.createElement('td');
  const span = document.createElement('span');
  span.style.color = 'var(--muted2)';
  span.style.fontSize = '12px';
  span.style.fontWeight = '700';
  span.textContent = number;
  td.appendChild(span);
  return td;
}

function cellWithPlayerInput(color, team, index) {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.className = 'player-input';
  input.id = `${color}Player${index}`;
  input.placeholder = `Player ${index + 1}`;
  input.addEventListener('change', () => emitPlayerName(team, index, input.value));
  td.appendChild(input);
  return td;
}

function cellWithButton(text, className, id, handler) {
  const td = document.createElement('td');
  const button = document.createElement('button');
  button.className = className;
  button.id = id;
  button.type = 'button';
  button.textContent = text;
  button.addEventListener('click', handler);
  td.appendChild(button);
  return td;
}

function cellWithHeroSelect(color, team, type, index) {
  const td = document.createElement('td');
  td.className = type === 'pick' ? 'hero-select-wrap' : 'ban-select-wrap';
  td.id = `${color}_${type}_wrap${index}`;
  td.appendChild(makeHeroSearchInput(`${color}${type === 'pick' ? 'Pick' : 'Ban'}${index}`, type, (hero) => {
    socket.emit(type === 'pick' ? 'updatePick' : 'updateBan', { team, index, hero });
  }));
  return td;
}

function makeHeroSearchInput(id, type, onCommit) {
  const input = document.createElement('input');
  input.id = id;
  input.className = 'hero-search-input';
  input.autocomplete = 'off';
  input.placeholder = type === 'pick' ? 'Type hero...' : 'Type ban...';
  input._onCommit = onCommit;

  // Opens on typing or ArrowDown, never on plain focus: the draft auto-focuses
  // a slot after every phase, and a full-height list popping open over the
  // panel each time would just be in the way.
  input.addEventListener('input', () => {
    input.dataset.pendingValue = input.value;
    openDropdown(input);
  });
  input.addEventListener('change', () => commitHeroInput(input, onCommit));
  input.addEventListener('blur', () => {
    closeDropdown();
    commitHeroInput(input, onCommit);
  });

  input.addEventListener('keydown', (event) => {
    const open = ddInput === input && ddEl && !ddEl.hidden;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (open) moveDropdown(1); else openDropdown(input);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (open) moveDropdown(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      // Take the highlighted suggestion when the list is showing.
      if (open && ddIndex >= 0) chooseSuggestion(ddIndex);
      else commitHeroInput(input, onCommit, true);
      return;
    }
    if (event.key === 'Escape') {
      if (open) {
        closeDropdown();
        return;
      }
      input.value = input.dataset.lastHero || '';
      input.blur();
    }
  });

  return input;
}

function buildBans(color) {
  const team = color === 'blue' ? 'teamBlue' : 'teamRed';
  const el = document.getElementById(`${color}_bans`);
  if (!el) return;
  el.textContent = '';

  for (let i = 0; i < 4; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'ban-slot-wrap';

    const label = document.createElement('span');
    label.className = 'ban-slot-label';
    label.textContent = `Ban ${i + 1}`;

    const selectWrap = document.createElement('div');
    selectWrap.className = 'ban-select-wrap';
    selectWrap.id = `${color}_ban_wrap${i}`;
    selectWrap.appendChild(makeHeroSearchInput(`${color}Ban${i}`, 'ban', (hero) => {
      socket.emit('updateBan', { team, index: i, hero });
    }));

    const clear = document.createElement('button');
    clear.className = 'ban-clear';
    clear.type = 'button';
    clear.textContent = 'clear';
    clear.addEventListener('click', () => clearBanSlot(team, i));

    wrap.append(label, selectWrap, clear);
    el.appendChild(wrap);
  }
}

function loadState(state) {
  if (state.matchInfo) {
    setVal('tournamentName', state.matchInfo.tournament || '');
    setVal('matchTitle', state.matchInfo.title || '');
  }

  renderTeamLogo('teamBlue', state.teamBlue.logo);
  renderTeamLogo('teamRed', state.teamRed.logo);

  setVal('blueTeamName', state.teamBlue.name);
  setVal('blueScore', state.teamBlue.score);
  state.teamBlue.players.forEach((p, i) => setVal(`bluePlayer${i}`, p));
  state.teamBlue.picks.forEach((h, i) => setSelect(`bluePick${i}`, h));
  state.teamBlue.bans.forEach((h, i) => setSelect(`blueBan${i}`, h));

  setVal('redTeamName', state.teamRed.name);
  setVal('redScore', state.teamRed.score);
  state.teamRed.players.forEach((p, i) => setVal(`redPlayer${i}`, p));
  state.teamRed.picks.forEach((h, i) => setSelect(`redPick${i}`, h));
  state.teamRed.bans.forEach((h, i) => setSelect(`redBan${i}`, h));

  const td = document.getElementById('timerDisplay');
  if (td && state.draftLabel !== 'coming soon') td.textContent = state.timer || '--';
  renderOverlaySize(state.overlaySize);
  renderOverlayVisible(state.overlayVisible);
  applyHotkeys(state.hotkeys);
}

// แถบคำใบ้ท้ายหน้าเคยเป็นข้อความตายตัวใน HTML พอคีย์ลัดตั้งค่าได้แล้ว
// มันจะโกหกทันทีที่ผู้ใช้เปลี่ยนปุ่ม จึงวาดจากค่าจริงแทน
function applyHotkeys(next) {
  if (next && typeof next === 'object') {
    hotkeys = { ...window.HotkeyUtils.DEFAULTS, ...next };
  }
  renderHotkeyHints();
}

function renderHotkeyHints() {
  const wrap = document.getElementById('kbdHint');
  if (!wrap) return;
  const { ACTIONS, bindingLabel } = window.HotkeyUtils;

  const hints = [
    ['Enter', 'confirm hero'],
    ['Esc', 'leave box']
  ].concat(ACTIONS.map((action) => [bindingLabel(hotkeys[action.key]), action.short]));

  wrap.textContent = '';
  hints.forEach(([keyText, label]) => {
    const span = document.createElement('span');
    const b = document.createElement('b');
    b.textContent = keyText;
    span.append(b, document.createTextNode(` ${label}`));
    wrap.appendChild(span);
  });
}

function setVal(id, val) {
  const el = /** @type {HTMLInputElement} */ (document.getElementById(id));
  if (el && document.activeElement !== el) el.value = val ?? '';
}

function setSelect(id, val) {
  const el = /** @type {HTMLInputElement} */ (document.getElementById(id));
  if (el && document.activeElement !== el) {
    el.value = val || '';
    el.dataset.lastHero = val || '';
  }
}

// Ranking: exact name, then names starting with what was typed, then names
// whose second word starts with it ("baron" still finds "bolt baron").
// Loose substring matches are deliberately not offered - typing "b" should
// never surface "ilumia" just because it contains a b somewhere.
function startsWithAnyWord(hero, lower) {
  return hero.toLowerCase().split(/\s+/).some((word) => word.startsWith(lower));
}

function normalizeHeroInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return heroes.find((hero) => hero.toLowerCase() === lower) ||
    heroes.find((hero) => hero.toLowerCase().startsWith(lower)) ||
    heroes.find((hero) => startsWithAnyWord(hero, lower)) ||
    null;
}

// Suggestions for the dropdown: available heroes only, prefix matches first.
// Returns [] when nothing matches, which hides the dropdown entirely.
function matchHeroes(query, exceptSlotId) {
  const taken = takenHeroes(exceptSlotId);
  const available = heroes.filter((hero) => !taken.has(hero));
  const lower = String(query || '').trim().toLowerCase();
  if (!lower) return available;

  const prefix = [];
  const wordStart = [];
  available.forEach((hero) => {
    if (hero.toLowerCase().startsWith(lower)) prefix.push(hero);
    else if (startsWithAnyWord(hero, lower)) wordStart.push(hero);
  });
  return prefix.concat(wordStart);
}

function commitHeroInput(input, onCommit, preferMatch = false) {
  const previous = input.dataset.lastHero || '';
  const hero = normalizeHeroInput(input.value);
  if (input.value.trim() && !hero) {
    input.value = previous;
    showToast('Hero not found', 'red');
    return;
  }
  // The server enforces this too; checking here just makes the feedback instant.
  if (hero && takenHeroes(input.id).has(hero)) {
    input.value = previous;
    showToast(`${hero} is already used`, 'red');
    return;
  }
  const next = hero || null;
  input.value = next || '';
  input.dataset.lastHero = next || '';
  if (preferMatch || next !== (previous || null)) onCommit(next);
}

function emitPlayerName(team, index, name) {
  socket.emit('updatePlayerName', { team, index, name });
}

// AUTO-SAVE -----------------------------------------------------------
// ไม่มีปุ่ม SAVE แล้ว ทุกช่องเซฟเองหลังหยุดพิมพ์
//
// หน่วงไว้ก่อนส่ง ไม่งั้นพิมพ์ทีละตัวอักษรก็ยิง event ทุกครั้ง
// ชื่อทีมโผล่บน overlay สดๆ อยู่แล้ว การเห็นตัวอักษรค่อยๆ ขึ้นทีละตัว
// ระหว่างพิมพ์ไม่ใช่สิ่งที่อยากให้ออกอากาศ
//
// ปุ่มเดิมเซฟชื่อทีม + สกอร์ + ชื่อผู้เล่นพร้อมกัน ตอนนี้แต่ละช่องเซฟของ
// ตัวเอง ถ้าเซฟแค่ชื่อทีมแล้วเอาปุ่มออก สกอร์กับผู้เล่นจะไม่มีทางถูกบันทึก
const AUTOSAVE_DELAY = 450;
const autosaveTimers = new Map();

function autosave(key, indicatorId, send) {
  clearTimeout(autosaveTimers.get(key));
  autosaveTimers.set(key, setTimeout(() => {
    send();
    flashSaved(indicatorId);
  }, AUTOSAVE_DELAY));
}

function flashSaved(indicatorId) {
  const el = document.getElementById(indicatorId);
  if (!el) return;
  el.textContent = 'Saved';
  el.classList.add('saved');
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.textContent = 'Auto-saves';
    el.classList.remove('saved');
  }, 1400);
}

// ผูกแบบ delegate เพราะแถวผู้เล่นถูกสร้างด้วย JS ทีหลัง
document.addEventListener('input', (event) => {
  const el = /** @type {HTMLInputElement} */ (event.target);
  if (!el.id) return;

  if (el.id === 'tournamentName' || el.id === 'matchTitle') {
    autosave('matchInfo', 'matchInfoSaved', () => socket.emit('updateMatchInfo', {
      tournament: /** @type {HTMLInputElement} */ (document.getElementById('tournamentName')).value,
      title: /** @type {HTMLInputElement} */ (document.getElementById('matchTitle')).value
    }));
    return;
  }

  const name = /^(blue|red)TeamName$/.exec(el.id);
  if (name) {
    const team = name[1] === 'blue' ? 'teamBlue' : 'teamRed';
    autosave(el.id, `${name[1]}Saved`, () => socket.emit('updateTeamName', { team, name: el.value }));
    return;
  }

  const player = /^(blue|red)Player([0-4])$/.exec(el.id);
  if (player) {
    const team = player[1] === 'blue' ? 'teamBlue' : 'teamRed';
    autosave(el.id, `${player[1]}Saved`, () => socket.emit('updatePlayerName', {
      team, index: Number(player[2]), name: el.value
    }));
    return;
  }

  const score = /^(blue|red)Score$/.exec(el.id);
  if (score) {
    const team = score[1] === 'blue' ? 'teamBlue' : 'teamRed';
    autosave(el.id, `${score[1]}Saved`, () => socket.emit('updateScore', {
      team, score: parseInt(el.value, 10) || 0
    }));
  }
});

function setOverlaySize(size) {
  socket.emit('updateOverlaySize', { size });
  showToast(`Overlay size set to ${size}p`, 'blue');
}

function renderOverlaySize(size) {
  const active = size === '1440' ? '1440' : '1080';
  document.getElementById('sizeBtn1080')?.classList.toggle('active', active === '1080');
  document.getElementById('sizeBtn1440')?.classList.toggle('active', active === '1440');
}

// visible = true/false สั่งตรงๆ, ไม่ส่งค่า = ให้ server สลับให้
// ปุ่มรู้อยู่แล้วว่าจะเอาสถานะไหน ส่วนคีย์ H ไม่ส่ง จะได้ไม่พลาดถ้า
// หน้านี้เห็น state ไม่ตรงกับเครื่องอื่นที่เปิด control อยู่
function setOverlayVisible(visible) {
  socket.emit('setOverlayVisible', typeof visible === 'boolean' ? { visible } : {});
}

// null = ยังไม่รู้สถานะแรก จะได้ไม่เด้ง toast ตอนเพิ่งเปิดหน้า
let lastOverlayVisible = null;

// แจ้งเตือนจากตรงนี้ที่เดียว ไม่ใช่ตอนกดปุ่ม เพราะคีย์ลัดให้ server สลับให้
// ค่าจริงจึงรู้ตอน state กลับมาเท่านั้น และวิธีนี้ครอบคลุมกรณีที่อีกเครื่อง
// เป็นคนสั่งด้วย
function renderOverlayVisible(visible) {
  const on = visible !== false;
  document.getElementById('overlayShowBtn')?.classList.toggle('active', on);
  document.getElementById('overlayHideBtn')?.classList.toggle('active', !on);

  if (lastOverlayVisible !== null && lastOverlayVisible !== on) {
    showToast(on ? 'Overlay on air' : 'Overlay hidden', on ? 'green' : 'red');
  }
  lastOverlayVisible = on;
}


function switchTeams() {
  socket.emit('switchTeams');
  showToast('Teams switched', 'blue');
}

// CONFIRM DIALOG ------------------------------------------------------
// เหมือนหน้า Presets ไม่ใช้ window.confirm() เพราะใน Electron dialog ของ
// ระบบเป็น modal ของทั้ง renderer ปิดแล้วหน้าต่างรับคีย์บอร์ดไม่ได้
let confirmResolve = null;

function askConfirm({ title, body, confirmLabel = 'CONFIRM' }) {
  const modal = document.getElementById('confirmModal');
  const okBtn = document.getElementById('confirmOk');
  if (!modal || !okBtn) return Promise.resolve(false); // ไม่มี modal ก็อย่าเผลอล้าง

  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmBody').textContent = body;
  okBtn.textContent = confirmLabel;

  const previousFocus = document.activeElement;
  modal.hidden = false;
  okBtn.focus();

  return new Promise((resolve) => {
    confirmResolve = (answer) => {
      modal.hidden = true;
      confirmResolve = null;
      if (previousFocus && document.contains(previousFocus)) /** @type {HTMLElement} */ (previousFocus).focus();
      resolve(answer);
    };
  });
}

document.getElementById('confirmOk')?.addEventListener('click', () => confirmResolve?.(true));
document.getElementById('confirmCancel')?.addEventListener('click', () => confirmResolve?.(false));
document.getElementById('confirmModal')?.addEventListener('mousedown', (event) => {
  if (/** @type {HTMLElement} */ (event.target).id === 'confirmModal') confirmResolve?.(false);
});

// ล้างดราฟต์ทั้งหมด กู้คืนไม่ได้ (Ctrl+Z ย้อนได้ทีละช่องเท่านั้น)
async function clearAll() {
  const ok = await askConfirm({
    title: 'Clear picks and bans',
    body: 'Clear every pick and ban for both teams? Team names, players and score are kept. This cannot be undone.',
    confirmLabel: 'CLEAR'
  });
  if (!ok) return;
  socket.emit('clearAll');
  showToast('All picks and bans cleared', 'red');
}

function clearBanSlot(team, index) {
  socket.emit('clearBan', { team, index });
}

function cancelSwap(type) {
  const sw = type === 'pl' ? swPl : swPk;
  if (!sw) return;
  sw.btn.textContent = 'SW';
  sw.btn.classList.remove('cancel-mode');
  document.getElementById(`${sw.color}_row${sw.idx}`)?.classList.remove('active-row');
  if (type === 'pl') swPl = null; else swPk = null;
}

function swapPlayer(color, idx, btn) {
  const team = color === 'blue' ? 'teamBlue' : 'teamRed';
  if (swPl) {
    if (swPl.color === color && swPl.idx === idx) {
      cancelSwap('pl');
      return;
    }
    if (swPl.color === color) {
      const a = /** @type {HTMLInputElement} */ (document.getElementById(`${color}Player${swPl.idx}`));
      const b = /** @type {HTMLInputElement} */ (document.getElementById(`${color}Player${idx}`));
      if (a && b) [a.value, b.value] = [b.value, a.value];
      socket.emit('updatePlayerName', { team, index: swPl.idx, name: a.value });
      socket.emit('updatePlayerName', { team, index: idx, name: b.value });
      const from = swPl.idx;
      cancelSwap('pl');
      showToast(`Player ${from + 1} swapped with ${idx + 1}`, 'green');
      return;
    }
    cancelSwap('pl');
  }
  swPl = { color, idx, btn };
  btn.textContent = 'CANCEL';
  btn.classList.add('cancel-mode');
  document.getElementById(`${color}_row${idx}`)?.classList.add('active-row');
}

function swapHero(color, idx, btn) {
  const team = color === 'blue' ? 'teamBlue' : 'teamRed';
  if (swPk) {
    if (swPk.color === color && swPk.idx === idx) {
      cancelSwap('pk');
      return;
    }
    if (swPk.color === color) {
      socket.emit('swapPicks', { team, index1: swPk.idx, index2: idx });
      const from = swPk.idx;
      cancelSwap('pk');
      showToast(`Pick ${from + 1} swapped with ${idx + 1}`, 'green');
      return;
    }
    cancelSwap('pk');
  }
  swPk = { color, idx, btn };
  btn.textContent = 'CANCEL';
  btn.classList.add('cancel-mode');
  document.getElementById(`${color}_row${idx}`)?.classList.add('active-row');
}

function buildDraftBadges() {
  const el = document.getElementById('draftSequenceList');
  if (!el) return;
  el.textContent = '';
  draftSequence.forEach((phase, i) => {
    const badge = document.createElement('span');
    badge.className = 'seq-badge';
    badge.id = `sb${i}`;
    badge.textContent = `${i + 1}. ${phase.label}`;
    el.appendChild(badge);
  });
}

function updateDraftUI(state) {
  const idx = state.draftPhaseIndex ?? -1;
  const total = draftSequence.length || 16;
  const td = document.getElementById('timerDisplay');
  const pl = document.getElementById('draftPhaseLabel');
  const pi = document.getElementById('draftPhaseIndex');

  if (td) {
    td.textContent = state.draftLabel === 'coming soon' ? '--' : state.timer || '--';
    const secs = parseTimeToSecs(state.timer);
    td.classList.toggle('urgent', secs > 0 && secs <= 10);
  }
  if (pl) pl.textContent = (state.draftLabel || 'READY').toUpperCase();
  if (pi) pi.textContent = idx >= 0 ? `Phase ${idx + 1} / ${total}` : `Phase 0 / ${total}`;

  // แถบสถานะของปุ่มใหญ่ ต้องอยู่ในฟังก์ชันนี้ เพราะ idx กับ total เป็นตัวแปรของที่นี่
  //
  // เดิมบล็อกนี้ไปอยู่ท้าย focusActiveSlot ซึ่งมองไม่เห็นตัวแปรทั้งสองตัว
  // ทุกครั้งที่เปลี่ยนเฟส มันจึงโยน ReferenceError: idx is not defined
  // ผลคือข้อความสถานะค้างที่ค่าเดิม และงานที่เหลือใน handler ของ stateUpdate
  // ถูกข้ามไปเงียบๆ โดยไม่มีอะไรบนหน้าจอบอกว่าพัง
  const bs = document.getElementById('bb_status');
  if (bs) {
    bs.textContent = idx < 0 ? 'Ready' : idx >= total ? 'Done' :
      `${state.draftLabel} - ${state.draftRunning ? 'Running' : 'Paused'}`;
  }

  draftSequence.forEach((_, i) => {
    const b = document.getElementById(`sb${i}`);
    if (b) b.className = `seq-badge${i === idx ? ' current' : i < idx ? ' done' : ''}`;
  });

  document.querySelectorAll('.slot-active').forEach((el) => el.classList.remove('slot-active'));
  (state.draftActiveSlots || []).forEach((slotId) => {
    const match = slotId.match(/^(blue|red)(Pick|Ban)(\d)$/);
    if (!match) return;
    const wrapId = `${match[1]}_${match[2] === 'Pick' ? 'pick' : 'ban'}_wrap${match[3]}`;
    document.getElementById(wrapId)?.classList.add('slot-active');
  });

  // Only when the phase actually changes. stateUpdate fires every second while
  // the clock runs, and grabbing focus on every tick would make typing impossible.
  if (idx !== lastFocusedPhase) {
    lastFocusedPhase = idx;
    focusActiveSlot(state);
  }
}

function focusActiveSlot(state) {
  const slots = state.draftActiveSlots || [];
  if (slots.length === 0) return;

  // Leave the operator alone if they are filling in team or player names.
  const active = document.activeElement;
  const inHeroField = active?.classList?.contains('hero-search-input');
  if (active && active.tagName === 'INPUT' && !inHeroField) return;

  // A phase can own two slots (e.g. "Red Pick 1+2"); go to the first empty one.
  const targetId = slots.find((slotId) => {
    const el = /** @type {HTMLInputElement} */ (document.getElementById(slotId));
    return el && !el.value;
  }) || slots[0];

  const target = /** @type {HTMLInputElement} */ (document.getElementById(targetId));
  if (!target) return;
  target.focus();
  target.select();
}

function parseTimeToSecs(t) {
  if (!t) return 0;
  const parts = String(t).split(':');
  return parts.length === 2 ? parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10) : parseInt(t, 10) || 0;
}

function undoLast() { socket.emit('undo'); }

function isTypingField(el) {
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

// The draft auto-focuses an empty hero box after every phase, so a plain
// "is the cursor in a field" check would kill the shortcuts exactly when they
// are needed. An empty hero box has nothing to edit, so let them through.
// Once something is typed the keys go back to normal editing - which matters
// for hero names containing a space, like "bolt baron".
function shortcutsAllowed() {
  const el = /** @type {HTMLInputElement} */ (document.activeElement);
  if (!isTypingField(el)) return true;
  return el.classList.contains('hero-search-input') && el.value === '';
}

// Shortcuts stay out of the way while the operator is typing a name.
// Press Escape to leave a hero box, then Space / arrows work.
document.addEventListener('keydown', (event) => {
  // ตอนกล่องยืนยันเปิดอยู่ คีย์ลัดต้องไม่ทำงาน ไม่งั้นกด H หรือ Space
  // ระหว่างถามยืนยัน จะไปสั่งซ่อนแถบหรือหยุดเวลาโดยไม่ตั้งใจ
  if (confirmResolve) {
    if (event.key === 'Escape') {
      event.preventDefault();
      confirmResolve(false);
    }
    event.stopPropagation();
    return;
  }

  const { matchesBinding } = window.HotkeyUtils;

  // Undo ถูกเช็คก่อน shortcutsAllowed() เพราะต้องใช้ได้ระหว่างเคอร์เซอร์
  // อยู่ในช่องด้วย แต่ถ้าในช่องมีข้อความอยู่ ให้เป็น undo ของการพิมพ์แทน
  if (matchesBinding(event, hotkeys.undo)) {
    const el = /** @type {HTMLInputElement} */ (document.activeElement);
    if (isTypingField(el) && el.value) return;
    event.preventDefault();
    undoLast();
    return;
  }

  if (!shortcutsAllowed()) return;

  // ถ้าผู้ใช้ตั้งสลับแถบเป็นปุ่มธรรมดา จะมาเข้าทางนี้
  // ถ้าตั้งเป็น modifier ล้วน matchesBinding คืน false แล้วไปเข้าทาง keyup แทน
  if (matchesBinding(event, hotkeys.toggleBanner)) {
    event.preventDefault();
    setOverlayVisible();
    return;
  }

  if (matchesBinding(event, hotkeys.pauseResume)) {
    event.preventDefault();
    if (latestState?.draftRunning) draftPause(); else draftResume();
    return;
  }

  if (matchesBinding(event, hotkeys.nextPhase)) {
    event.preventDefault();
    draftNext();
    return;
  }

  if (matchesBinding(event, hotkeys.prevPhase)) {
    event.preventDefault();
    draftPrev();
  }
});

// คีย์ลัดแบบ "แตะ modifier เดี่ยวๆ" (ค่าเริ่มต้นของสลับแถบ overlay คือ Alt)
//
// ปุ่ม modifier ดักตอน keydown ตรงๆ ไม่ได้ Alt+Tab กับ Alt+F4 ก็ยิง keydown
// ของ Alt เหมือนกัน แถบจะหายเองตอนสลับหน้าต่าง จึงนับเฉพาะกดแล้วปล่อย
// โดยไม่มีปุ่มอื่นคั่น
//
// ตอนนี้ผูกกับ hotkeys.toggleBanner ถ้าผู้ใช้ตั้งเป็นปุ่มธรรมดา
// จะไปเข้าทาง matchesBinding ใน keydown ด้านบนแทน ตรงนี้ไม่ทำงาน
let tapArmedCode = null;

document.addEventListener('keydown', (event) => {
  const { MODIFIER_CODES } = window.HotkeyUtils;
  if (MODIFIER_CODES.includes(event.key)) {
    if (!event.repeat) tapArmedCode = event.key; // กดค้างซ้ำๆ ไม่ยกเลิก
    return;
  }
  tapArmedCode = null; // มีปุ่มอื่นตามมา = เป็นคีย์ผสม ไม่ใช่การแตะ
});

document.addEventListener('keyup', (event) => {
  const { isModifierBinding } = window.HotkeyUtils;
  const binding = hotkeys.toggleBanner;
  if (!isModifierBinding(binding)) return;
  if (event.key !== binding.code || tapArmedCode !== binding.code) return;

  tapArmedCode = null;
  if (confirmResolve) return;       // กล่องยืนยันเปิดอยู่
  if (!shortcutsAllowed()) return;  // กำลังพิมพ์ในช่องอยู่
  event.preventDefault();           // กัน Alt ไปโฟกัสแถบเมนูของหน้าต่าง
  setOverlayVisible();
});

// สลับหน้าต่างด้วย Alt+Tab แล้ว keyup ของ Alt อาจไม่กลับมาที่หน้านี้
// ถ้าไม่ล้างค่า การแตะครั้งถัดไปจะถูกนับต่อจากของเก่า
window.addEventListener('blur', () => { tapArmedCode = null; });

function draftStart() { socket.emit('draftStart'); showToast('Draft started', 'green'); }
function draftPause() { socket.emit('draftPause'); showToast('Paused'); }
function draftResume() { socket.emit('draftResume'); showToast('Resumed', 'blue'); }
function draftNext() { socket.emit('draftNext'); }
function draftPrev() { socket.emit('draftPrev'); }
function draftReset() { socket.emit('draftReset'); showToast('Timer reset', 'red'); }


// ล้างทั้งแมตช์ ชื่อทีม ผู้เล่น สกอร์ ดราฟต์ หายหมด
async function resetMatchState() {
  const ok = await askConfirm({
    title: 'Reset match',
    body: 'Reset the whole match? Team names, players, score, picks and bans all go back to empty. This cannot be undone.',
    confirmLabel: 'RESET'
  });
  if (!ok) return;

  try {
    const data = await fetchJson('/api/reset-state', { method: 'POST' });
    if (data.state) {
      latestState = data.state;
      loadState(data.state);
      updateDraftUI(data.state);
    }
    showToast('State reset', 'red');
  } catch (error) {
    showToast(error.message, 'red');
  }
}

boot();

// LIVE MATCH BANNER ---------------------------------------------------
//
// บอกว่ากำลังคุมคู่ไหนของทัวร์นาเมนต์ไหนอยู่ และดราฟต์กำลังถูกบันทึกลงเกมไหน
// ขึ้นเฉพาะตอนเข้ามาจากหน้าทัวร์นาเมนต์ แมตช์เดี่ยวจะไม่เห็นแถบนี้
//
// สำคัญกับคนคุมงาน: ถ้าไม่บอก จะแยกไม่ออกว่าที่กำลังดราฟต์อยู่นี่
// ถูกบันทึกเข้าทัวร์นาเมนต์หรือเป็นแค่แมตช์ซ้อมที่ไม่ได้เก็บอะไรเลย
async function renderLiveBar() {
  const bar = document.getElementById('liveBar');
  if (!bar) return;

  let live = null;
  try {
    live = (await fetchJson('/api/live-match')).live;
  } catch {
    return; // ยังไม่มีระบบทัวร์นาเมนต์ก็ไม่ต้องแสดงอะไร
  }

  if (!live || !live.matchId) {
    bar.hidden = true;
    return;
  }

  bar.textContent = '';
  const dot = document.createElement('span');
  dot.textContent = 'ON AIR';

  const where = document.createElement('span');
  where.className = 'lb-muted';
  where.textContent = [live.tournamentName, live.matchLabel, live.gameNo ? `Game ${live.gameNo}` : null]
    .filter(Boolean).join('  ·  ');

  const note = document.createElement('span');
  note.className = 'lb-muted';
  note.textContent = 'draft is being recorded';

  const back = document.createElement('a');
  back.className = 'tlink lb-spacer';
  back.href = withToken(`/tournament/${encodeURIComponent(live.tournamentId || '')}`);
  back.textContent = 'BACK TO TOURNAMENT';

  bar.append(dot, where, note, winnerControls(live), back);
  bar.hidden = false;
}

// ใครชนะเกมนี้
//
// ต้องกดตอนนั้น ย้อนหลังไม่ได้: คะแนนซีรีส์ 2-1 บอกแค่ว่าใครชนะซีรีส์
// ไม่ได้บอกว่าเกมที่สองใครชนะ อัตราชนะรายฮีโร่จึงขึ้นกับปุ่มนี้ทั้งหมด
// เกมที่จบไปโดยไม่มีใครกด จะไม่มีวันมีอัตราชนะย้อนหลังได้อีก
function winnerControls(live) {
  const wrap = document.createElement('span');
  wrap.className = 'lb-winner';

  const label = document.createElement('span');
  label.className = 'lb-muted';
  label.textContent = `Who won game ${live.gameNo ?? 1}?`;
  wrap.appendChild(label);

  [{ side: 'blue', text: 'BLUE' }, { side: 'red', text: 'RED' }].forEach(({ side, text }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tlink lb-${side}`;
    button.textContent = text;
    // กดซ้ำที่ฝั่งเดิม = ล้างค่า เผื่อกดผิด จะได้ไม่ต้องมีปุ่มยกเลิกแยกอีกปุ่ม
    if (live.winner === side) button.classList.add('chosen');
    button.addEventListener('click', () => setGameWinner(live.winner === side ? null : side));
    wrap.appendChild(button);
  });

  if (!live.winner) {
    const hint = document.createElement('span');
    hint.className = 'lb-muted';
    hint.textContent = 'not recorded';
    wrap.appendChild(hint);
  }

  return wrap;
}

async function setGameWinner(winner) {
  const live = await fetchJson('/api/live-match').then((d) => d.live).catch(() => null);
  if (!live?.gameId) {
    showToast('No game is on air', 'red');
    return;
  }

  try {
    await fetchJson(`/api/games/${encodeURIComponent(live.gameId)}/winner`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner })
    });
    showToast(winner ? `Game winner: ${winner.toUpperCase()}` : 'Game winner cleared', winner ? 'green' : 'blue');
    renderLiveBar();
  } catch (error) {
    showToast(error.message || 'Could not record the winner', 'red');
  }
}

renderLiveBar();

// คู่ที่ออกอากาศเปลี่ยนได้จากหน้าจัดการแข่ง ไม่ใช่จากหน้านี้ที่เดียว
// แถบ ON AIR เคยอ่านค่าครั้งเดียวตอนเปิดหน้า เปลี่ยนคู่จากอีกจอแล้วที่นี่ยังโชว์คู่เก่า
onDataChange((change) => {
  if (change.topic === 'live' || change.topic === 'games' || change.topic === 'matches') {
    renderLiveBar();
  }
});
