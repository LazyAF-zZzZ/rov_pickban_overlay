// หน้าทะเบียนทีมกลาง
//
// ต่างจากรายชื่อทีมในหน้าทัวร์นาเมนต์: หน้านั้นคือ "ทีมที่ลงทัวร์นาเมนต์นี้"
// หน้านี้คือทีมทั้งหมดที่เคยสร้างไว้ ไม่ผูกกับทัวร์นาเมนต์ไหนเลย
// ลบทีมจากที่นี่คือลบออกจากทุกทัวร์นาเมนต์ที่เคยลง ไม่ใช่แค่เอาออกจากรายการเดียว
//
// ประกอบด้วย textContent ทั้งหมด ไม่มีการต่อ innerHTML
// ชื่อทีมกับชื่อผู้เล่นเป็นข้อความที่ผู้ใช้พิมพ์เอง

const { socket, fetchJson, withToken, showToast, onDataChange } = window.RovClient;
const { badge, buildPlayerRows, logoImage, sendLogo, hiddenFilePicker, on } = window.RovTeamUI;

let teams = [];
let summaries = new Map();  // teamId -> { tournaments, won, lost }
let newTeamPlayers = null;
let pendingLogo = null;
let filter = '';

// RENDER -------------------------------------------------------------

function matchesFilter(team) {
  if (!filter) return true;
  const needle = filter.toLowerCase();
  return team.name.toLowerCase().includes(needle) || team.tag.toLowerCase().includes(needle);
}

function renderCount(shown) {
  const wrap = document.getElementById('countBadges');
  wrap.textContent = '';
  wrap.appendChild(badge(`${teams.length} ${teams.length === 1 ? 'team' : 'teams'}`, 'count'));
  // บอกด้วยว่าตัวกรองซ่อนไปกี่ทีม ไม่งั้นคนลืมล้างช่องค้นหาจะนึกว่าทีมหาย
  if (filter && shown !== teams.length) {
    wrap.appendChild(badge(`${shown} shown`));
  }
}

function teamCard(team) {
  const card = document.createElement('div');
  card.className = 'team';

  const row = document.createElement('div');
  row.className = 'team-row';

  const id = document.createElement('div');
  id.className = 'team-id';

  // ชื่อทีมเป็นลิงก์ไปโปรไฟล์ เพราะเป็นสิ่งที่คนกดโดยสัญชาตญาณอยู่แล้ว
  const name = document.createElement('a');
  name.className = 'team-name link';
  name.textContent = team.name;
  name.href = withToken(`/teams/${encodeURIComponent(team.id)}`);

  const sub = document.createElement('div');
  sub.className = 'team-sub';
  if (team.tag) sub.appendChild(badge(team.tag));

  const named = team.players.filter((p) => p.name).length;
  sub.appendChild(badge(`${named} / ${team.players.length} players`));

  const stat = summaries.get(team.id);
  if (stat?.tournaments) {
    sub.appendChild(badge(`${stat.tournaments} ${stat.tournaments === 1 ? 'tournament' : 'tournaments'}`, 'count'));
  }
  if (stat && (stat.won || stat.lost)) {
    sub.appendChild(badge(`${stat.won} W - ${stat.lost} L`, stat.won >= stat.lost ? 'active' : ''));
  }

  id.append(name, sub);

  const actions = document.createElement('div');
  actions.className = 'team-actions';

  const profile = document.createElement('a');
  profile.className = 'tlink';
  profile.textContent = t('PROFILE');
  profile.href = withToken(`/teams/${encodeURIComponent(team.id)}`);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'tlink danger';
  removeBtn.textContent = t('DELETE');
  removeBtn.title = 'Remove the team everywhere, including every tournament it entered';
  removeBtn.addEventListener('click', () => deleteTeam(team));

  actions.append(profile, removeBtn);
  row.append(logoImage(team), id, actions);
  card.appendChild(row);

  return card;
}

function render() {
  const body = document.getElementById('teamsList');
  body.textContent = '';

  const shown = teams.filter(matchesFilter);
  renderCount(shown.length);

  if (shown.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = teams.length === 0
      ? 'No teams yet. Create one here, or from inside a tournament.'
      : `Nothing matches "${filter}".`;
    body.appendChild(empty);
    return;
  }

  shown.forEach((team) => body.appendChild(teamCard(team)));
}

// ACTIONS ------------------------------------------------------------

async function load() {
  // สถิติล้มไม่ควรทำให้รายชื่อทีมไม่ขึ้น รายชื่อคือเนื้อหาหลักของหน้านี้
  const [teamData, summaryData] = await Promise.all([
    fetchJson('/api/teams'),
    fetchJson('/api/team-summaries').catch(() => ({ summaries: [] }))
  ]);

  teams = teamData.teams || [];
  summaries = new Map((summaryData.summaries || []).map((s) => [s.teamId, s]));
  render();
}

async function reload() {
  try {
    await load();
  } catch (error) {
    showToast(error.message || 'Could not reload the registry', 'red');
  }
}

function setPendingLogo(file) {
  pendingLogo = file;
  const btn = document.getElementById('newTeamLogoBtn');
  if (!btn) return;
  btn.textContent = file ? `LOGO: ${file.name.slice(0, 14)}` : 'CHOOSE LOGO';
  btn.classList.toggle('primary', Boolean(file));
}

function resetForm() {
  /** @type {HTMLInputElement} */ (document.getElementById('newTeamName')).value = '';
  /** @type {HTMLInputElement} */ (document.getElementById('newTeamTag')).value = '';
  if (newTeamPlayers) newTeamPlayers.clear();
  setPendingLogo(null);
}

// สร้างทีม + ผู้เล่น + โลโก้ ในการกดครั้งเดียว
// โลโก้ต้องอัปโหลดหลังสร้างเสมอ เพราะชื่อไฟล์มาจาก id ที่เซิร์ฟเวอร์เพิ่งออกให้
async function createTeam() {
  const nameInput = /** @type {HTMLInputElement} */ (document.getElementById('newTeamName'));
  const name = nameInput.value.trim();
  if (!name) {
    showToast(t('Team name is required'), 'red');
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
        tag: /** @type {HTMLInputElement} */ (document.getElementById('newTeamTag')).value,
        players: newTeamPlayers ? newTeamPlayers.read() : []
      })
    }));
  } catch (error) {
    showToast(error.message || 'Could not create the team', 'red');
    return;
  }

  // ทีมมีตัวตนแล้ว ตั้งแต่จุดนี้ไปพลาดตรงไหนก็ไม่ลบทีมทิ้ง
  if (pendingLogo) {
    try {
      await sendLogo(team.id, pendingLogo);
    } catch (error) {
      showToast(`${team.name} created, but the logo failed: ${error.message}`, 'red');
    }
  }

  resetForm();
  nameInput.focus();
  await reload();
  showToast(`${team.name} created`, 'green');
}

async function deleteTeam(team) {
  const stat = summaries.get(team.id);
  const entered = stat?.tournaments
    ? `\n\nIt is in ${stat.tournaments} tournament${stat.tournaments === 1 ? '' : 's'}, and will be dropped from all of them.`
    : '';
  if (!window.confirm(`Delete "${team.name}" from the registry?${entered}`)) return;

  try {
    await fetchJson(`/api/teams/${encodeURIComponent(team.id)}`, { method: 'DELETE' });
    await reload();
    showToast('Team deleted', 'blue');
  } catch (error) {
    showToast(error.message || 'Could not delete the team', 'red');
  }
}

// BOOT ---------------------------------------------------------------

function boot() {
  const playersBox = document.getElementById('newTeamPlayers');
  if (playersBox) newTeamPlayers = buildPlayerRows(playersBox, [], 'captain-new-team');

  const logoPicker = hiddenFilePicker(setPendingLogo);
  on('newTeamLogoBtn', 'click', () => logoPicker.click());

  on('newBtn', 'click', () => {
    const panel = document.getElementById('createPanel');
    if (!panel) return;
    panel.hidden = !panel.hidden;
    if (!panel.hidden) document.getElementById('newTeamName')?.focus();
  });
  on('closeBtn', 'click', () => {
    const panel = document.getElementById('createPanel');
    if (panel) panel.hidden = true;
  });
  on('clearBtn', 'click', () => {
    resetForm();
    showToast(t('Form cleared'), 'blue');
  });

  on('createBtn', 'click', createTeam);
  on('newTeamName', 'keydown', (event) => {
    if (event.key === 'Enter') createTeam();
  });

  on('searchBox', 'input', (event) => {
    filter = /** @type {HTMLInputElement} */ (event.target).value.trim();
    render();
  });

  socket.on('connect_error', (error) => showToast(error.message || 'Connection error', 'red'));

  // ทะเบียนถูกแก้จากหน้าอื่นได้ (โปรไฟล์ทีม หรือฟอร์มสร้างทีมในหน้าทัวร์นาเมนต์)
  // roster เปลี่ยน = ตัวเลขจำนวนทัวร์นาเมนต์ในแต่ละแถวเปลี่ยนตาม
  //
  // ฟอร์มสร้างทีมอยู่คนละก้อน DOM กับรายชื่อ การวาดรายชื่อใหม่จึงไม่กระทบสิ่งที่กำลังกรอก
  onDataChange((change) => {
    if (change.topic === 'teams' || change.topic === 'roster' || change.topic === 'matches') {
      reload();
    }
  });

  document.getElementById('foot').textContent =
    'Teams here are shared by every tournament. Adding a team to a tournament does not copy it - ' +
    'editing the roster on its profile changes it everywhere it plays from then on. ' +
    'Matches already played keep the roster they were played with.';
}

(async () => {
  try {
    boot();
  } catch (error) {
    console.error('teams.js boot failed', error);
    showToast(t('Some controls on this page failed to start - try a hard reload'), 'red');
  }

  try {
    await load();
  } catch (error) {
    showToast(error.message || 'Could not load the team registry', 'red');
  }
})();
