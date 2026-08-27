// โปรไฟล์ทีมหนึ่งทีม พร้อมประวัติการแข่งข้ามทุกทัวร์นาเมนต์
//
// เสิร์ฟที่ /teams/:id หน้าเดียวใช้กับทุก id อ่าน id จาก URL เอง
//
// หน้านี้คือที่ที่แก้ทีมได้จริงจัง ส่วนตัวแก้ย่อในหน้าทัวร์นาเมนต์ไว้แก้เร็วๆ ตอนจัดสาย
// สิ่งที่หน้านั้นทำไม่ได้คือประวัติ เพราะหน้านั้นเห็นแค่ทัวร์นาเมนต์เดียว
//
// สำคัญ: การแก้รายชื่อผู้เล่นที่นี่ไม่ย้อนไปแก้ประวัติเก่า
// เกมที่เล่นไปแล้วเก็บสำเนาแช่แข็งของทีม ณ ตอนนั้นไว้ต่างหาก (แผน §4)
// ประวัติจึงยังบอกว่า "ใครลงเล่นจริง" ไม่ใช่ "ตอนนี้ทีมมีใคร"

const { socket, fetchJson, withToken, showToast } = window.RovClient;
const { badge, buildPlayerRows, logoImage, sendLogo, hiddenFilePicker, on } = window.RovTeamUI;

// /teams/t3a1b2c3  ->  t3a1b2c3
const teamId = decodeURIComponent(window.location.pathname.split('/').filter(Boolean)[1] || '');

let team = null;        // ทีมที่โหลดมาล่าสุด ใช้ตอนกด REVERT
let playerRows = null;
let formats = {};       // id -> label จาก /api/tournament-options

// HELPERS ------------------------------------------------------------

// ชื่อรอบให้คนอ่าน ไม่ใช่เลขสายดิบๆ
// 'main' คือสายหลัก (และเป็นสายชนะเมื่อแข่งแบบแพ้สองครั้งคัดออก)
function roundLabel(match) {
  if (match.bracket === 'grand') {
    return match.round === 2 ? 'Grand final (reset)' : 'Grand final';
  }
  if (match.bracket === 'losers') return `Losers round ${match.round}`;
  if (match.bracket === 'main') return `Round ${match.round}`;
  return `Group ${match.bracket} - round ${match.round}`;
}

function outcomeBadge(match) {
  if (match.isBye) return badge('Bye');
  if (match.outcome === 'win') return badge('Win', 'active');
  if (match.outcome === 'loss') return badge('Loss', 'loss');
  if (match.status === 'live') return badge('In progress', 'count');
  return badge('Not played');
}

// RENDER -------------------------------------------------------------

function renderHead(t, record) {
  document.title = `${t.name} - ROV Overlay Tool`;

  const head = document.getElementById('teamHead');
  head.textContent = '';

  const logo = logoImage(t);
  logo.classList.add('big');

  const id = document.createElement('div');
  id.className = 'team-id';

  const name = document.createElement('div');
  name.className = 'team-name';
  name.style.fontSize = '26px';
  name.textContent = t.name;

  const sub = document.createElement('div');
  sub.className = 'team-sub';
  if (t.tag) sub.appendChild(badge(t.tag));
  const named = t.players.filter((p) => p.name).length;
  sub.appendChild(badge(`${named} / ${t.players.length} players`));
  const captain = t.players.find((p) => p.isCaptain && p.name);
  if (captain) sub.appendChild(badge(`Captain: ${captain.name}`));

  id.append(name, sub);
  head.append(logo, id);

  const badges = document.getElementById('headBadges');
  badges.textContent = '';
  if (record.played > 0) {
    badges.appendChild(badge(`${record.won} W - ${record.lost} L`, record.won >= record.lost ? 'active' : ''));
    badges.appendChild(badge(`${record.gamesWon} - ${record.gamesLost} games`, 'count'));
  } else {
    badges.appendChild(badge('No matches played yet'));
  }
  if (record.tournaments > 0) {
    badges.appendChild(badge(`${record.tournaments} ${record.tournaments === 1 ? 'tournament' : 'tournaments'}`));
  }
}

function renderForm(t) {
  /** @type {HTMLInputElement} */ (document.getElementById('fName')).value = t.name;
  /** @type {HTMLInputElement} */ (document.getElementById('fTag')).value = t.tag || '';
  playerRows = buildPlayerRows(document.getElementById('playerRows'), t.players, `captain-${t.id}`);
}

function renderTournaments(list) {
  const body = document.getElementById('tournamentsBody');
  body.textContent = '';

  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'This team has not been added to a tournament yet.';
    body.appendChild(empty);
    return;
  }

  list.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'src';

    const name = document.createElement('a');
    name.className = 'src-name link';
    name.textContent = t.name;
    name.href = withToken(`/tournament/${encodeURIComponent(t.id)}`);
    name.style.flex = '1';

    const tags = document.createElement('div');
    tags.className = 'status-tags';
    tags.appendChild(badge(t.status === 'finished' ? 'Finished' : 'Active', t.status));
    tags.appendChild(badge(formats[t.format] || t.format));
    tags.appendChild(badge(`Seed ${t.seed}`));

    row.append(name, tags);
    body.appendChild(row);
  });
}

function historyRow(match) {
  const row = document.createElement('div');
  row.className = `match ${match.status}${match.isBye ? ' bye' : ''}`;

  const round = document.createElement('div');
  round.className = 'hist-round';
  round.textContent = roundLabel(match);

  const opponent = document.createElement('div');
  opponent.className = 'hist-opp';

  if (match.isBye) {
    opponent.classList.add('tbd');
    opponent.textContent = 'no opponent';
  } else if (match.opponentId) {
    // คู่แข่งยังอยู่ในทะเบียน กดเข้าไปดูโปรไฟล์ได้
    const link = document.createElement('a');
    link.className = 'link';
    link.textContent = match.opponentName || 'Unknown team';
    link.href = withToken(`/teams/${encodeURIComponent(match.opponentId)}`);
    opponent.appendChild(link);
  } else if (match.opponentGone) {
    // ทีมถูกลบออกจากทะเบียนแล้ว ชื่อที่เห็นมาจากสำเนาแช่แข็งของเกม
    // ยังบอกได้ว่าเคยเจอใคร แต่ไม่มีโปรไฟล์ให้กดเข้าไปดูอีกแล้ว
    opponent.textContent = match.opponentName || 'Deleted team';
    opponent.title = 'This team was deleted from the registry. The name comes from the game record.';
    opponent.classList.add('gone');
  } else {
    opponent.classList.add('tbd');
    opponent.textContent = 'to be decided';
  }

  const score = document.createElement('div');
  score.className = 'hist-score';
  score.textContent = match.isBye ? '-' : `${match.score} - ${match.opponentScore}`;

  const result = document.createElement('div');
  result.className = 'hist-outcome';
  result.appendChild(outcomeBadge(match));

  const bo = document.createElement('div');
  bo.className = 'hist-bo';
  bo.textContent = `Bo${match.bestOf}`;

  row.append(round, opponent, score, bo, result);
  return row;
}

function renderHistory(matches) {
  const body = document.getElementById('historyBody');
  body.textContent = '';

  const hint = document.getElementById('historyHint');
  const played = matches.filter((m) => m.outcome === 'win' || m.outcome === 'loss').length;
  hint.textContent = played > 0 ? `${played} played, newest first` : '';

  if (matches.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No matches yet. Draw a bracket in a tournament this team has entered.';
    body.appendChild(empty);
    return;
  }

  // จัดกลุ่มตามทัวร์นาเมนต์ ตามลำดับที่เซิร์ฟเวอร์ส่งมา (ล่าสุดก่อน)
  let currentHead = '';
  matches.forEach((match) => {
    if (match.tournamentName !== currentHead) {
      currentHead = match.tournamentName;
      const title = document.createElement('a');
      title.className = 'round-head link';
      title.textContent = match.tournamentName;
      title.href = withToken(`/tournament/${encodeURIComponent(match.tournamentId)}`);
      title.style.display = 'block';
      body.appendChild(title);
    }
    body.appendChild(historyRow(match));
  });
}

function showMissing(message) {
  const head = document.getElementById('teamHead');
  head.textContent = '';
  const name = document.createElement('div');
  name.className = 'team-name';
  name.style.fontSize = '26px';
  name.textContent = 'Team not found';
  head.appendChild(name);

  const body = document.createElement('div');
  body.className = 'empty';
  body.textContent = message;
  document.querySelector('.wrap').appendChild(body);
}

// ACTIONS ------------------------------------------------------------

async function load() {
  const data = await fetchJson(`/api/teams/${encodeURIComponent(teamId)}/history`);
  team = data.team;

  renderHead(team, data.record);
  renderForm(team);
  renderTournaments(data.tournaments || []);
  renderHistory(data.matches || []);

  ['detailSection', 'tournamentsSection', 'historySection'].forEach((id) => {
    document.getElementById(id).hidden = false;
  });
}

async function reload() {
  try {
    await load();
  } catch (error) {
    showToast(error.message || 'Could not reload the team', 'red');
  }
}

async function save() {
  try {
    await fetchJson(`/api/teams/${encodeURIComponent(teamId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: /** @type {HTMLInputElement} */ (document.getElementById('fName')).value,
        tag: /** @type {HTMLInputElement} */ (document.getElementById('fTag')).value,
        players: playerRows ? playerRows.read() : []
      })
    });
    await reload();
    showToast('Saved', 'green');
  } catch (error) {
    showToast(error.message || 'Could not save', 'red');
  }
}

async function remove() {
  if (!window.confirm(
    `Delete "${team?.name || 'this team'}" from the registry?\n\n` +
    'It is removed from every tournament it entered. Matches already played keep their score, ' +
    'but this team\'s slot in them is emptied.'
  )) return;

  try {
    await fetchJson(`/api/teams/${encodeURIComponent(teamId)}`, { method: 'DELETE' });
    window.location.href = withToken('/teams');
  } catch (error) {
    showToast(error.message || 'Could not delete the team', 'red');
  }
}

async function uploadLogo(file) {
  try {
    await sendLogo(teamId, file);
    await reload();
    showToast('Logo uploaded', 'green');
  } catch (error) {
    showToast(error.message || 'Upload failed', 'red');
  }
}

async function clearLogo() {
  try {
    await fetchJson(`/api/teams/${encodeURIComponent(teamId)}/logo`, { method: 'DELETE' });
    await reload();
    showToast('Logo cleared', 'blue');
  } catch (error) {
    showToast(error.message || 'Could not clear the logo', 'red');
  }
}

// BOOT ---------------------------------------------------------------

function boot() {
  on('saveBtn', 'click', save);
  on('deleteBtn', 'click', remove);
  on('revertBtn', 'click', () => {
    if (team) {
      renderForm(team);
      showToast('Reverted to saved values', 'blue');
    }
  });

  const logoPicker = hiddenFilePicker((file) => {
    if (file) uploadLogo(file);
  });
  on('uploadLogoBtn', 'click', () => logoPicker.click());
  on('clearLogoBtn', 'click', clearLogo);

  socket.on('connect_error', (error) => showToast(error.message || 'Connection error', 'red'));

  document.getElementById('foot').textContent =
    'Editing the roster here changes the team from now on. ' +
    'Matches already played keep the players they were played with, so past results and ' +
    'pick/ban statistics stay correct.';
}

(async () => {
  try {
    boot();
  } catch (error) {
    console.error('team.js boot failed', error);
    showToast('Some controls on this page failed to start - try a hard reload', 'red');
  }

  if (!teamId) {
    showMissing('No team id in the address.');
    return;
  }

  // ชื่อรูปแบบการแข่งไว้แสดงในรายการทัวร์นาเมนต์ ไม่มีก็ยังแสดงหน้าได้
  try {
    const options = await fetchJson('/api/tournament-options');
    formats = Object.fromEntries((options.formats || []).map((f) => [f.id, f.label]));
  } catch {
    formats = {};
  }

  try {
    await load();
  } catch (error) {
    showMissing(error.message || 'Could not load this team.');
  }
})();
