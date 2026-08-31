// หน้าแรกของแอพ = รายการทัวร์นาเมนต์
//
// เดิมหน้านี้เป็นทางแยกไปเครื่องมือต่างๆ ตอนนี้เครื่องมือย้ายไปอยู่แถบบนหมดแล้ว
// เนื้อหาหลักของหน้าคือทัวร์นาเมนต์ ตามลำดับการใช้งานที่ตั้งใจไว้:
// เปิดแอพ -> เลือกทัวร์นาเมนต์ -> เข้าไปดู/แก้รายละเอียดของทัวร์นาเมนต์นั้น
//
// แถบสถานะด้านบนยังอยู่ เพราะบอกว่าตอนนี้ออกอากาศอะไรอยู่
// ซึ่งเป็นสิ่งแรกที่คนคุมงานอยากรู้เวลากลับมาที่หน้านี้

const { socket, fetchJson, showToast } = window.RovClient;

// การลบใช้ร่วมกับหน้า /tournament/:id คำเตือนจึงเป็นชุดเดียวกันทั้งสองที่
const { confirmAndDelete } = window.RovTournamentUI;

let options = null;

// STATUS BAR ---------------------------------------------------------

function setStatus(online, label) {
  const box = document.getElementById('status');
  box.classList.toggle('online', online === true);
  box.classList.toggle('offline', online === false);
  document.getElementById('statusLabel').textContent = label;
}

socket.on('connect', () => setStatus(true, 'Live'));
socket.on('disconnect', () => setStatus(false, 'Server offline'));
socket.on('connect_error', () => setStatus(false, 'No connection'));

socket.on('stateUpdate', (state) => {
  renderMatch(state);
  renderTags(state);
});

// ประกอบด้วย textContent ทั้งหมด ชื่อทีมมาจากผู้ใช้
function renderMatch(state) {
  const wrap = document.getElementById('statusMatch');
  wrap.textContent = '';

  const blue = document.createElement('span');
  blue.className = 'sm-blue';
  blue.textContent = state.teamBlue?.name || 'BLUE';

  const score = document.createElement('span');
  score.className = 'sm-score';
  score.textContent = `${state.teamBlue?.score ?? 0} - ${state.teamRed?.score ?? 0}`;

  const red = document.createElement('span');
  red.className = 'sm-red';
  red.textContent = state.teamRed?.name || 'RED';

  wrap.append(blue, score, red);
}

function renderTags(state) {
  const wrap = document.getElementById('statusTags');
  wrap.textContent = '';

  const tag = (text, cls = '') => {
    const el = document.createElement('span');
    el.className = `stag ${cls}`.trim();
    el.textContent = text;
    return el;
  };

  const onAir = state.overlayVisible !== false;
  wrap.appendChild(tag(onAir ? 'Banner on air' : 'Banner hidden', onAir ? 'on' : 'off'));
  wrap.appendChild(tag(`${state.overlaySize || '1080'}p`));
  if (state.draftLabel && state.draftLabel !== 'coming soon') {
    wrap.appendChild(tag(state.draftLabel));
  }
}

// CREATE FORM --------------------------------------------------------

// ตัวเลือกรูปแบบ/จำนวนเกมมาจากเซิร์ฟเวอร์ ไม่ฝังค่าซ้ำไว้ที่นี่
// เพิ่มรูปแบบใหม่ใน server/domain/tournament.ts แล้วหน้านี้ได้ตามเอง
async function loadOptions() {
  options = await fetchJson('/api/tournament-options');

  const format = document.getElementById('fFormat');
  format.textContent = '';
  options.formats.forEach((f) => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.label;
    format.appendChild(opt);
  });

  const bestOf = document.getElementById('fBestOf');
  bestOf.textContent = '';
  options.bestOf.forEach((n) => {
    const opt = document.createElement('option');
    opt.value = String(n);
    opt.textContent = `Best of ${n}`;
    if (n === 3) opt.selected = true;
    bestOf.appendChild(opt);
  });

  format.addEventListener('change', renderFormatHint);
  renderFormatHint();
}

// บอกเพดานทีมของรูปแบบที่เลือกไว้ตั้งแต่ตอนสร้าง
// จะได้ไม่ไปเจอตอนเพิ่มทีมครบ 24 แล้วค่อยรู้ว่าพบกันหมดรับได้เท่านี้
function renderFormatHint() {
  const id = /** @type {HTMLInputElement} */ (document.getElementById('fFormat')).value;
  const spec = options?.formats.find((f) => f.id === id);
  const hint = document.getElementById('formatHint');
  hint.textContent = spec
    ? `${spec.minTeams}-${spec.maxTeams} teams`
    : '';
}

function toggleCreate(show) {
  document.getElementById('createPanel').hidden = !show;
  document.getElementById('newBtn').hidden = show;
  if (show) /** @type {HTMLInputElement} */ (document.getElementById('fName')).focus();
}

async function createTournament() {
  const name = /** @type {HTMLInputElement} */ (document.getElementById('fName')).value.trim();
  if (!name) {
    showToast('Tournament name is required', 'red');
    /** @type {HTMLInputElement} */ (document.getElementById('fName')).focus();
    return;
  }

  try {
    const { tournament } = await fetchJson('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        format: /** @type {HTMLInputElement} */ (document.getElementById('fFormat')).value,
        bestOf: Number(/** @type {HTMLInputElement} */ (document.getElementById('fBestOf')).value),
        note: /** @type {HTMLInputElement} */ (document.getElementById('fNote')).value
      })
    });
    showToast(`Created ${tournament.name}`, 'green');
    window.location.href = `/tournament/${encodeURIComponent(tournament.id)}`;
  } catch (error) {
    showToast(error.message || 'Could not create tournament', 'red');
  }
}

// LIST ---------------------------------------------------------------

function badge(text, cls = '') {
  const el = document.createElement('span');
  el.className = `badge ${cls}`.trim();
  el.textContent = text;
  return el;
}

function formatLabel(id) {
  return options?.formats.find((f) => f.id === id)?.label || id;
}

// ปุ่มลบวางทับการ์ด ไม่ได้วางไว้ข้างในการ์ด
//
// การ์ดทั้งใบเป็น <a> ปุ่มที่ซ้อนอยู่ข้างในจะโดนคลิกดูดไปเปิดหน้าทัวร์นาเมนต์
// (และ <button> ใน <a> ก็ไม่ถูกกติกา HTML อยู่แล้ว) ห่อด้วย div แล้ววางปุ่มเป็นพี่น้อง
// กันจึงจบทั้งสองเรื่องพร้อมกัน โดยไม่ต้องไปดักหยุด event ให้ถูกจังหวะ
function deleteButton(tournament) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tcard-del';
  btn.textContent = 'DELETE';
  btn.title = `Delete ${tournament.name} and everything recorded under it`;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    // กันกดซ้ำระหว่างรอ ถ้าไม่ได้ลบก็คืนปุ่มให้กดใหม่ได้
    // ถ้าลบไปแล้วการ์ดจะหายไปทั้งใบตอน renderList() ไม่ต้องคืนอะไร
    const deleted = await confirmAndDelete(tournament);
    if (deleted) await renderList();
    else btn.disabled = false;
  });

  return btn;
}

// ทุกอย่างประกอบด้วย textContent ชื่อทัวร์นาเมนต์มาจากผู้ใช้
function tournamentCard(t) {
  const wrap = document.createElement('div');
  wrap.className = 'tcard-wrap';

  const card = document.createElement('a');
  card.className = `tcard ${t.status}`;
  card.href = `/tournament/${encodeURIComponent(t.id)}`;

  const top = document.createElement('div');
  top.className = 'tcard-top';
  const name = document.createElement('div');
  name.className = 'tcard-name';
  name.textContent = t.name;
  top.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'tcard-meta';
  meta.appendChild(badge(t.status === 'finished' ? 'Finished' : 'Active', t.status));
  meta.appendChild(badge(formatLabel(t.format)));
  meta.appendChild(badge(`Bo${t.bestOf}`));
  meta.appendChild(badge(
    `${t.teamCount} / ${t.maxTeams} teams`,
    t.teamCount >= t.maxTeams ? 'full' : 'count'
  ));

  card.append(top, meta);

  if (t.note) {
    const note = document.createElement('div');
    note.className = 'tcard-note';
    note.textContent = t.note;
    card.appendChild(note);
  }

  wrap.append(card, deleteButton(t));
  return wrap;
}

async function renderList() {
  const wrap = document.getElementById('tournamentList');
  wrap.textContent = '';

  let tournaments = [];
  try {
    tournaments = (await fetchJson('/api/tournaments')).tournaments || [];
  } catch (error) {
    showToast(error.message || 'Could not load tournaments', 'red');
    return;
  }

  if (tournaments.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No tournaments yet. Create one to get started.';
    wrap.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'tlist';
  tournaments.forEach((t) => list.appendChild(tournamentCard(t)));
  wrap.appendChild(list);
}

function renderFoot() {
  document.getElementById('foot').textContent =
    'Open a tournament to edit its details and copy the OBS browser source URLs. ' +
    'The Control Panel, Presets and Design pages still work on their own for a ' +
    'quick match that is not part of any tournament.';
}

// BOOT ---------------------------------------------------------------

document.getElementById('newBtn').addEventListener('click', () => toggleCreate(true));
document.getElementById('cancelBtn').addEventListener('click', () => toggleCreate(false));
document.getElementById('createBtn').addEventListener('click', createTournament);
document.getElementById('fName').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') createTournament();
});

setStatus(null, 'Connecting');
renderFoot();

(async () => {
  try {
    await loadOptions();
  } catch (error) {
    showToast(error.message || 'Could not load tournament options', 'red');
  }
  await renderList();
})();
