// หน้ารายละเอียดของทัวร์นาเมนต์หนึ่งรายการ
//
// เสิร์ฟที่ /tournament/:id หน้าเดียวใช้กับทุก id
// อ่าน id จาก URL เอง ไม่ได้รับมาจากเซิร์ฟเวอร์ตอน render
//
// ทุกอย่างในหน้านี้ประกอบด้วย textContent / value ไม่มีการต่อ innerHTML
// เพราะชื่อทัวร์นาเมนต์กับโน้ตเป็นข้อความที่ผู้ใช้พิมพ์เอง

const { socket, fetchJson, absoluteUrl, withToken, showToast, onDataChange, deferWhileEditing } = window.RovClient;

// ช่องผู้เล่น โลโก้ และตัวอัปโหลด ใช้ร่วมกับหน้า /teams และ /teams/:id
// อย่าก็อปกลับมาไว้ในไฟล์นี้อีก — สองชุดที่แก้คนละที่คือที่มาของบั๊กเดิม
const { badge, buildPlayerRows, logoImage, sendLogo, hiddenFilePicker, on } = window.RovTeamUI;

// /tournament/g3a1b2c3  ->  g3a1b2c3
const tournamentId = decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1] || '');

let options = null;
let current = null;   // ทัวร์นาเมนต์ที่โหลดมาล่าสุด ใช้ตอนกด REVERT
let roster = [];      // ทีมที่ลงแข่งในทัวร์นาเมนต์นี้
let registry = [];    // ทีมทั้งหมดในทะเบียนกลาง ไว้ใส่ใน dropdown
let newTeamPlayers = null; // ตัวอ่านค่าช่องผู้เล่นในฟอร์มสร้างทีมใหม่
let pendingLogo = null;    // ไฟล์โลโก้ที่เลือกไว้ รออัปโหลดหลังทีมถูกสร้าง

// ขนาดหน้าจอเลือกที่ control panel หน้านี้แค่บอกว่า URL ไหนคู่กับขนาดไหน
const SOURCES = [
  { name: 'Overlay 1080p', path: '/overlay', size: '1920 x 1080' },
  { name: 'Overlay 1440p', path: '/overlay-1440', size: '2560 x 1440' },
  { name: 'Result', path: '/result', size: 'matches overlay size' },
  // รายชื่อทีมของทัวร์นาเมนต์นี้ ต้องแนบ id ไปกับ URL ด้วย
  // ไม่งั้น overlay จะเดาเอาจากแมตช์ที่ออกอากาศ ซึ่งไม่ใช่สิ่งที่คนก๊อป URL จากหน้านี้ตั้งใจ
  { name: 'Team list', path: '/overlay-teams', size: 'matches overlay size', perTournament: true }
];

// HELPERS ------------------------------------------------------------

function formatSpec(id) {
  return options?.formats.find((f) => f.id === id) || null;
}

function fillSelect(select, items, value) {
  select.textContent = '';
  items.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = String(item.value);
    opt.textContent = item.label;
    if (String(item.value) === String(value)) opt.selected = true;
    select.appendChild(opt);
  });
}

// RENDER -------------------------------------------------------------

function renderHead(t) {
  document.getElementById('headName').textContent = t.name;
  document.title = `${t.name} - ROV Overlay Tool`;

  const wrap = document.getElementById('headBadges');
  wrap.textContent = '';
  wrap.appendChild(badge(t.status === 'finished' ? 'Finished' : 'Active', t.status));
  wrap.appendChild(badge(formatSpec(t.format)?.label || t.format));
  wrap.appendChild(badge(`Bo${t.bestOf}`));
}

function renderForm(t) {
  /** @type {HTMLInputElement} */ (document.getElementById('fName')).value = t.name;
  /** @type {HTMLInputElement} */ (document.getElementById('fNote')).value = t.note || '';

  fillSelect(
    document.getElementById('fFormat'),
    options.formats.map((f) => ({ value: f.id, label: f.label })),
    t.format
  );
  fillSelect(
    document.getElementById('fBestOf'),
    options.bestOf.map((n) => ({ value: n, label: `Best of ${n}` })),
    t.bestOf
  );
  /** @type {HTMLInputElement} */ (document.getElementById('fStatus')).value = t.status;

  renderFormatHint();
}

// เตือนตั้งแต่ตอนเลือก ถ้ารูปแบบใหม่รับทีมได้น้อยกว่าที่มีอยู่
// เซิร์ฟเวอร์ปฏิเสธอยู่แล้ว แต่รู้ก่อนกดเซฟย่อมดีกว่ารู้ตอนโดนปฏิเสธ
function renderFormatHint() {
  const spec = formatSpec(/** @type {HTMLInputElement} */ (document.getElementById('fFormat')).value);
  const hint = document.getElementById('formatHint');
  if (!spec) {
    hint.textContent = '';
    return;
  }

  const teams = current?.teamCount ?? 0;
  if (teams > spec.maxTeams) {
    hint.textContent = `${spec.label} allows ${spec.maxTeams}, this has ${teams}`;
    hint.style.color = 'var(--red)';
  } else {
    hint.textContent = `${spec.minTeams}-${spec.maxTeams} teams`;
    hint.style.color = '';
  }
}

function renderTeams(t, teams) {
  roster = teams;

  const wrap = document.getElementById('teamBadges');
  wrap.textContent = '';
  const full = t.teamCount >= t.maxTeams;
  wrap.appendChild(badge(`${t.teamCount} / ${t.maxTeams} teams`, full ? 'full' : 'count'));

  // เต็มแล้วก็ปิดปุ่มไปเลย พร้อมบอกเหตุผลที่ tooltip
  // เซิร์ฟเวอร์ก็ปฏิเสธอยู่แล้ว แต่ปุ่มที่กดไม่ได้ชัดกว่าปุ่มที่กดแล้วขึ้น error
  const addBtn = /** @type {HTMLButtonElement} */ (document.getElementById('addTeamBtn'));
  addBtn.disabled = full;
  addBtn.style.opacity = full ? '0.45' : '';
  addBtn.style.cursor = full ? 'not-allowed' : '';
  addBtn.title = full ? `This tournament is full (${t.maxTeams} teams max)` : '';

  const body = document.getElementById('teamsBody');
  body.textContent = '';

  if (teams.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = `No teams yet. This format holds up to ${t.maxTeams} teams.`;
    body.appendChild(empty);
    return;
  }

  teams.forEach((team) => body.appendChild(teamCard(team)));
}

// แถวแบบแน่น (.compact) ชื่อกับ badge อยู่บรรทัดเดียวกัน
// โครงเหมือนการ์ดในหน้าทะเบียนทีมทุกอย่าง ต่างกันแค่ CSS
function teamCard(team) {
  const card = document.createElement('div');
  card.className = 'team compact';

  const row = document.createElement('div');
  row.className = 'team-row';

  const id = document.createElement('div');
  id.className = 'team-id';
  const name = document.createElement('div');
  name.className = 'team-name';
  name.textContent = team.name;
  const sub = document.createElement('div');
  sub.className = 'team-sub';
  if (team.tag) sub.appendChild(badge(team.tag));
  sub.appendChild(badge(`Seed ${team.seed}`));
  const named = team.players.filter((p) => p.name).length;
  sub.appendChild(badge(`${named} / ${team.players.length} players`));
  id.append(name, sub);

  const actions = document.createElement('div');
  actions.className = 'team-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'tlink';
  editBtn.textContent = 'EDIT';

  // โปรไฟล์ทีมคือที่ที่เห็นประวัติข้ามทัวร์นาเมนต์ ซึ่งหน้านี้ไม่มีทางแสดงได้
  // หน้านี้เห็นแค่ทัวร์นาเมนต์เดียว
  const profileLink = document.createElement('a');
  profileLink.className = 'tlink';
  profileLink.textContent = 'PROFILE';
  profileLink.href = withToken(`/teams/${encodeURIComponent(team.id)}`);
  profileLink.title = 'Roster, record and match history across every tournament';

  // กากบาทแทนคำว่า REMOVE เพื่อประหยัดที่ในแถวแบบแน่น
  // ความหมายเต็มอยู่ที่ title กับ aria-label และยังมีกล่องยืนยันคั่นก่อนลบจริง
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'tlink danger icon';
  removeBtn.textContent = '✕';
  removeBtn.title = 'Take this team out of the tournament. The team stays in the registry.';
  removeBtn.setAttribute('aria-label', `Remove ${team.name} from this tournament`);
  removeBtn.addEventListener('click', () => removeFromTournament(team));

  actions.append(editBtn, profileLink, removeBtn);
  row.append(logoImage(team), id, actions);
  card.appendChild(row);

  const editor = document.createElement('div');
  editor.className = 'team-edit';
  editor.hidden = true;
  card.appendChild(editor);

  editBtn.addEventListener('click', () => {
    editor.hidden = !editor.hidden;
    editBtn.textContent = editor.hidden ? 'EDIT' : 'CLOSE';
    if (!editor.hidden && editor.childElementCount === 0) buildEditor(editor, team);
  });

  return card;
}

// ตัวแก้ไขทีม สร้างตอนกดเปิดครั้งแรกเท่านั้น
// ทัวร์นาเมนต์ที่มี 128 ทีมจะได้ไม่ต้องสร้าง input 128 x 5 ช่องทิ้งไว้ตั้งแต่ต้น
function buildEditor(editor, team) {
  const nameRow = document.createElement('div');
  nameRow.className = 'frow';

  const nameFld = document.createElement('div');
  nameFld.className = 'fld';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Team name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 24;
  nameInput.value = team.name;
  nameFld.append(nameLabel, nameInput);

  const tagFld = document.createElement('div');
  tagFld.className = 'fld';
  tagFld.style.flex = '0 0 130px';
  const tagLabel = document.createElement('label');
  tagLabel.textContent = 'Tag';
  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.maxLength = 6;
  tagInput.value = team.tag || '';
  tagFld.append(tagLabel, tagInput);

  const seedFld = document.createElement('div');
  seedFld.className = 'fld';
  seedFld.style.flex = '0 0 110px';
  const seedLabel = document.createElement('label');
  seedLabel.textContent = 'Seed';
  const seedInput = document.createElement('input');
  seedInput.type = 'number';
  seedInput.min = '0';
  seedInput.max = '9999';
  seedInput.value = String(team.seed ?? 0);
  seedFld.append(seedLabel, seedInput);

  nameRow.append(nameFld, tagFld, seedFld);

  const playersWrap = document.createElement('div');
  const playersLabel = document.createElement('label');
  playersLabel.className = 'section-title';
  playersLabel.textContent = 'Players';
  playersLabel.style.display = 'block';
  playersLabel.style.marginBottom = '8px';
  playersWrap.appendChild(playersLabel);

  // ช่องผู้เล่นชุดเดียวกับที่ใช้ในฟอร์มสร้างทีมใหม่
  const playerRows = document.createElement('div');
  playersWrap.appendChild(playerRows);
  const players = buildPlayerRows(playerRows, team.players, `captain-${team.id}`);

  // LOGO ---------------------------------------------------------------
  const logoRow = document.createElement('div');
  logoRow.className = 'frow';
  logoRow.style.alignItems = 'center';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/png,image/jpeg,image/webp';
  fileInput.hidden = true;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) uploadLogo(team, file);
    fileInput.value = '';
  });

  const uploadBtn = document.createElement('button');
  uploadBtn.type = 'button';
  uploadBtn.className = 'tlink';
  uploadBtn.textContent = 'UPLOAD LOGO';
  uploadBtn.addEventListener('click', () => fileInput.click());

  const clearLogoBtn = document.createElement('button');
  clearLogoBtn.type = 'button';
  clearLogoBtn.className = 'tlink';
  clearLogoBtn.textContent = 'CLEAR LOGO';
  clearLogoBtn.addEventListener('click', () => clearLogo(team));

  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.style.color = 'var(--muted)';
  hint.textContent = 'PNG, JPG or WEBP, up to 4 MB';

  logoRow.append(fileInput, uploadBtn, clearLogoBtn, hint);

  // SAVE / DELETE ------------------------------------------------------
  const saveRow = document.createElement('div');
  saveRow.className = 'frow';
  saveRow.style.marginBottom = '0';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'tlink primary';
  saveBtn.textContent = 'SAVE TEAM';
  saveBtn.addEventListener('click', () => saveTeam(team, {
    name: nameInput.value,
    tag: tagInput.value,
    seed: Number(seedInput.value),
    players: players.read()
  }));

  const spacer = document.createElement('div');
  spacer.className = 'spacer';
  spacer.style.marginLeft = 'auto';

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'tlink danger';
  deleteBtn.textContent = 'DELETE FROM REGISTRY';
  deleteBtn.title = 'Remove the team everywhere, including other tournaments';
  deleteBtn.addEventListener('click', () => deleteTeam(team));

  saveRow.append(saveBtn, spacer, deleteBtn);

  editor.append(nameRow, playersWrap, logoRow, saveRow);
}

function renderSources() {
  const wrap = document.getElementById('sources');
  wrap.textContent = '';

  SOURCES.forEach((source) => {
    // บาง source ต้องรู้ว่าเป็นทัวร์นาเมนต์ไหน ไม่ใช่ URL ตายตัวเหมือนอันอื่น
    const path = source.perTournament
      ? `${source.path}?tournament=${encodeURIComponent(tournamentId)}`
      : source.path;
    const url = absoluteUrl(path);

    const row = document.createElement('div');
    row.className = 'src';

    const name = document.createElement('div');
    name.className = 'src-name';
    name.textContent = source.name;

    const urlEl = document.createElement('div');
    urlEl.className = 'src-url';
    urlEl.textContent = url;
    urlEl.title = `${url}  (${source.size})`;

    const actions = document.createElement('div');
    actions.className = 'src-actions';

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'tlink';
    copy.textContent = 'COPY URL';
    copy.addEventListener('click', () => copyUrl(url));

    const open = document.createElement('a');
    open.className = 'tlink';
    open.href = withToken(path);
    open.target = '_blank';
    open.rel = 'noopener';
    open.textContent = 'OPEN';

    actions.append(copy, open);
    row.append(name, urlEl, actions);
    wrap.appendChild(row);
  });
}

async function copyUrl(url) {
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
  } catch {
    showToast('Copy failed', 'red');
  }
}

function showMissing(message) {
  document.getElementById('headName').textContent = 'Tournament not found';
  const body = document.createElement('div');
  body.className = 'empty';
  body.textContent = message;
  document.querySelector('.wrap').appendChild(body);
}

// ACTIONS ------------------------------------------------------------

async function save() {
  try {
    const { tournament } = await fetchJson(`/api/tournaments/${encodeURIComponent(tournamentId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: /** @type {HTMLInputElement} */ (document.getElementById('fName')).value,
        format: /** @type {HTMLInputElement} */ (document.getElementById('fFormat')).value,
        bestOf: Number(/** @type {HTMLInputElement} */ (document.getElementById('fBestOf')).value),
        status: /** @type {HTMLInputElement} */ (document.getElementById('fStatus')).value,
        note: /** @type {HTMLInputElement} */ (document.getElementById('fNote')).value
      })
    });
    current = tournament;
    renderHead(tournament);
    renderForm(tournament);
    showToast('Saved', 'green');
  } catch (error) {
    // เซิร์ฟเวอร์ปฏิเสธเมื่อรูปแบบใหม่รับทีมได้น้อยกว่าที่มีอยู่
    // ไม่ตัดทีมทิ้งให้เอง ผู้ใช้ต้องเอาทีมออกเองก่อน
    showToast(error.message || 'Could not save', 'red');
  }
}

async function remove() {
  const name = current?.name || 'this tournament';
  if (!window.confirm(`Delete "${name}"?\n\nThe tournament and its team list are removed. Teams themselves stay in the registry.`)) {
    return;
  }
  try {
    await fetchJson(`/api/tournaments/${encodeURIComponent(tournamentId)}`, { method: 'DELETE' });
    window.location.href = '/';
  } catch (error) {
    showToast(error.message || 'Could not delete', 'red');
  }
}

// TEAM ACTIONS -------------------------------------------------------

// ผลลัพธ์จาก endpoint ของ roster ส่ง tournament กับ teams กลับมาพร้อมกัน
// จะได้ไม่ต้องยิงซ้ำเพื่ออัปเดตตัวเลข x / y teams
function applyRoster(data) {
  if (data.tournament) {
    current = data.tournament;
    renderHead(current);
    renderFormatHint();
  }
  renderTeams(current, data.teams || []);
}

async function refreshRegistry() {
  try {
    registry = (await fetchJson('/api/teams')).teams || [];
  } catch (error) {
    showToast(error.message || 'Could not load the team registry', 'red');
    registry = [];
  }
  renderPicker();
}

// เอาเฉพาะทีมที่ยังไม่ได้อยู่ในทัวร์นาเมนต์นี้
function renderPicker() {
  const picker = /** @type {HTMLSelectElement} */ (document.getElementById('pickTeam'));
  const inRoster = new Set(roster.map((t) => t.id));
  const available = registry.filter((t) => !inRoster.has(t.id));

  picker.textContent = '';
  if (available.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = registry.length === 0
      ? 'No teams in the registry yet'
      : 'Every registered team is already in';
    picker.appendChild(opt);
    picker.disabled = true;
    /** @type {HTMLButtonElement} */ (document.getElementById('addExistingBtn')).disabled = true;
    return;
  }

  picker.disabled = false;
  /** @type {HTMLButtonElement} */ (document.getElementById('addExistingBtn')).disabled = false;
  available.forEach((team) => {
    const opt = document.createElement('option');
    opt.value = team.id;
    opt.textContent = team.tag ? `${team.name} (${team.tag})` : team.name;
    picker.appendChild(opt);
  });
}

async function addTeamToTournament(teamId) {
  const data = await fetchJson(`/api/tournaments/${encodeURIComponent(tournamentId)}/teams`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teamId })
  });
  applyRoster(data);
  renderPicker();
}

async function addExisting() {
  const teamId = /** @type {HTMLInputElement} */ (document.getElementById('pickTeam')).value;
  if (!teamId) return;
  try {
    await addTeamToTournament(teamId);
    showToast('Team added', 'green');
  } catch (error) {
    showToast(error.message || 'Could not add the team', 'red');
  }
}

// สร้างทีม + ผู้เล่น + โลโก้ ในการกดครั้งเดียว
//
// โลโก้ต้องอัปโหลดหลังสร้างเสมอ เพราะชื่อไฟล์มาจาก id ที่เซิร์ฟเวอร์เพิ่งออกให้
// ฝั่งผู้ใช้ไม่ต้องรู้เรื่องนี้ เลือกไฟล์ไว้ก่อนแล้วกดปุ่มเดียวจบ
async function createAndAdd() {
  const nameInput = /** @type {HTMLInputElement} */ (document.getElementById('newTeamName'));
  const tagInput = /** @type {HTMLInputElement} */ (document.getElementById('newTeamTag'));
  const name = nameInput.value.trim();
  if (!name) {
    showToast('Team name is required', 'red');
    nameInput.focus();
    return;
  }

  let team;
  try {
    ({ team } = await fetchJson('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        tag: tagInput.value,
        players: newTeamPlayers ? newTeamPlayers.read() : []
      })
    }));
  } catch (error) {
    showToast(error.message || 'Could not create the team', 'red');
    return;
  }

  // ทีมมีตัวตนแล้ว ตั้งแต่จุดนี้ไปพลาดตรงไหนก็ไม่ลบทีมทิ้ง
  // ผู้ใช้ตั้งใจสร้างมันจริงๆ แค่ขั้นตอนถัดไปไม่สำเร็จ
  if (pendingLogo) {
    try {
      await sendLogo(team.id, pendingLogo);
    } catch (error) {
      showToast(`${team.name} created, but the logo failed: ${error.message}`, 'red');
    }
  }

  try {
    await refreshRegistry();
    await addTeamToTournament(team.id);
    resetNewTeamForm();
    nameInput.focus();
    showToast(`${team.name} added`, 'green');
  } catch (error) {
    // เช่นทัวร์นาเมนต์เต็ม ทีมยังอยู่ในทะเบียน หยิบไปใส่ทัวร์นาเมนต์อื่นได้
    await refreshRegistry();
    showToast(`${team.name} is in the registry, but ${(error.message || 'could not be added').toLowerCase()}`, 'red');
  }
}

function resetNewTeamForm() {
  /** @type {HTMLInputElement} */ (document.getElementById('newTeamName')).value = '';
  /** @type {HTMLInputElement} */ (document.getElementById('newTeamTag')).value = '';
  if (newTeamPlayers) newTeamPlayers.clear();
  setPendingLogo(null);
}

function setPendingLogo(file) {
  pendingLogo = file;
  const btn = document.getElementById('newTeamLogoBtn');
  if (!btn) return;
  btn.textContent = file ? `LOGO: ${file.name.slice(0, 14)}` : 'CHOOSE LOGO';
  btn.classList.toggle('primary', Boolean(file));
}

async function removeFromTournament(team) {
  if (!window.confirm(`Take "${team.name}" out of this tournament?\n\nThe team stays in the registry.`)) return;
  try {
    const data = await fetchJson(
      `/api/tournaments/${encodeURIComponent(tournamentId)}/teams/${encodeURIComponent(team.id)}`,
      { method: 'DELETE' }
    );
    applyRoster(data);
    renderPicker();
    showToast('Removed from tournament', 'blue');
  } catch (error) {
    showToast(error.message || 'Could not remove the team', 'red');
  }
}

async function saveTeam(team, values) {
  try {
    await fetchJson(`/api/teams/${encodeURIComponent(team.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: values.name, tag: values.tag, players: values.players })
    });
    if (values.seed !== team.seed) {
      await fetchJson(
        `/api/tournaments/${encodeURIComponent(tournamentId)}/teams/${encodeURIComponent(team.id)}/seed`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ seed: values.seed })
        }
      );
    }
    await reloadTeams();
    await refreshRegistry();
    showToast('Team saved', 'green');
  } catch (error) {
    showToast(error.message || 'Could not save the team', 'red');
  }
}

async function deleteTeam(team) {
  if (!window.confirm(
    `Delete "${team.name}" from the registry?\n\n` +
    'It is removed from every tournament it entered, not just this one.'
  )) return;

  try {
    await fetchJson(`/api/teams/${encodeURIComponent(team.id)}`, { method: 'DELETE' });
    await reloadTeams();
    await refreshRegistry();
    showToast('Team deleted', 'blue');
  } catch (error) {
    showToast(error.message || 'Could not delete the team', 'red');
  }
}

async function uploadLogo(team, file) {
  try {
    await sendLogo(team.id, file);
    await reloadTeams();
    await refreshRegistry();
    showToast('Logo uploaded', 'green');
  } catch (error) {
    showToast(error.message || 'Upload failed', 'red');
  }
}

async function clearLogo(team) {
  try {
    await fetchJson(`/api/teams/${encodeURIComponent(team.id)}/logo`, { method: 'DELETE' });
    await reloadTeams();
    await refreshRegistry();
    showToast('Logo cleared', 'blue');
  } catch (error) {
    showToast(error.message || 'Could not clear the logo', 'red');
  }
}

// FOLD ----------------------------------------------------------------
//
// หัวข้อทีมพับเก็บได้ ทัวร์นาเมนต์เต็ม 128 ทีมดันหัวข้อ Match session
// กับ OBS ลงไปอยู่ใต้สุดของหน้า พับแล้วสองหัวข้อนั้นกลับมาอยู่ในจอเดียว
//
// จำสถานะไว้ เพราะการจัดทีมทำครั้งเดียวตอนต้น แต่หน้านี้ถูกเปิดซ้ำทั้งงาน
// ต้องมาพับใหม่ทุกครั้งที่เปิดคือสิ่งที่น่ารำคาญกว่าการไม่มีปุ่มพับเสียอีก
const TEAMS_FOLD_KEY = 'rovTournamentTeamsFolded';

function readFoldPreference() {
  // localStorage โยน error ได้ในโหมดส่วนตัวบางเบราว์เซอร์ ค่าเริ่มต้นคือกางไว้
  try {
    return localStorage.getItem(TEAMS_FOLD_KEY) === '1';
  } catch {
    return false;
  }
}

function setTeamsFolded(folded, remember = true) {
  const fold = document.getElementById('teamsFold');
  const button = document.getElementById('teamsToggle');
  if (!fold || !button) return;

  fold.hidden = folded;
  button.textContent = folded ? '▸' : '▾';
  button.title = folded ? 'Show the team list' : 'Hide the team list';
  button.setAttribute('aria-expanded', folded ? 'false' : 'true');

  if (!remember) return;
  try {
    localStorage.setItem(TEAMS_FOLD_KEY, folded ? '1' : '0');
  } catch {
    /* จำไม่ได้ก็ไม่เป็นไร ปุ่มยังใช้ได้ในหน้านี้ */
  }
}

function teamsAreFolded() {
  return document.getElementById('teamsFold')?.hidden === true;
}

// MATCH SESSION ------------------------------------------------------
//
// การจับคู่ การกรอกผล และการเอาแมตช์ขึ้นจอ ย้ายไปหน้า /tournament/:id/bracket
// หน้านี้เหลือไว้แค่ "ถึงไหนแล้ว" กับทางเข้า
//
// เหตุผลที่ยังโหลดตารางแข่งมาทั้งชุด ทั้งที่ใช้แค่ตัวเลข:
// endpoint เดียวกันนี้ถูกเรียกอยู่แล้วตอนอยู่หน้านี้ และการนับต้องแยกบายออก
// ซึ่งเซิร์ฟเวอร์ไม่ได้ส่งตัวเลขสรุปมาให้ การนับเองจึงถูกกว่าการเพิ่ม endpoint
function renderMatchSummary(list) {
  const badges = document.getElementById('matchBadges');
  badges.textContent = '';

  const played = list.filter((m) => m.status === 'complete' && !m.isBye).length;
  const total = list.filter((m) => !m.isBye).length;
  if (total > 0) {
    badges.appendChild(badge(`${played} / ${total} played`, played === total ? 'active' : 'count'));
  }

  const link = document.getElementById('bracketLink');
  link.title = list.length === 0
    ? 'Nothing drawn yet - draw the bracket in the match session'
    : 'Run the matches: draw, record scores, put a match on air';

  const body = document.getElementById('matchesBody');
  body.textContent = '';

  const note = document.createElement('div');
  note.className = 'empty';
  if (list.length === 0) {
    note.textContent = current && current.teamCount < 2
      ? 'Add at least two teams, then open the match session to draw the bracket.'
      : 'No bracket drawn yet. Open the match session to draw it.';
  } else {
    note.textContent = `${total} ${total === 1 ? 'match' : 'matches'} drawn. ` +
      'Scores, the bracket and putting a match on air all live in the match session.';
  }
  body.appendChild(note);
}

async function loadMatchSummary() {
  try {
    const data = await fetchJson(`/api/tournaments/${encodeURIComponent(tournamentId)}/matches`);
    renderMatchSummary(data.matches || []);
  } catch (error) {
    showToast(error.message || 'Could not load the match summary', 'red');
  }
}

async function reloadTeams() {
  const data = await fetchJson(`/api/tournaments/${encodeURIComponent(tournamentId)}`);
  current = data.tournament;
  renderHead(current);
  renderTeams(current, data.teams || []);
}

async function load() {
  const data = await fetchJson(`/api/tournaments/${encodeURIComponent(tournamentId)}`);
  current = data.tournament;
  renderHead(current);
  renderForm(current);
  renderTeams(current, data.teams || []);
  renderSources();
  await refreshRegistry();
  await loadMatchSummary();

  ['detailSection', 'teamsSection', 'matchesSection', 'obsSection'].forEach((id) => {
    document.getElementById(id).hidden = false;
  });
}

function renderFoot() {
  document.getElementById('foot').textContent =
    'Add the overlay and result URLs as Browser sources in OBS. ' +
    'Set the source size to match the overlay size chosen in the Control Panel, ' +
    'and tick "Shutdown source when not visible" off so the draft keeps running.';
}

// BOOT ---------------------------------------------------------------
//
// ผูก event ผ่าน on() (จาก team-ui.js) เสมอ
// อย่าเรียก getElementById(...).addEventListener ตรงๆ — เหตุผลอยู่ในไฟล์นั้น

function boot() {
  on('saveBtn', 'click', save);
  on('deleteBtn', 'click', remove);
  on('revertBtn', 'click', () => {
    if (current) {
      renderForm(current);
      showToast('Reverted to saved values', 'blue');
    }
  });
  on('fFormat', 'change', renderFormatHint);

  // ช่องผู้เล่นของฟอร์มสร้างทีมใหม่ สร้างครั้งเดียวตอนเปิดหน้า
  const playersBox = document.getElementById('newTeamPlayers');
  if (playersBox) newTeamPlayers = buildPlayerRows(playersBox, [], 'captain-new-team');

  // ตัวเลือกไฟล์โลโก้ ซ่อนไว้ ใช้ปุ่มที่จัดสไตล์แล้วกดแทน
  const logoPicker = hiddenFilePicker(setPendingLogo);
  on('newTeamLogoBtn', 'click', () => logoPicker.click());
  on('clearNewTeamBtn', 'click', () => {
    resetNewTeamForm();
    showToast('Form cleared', 'blue');
  });

  setTeamsFolded(readFoldPreference(), false);
  on('teamsToggle', 'click', () => setTeamsFolded(!teamsAreFolded()));

  on('addTeamBtn', 'click', () => {
    const panel = document.getElementById('addPanel');
    if (!panel) return;
    // ฟอร์มเพิ่มทีมอยู่ในส่วนที่พับ กดเพิ่มทีมตอนพับอยู่จึงต้องกางให้ก่อน
    // ไม่งั้นปุ่มจะดูเหมือนเสีย ทั้งที่ฟอร์มเปิดแล้วแต่ซ่อนอยู่
    setTeamsFolded(false);
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      renderPicker();
      document.getElementById('newTeamName')?.focus();
    }
  });
  on('closeAddBtn', 'click', () => {
    const panel = document.getElementById('addPanel');
    if (panel) panel.hidden = true;
  });

  const bracketLink = document.getElementById('bracketLink');
  if (bracketLink) {
    /** @type {HTMLAnchorElement} */ (bracketLink).href = withToken(`/tournament/${encodeURIComponent(tournamentId)}/bracket`);
  }

  on('addExistingBtn', 'click', addExisting);
  on('createTeamBtn', 'click', createAndAdd);
  on('newTeamName', 'keydown', (event) => {
    if (event.key === 'Enter') createAndAdd();
  });

  // ข้อมูลหน้านี้ถูกแก้จากที่อื่นได้ตลอด: หน้าจัดการแข่งจับคู่ใหม่ โปรไฟล์ทีมแก้ชื่อ
  // หรือคนคุมอีกคนเปิดอีกจออยู่ เดิมหน้านี้อ่านครั้งเดียวตอนเปิดแล้วค้างอยู่อย่างนั้น
  //
  // กฎเดียวที่ห้ามพลาด: ห้ามวาดทับส่วนที่กำลังถูกกรอก
  // ฟอร์มรายละเอียดกับตัวแก้ทีมมีคนพิมพ์ค้างไว้ได้ ถ้าวาดใหม่ทับ ที่พิมพ์หายหมด
  onDataChange((change) => {
    const mine = !change.tournamentId || change.tournamentId === tournamentId;

    if (change.topic === 'matches' && mine) loadMatchSummary();

    if ((change.topic === 'roster' && mine) || change.topic === 'teams') {
      deferWhileEditing(document.getElementById('teamsFold'), () => {
        reloadTeams().then(refreshRegistry).catch(() => { /* สัญญาณรอบหน้าจะพามาเอง */ });
      });
    }

    if (change.topic === 'tournaments' && mine) {
      deferWhileEditing(document.getElementById('detailSection'), () => {
        reloadTeams().catch(() => { /* สัญญาณรอบหน้าจะพามาเอง */ });
      });
    }
  });

  socket.on('connect_error', (error) => showToast(error.message || 'Connection error', 'red'));
  renderFoot();
}

(async () => {
  try {
    boot();
  } catch (error) {
    // ผูก event ไม่สำเร็จ ยังพยายามโหลดข้อมูลต่อ แต่ต้องบอกให้รู้
    console.error('tournament.js boot failed', error);
    showToast('Some controls on this page failed to start - try a hard reload', 'red');
  }

  if (!tournamentId) {
    showMissing('No tournament id in the address.');
    return;
  }
  try {
    options = await fetchJson('/api/tournament-options');
    await load();
  } catch (error) {
    showMissing(error.message || 'Could not load this tournament.');
  }
})();
