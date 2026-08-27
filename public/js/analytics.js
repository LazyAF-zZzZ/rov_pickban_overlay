// หน้าสถิติ pick/ban
//
// ตัวเลขทั้งหมดคำนวณที่เซิร์ฟเวอร์ หน้านี้แค่แสดงผลกับกรองขอบเขต
//
// สองชั้นที่ต้องไม่ปนกันเด็ดขาด:
//   1. ตัวเลขสะสม มาจากเกมที่ดราฟต์ล็อกแล้วเท่านั้น
//   2. ดราฟต์ที่กำลังเล่นอยู่ตอนนี้ แสดงแยกด้านบน ไม่นับเข้าเปอร์เซ็นต์
// ถ้าเอาชั้นที่สองไปรวม ตัวหารจะโตก่อนตัวเศษ อัตราของทุกตัวจะร่วงพร้อมกัน
// กลางดราฟต์ แล้วเด้งกลับตอนดราฟต์จบ ซึ่งอ่านแล้วเข้าใจผิดได้ง่ายมาก
//
// การอัปเดตสด: เข้าห้อง 'analytics' แล้วรอสัญญาณ analyticsChanged
// สัญญาณไม่มีข้อมูลติดมา เพราะแต่ละหน้ากรองคนละขอบเขต ตัวเลขชุดเดียวใช้ร่วมกันไม่ได้

const { socket, fetchJson, showToast } = window.RovClient;
const { badge, on } = window.RovTeamUI;

let heroes = [];
let summary = null;
let filter = '';
let scope = { tournamentId: '', teamId: '' };
let liveState = null;

// HELPERS ------------------------------------------------------------

const pct = (value) => `${(value * 100).toFixed(1)}%`;

function heroImage(hero) {
  const img = document.createElement('img');
  img.className = 'hero-img';
  img.loading = 'lazy';
  img.alt = '';
  img.src = `/images/heroes/${encodeURIComponent(hero)}.png`;
  // ชื่อฮีโร่คือชื่อไฟล์ภาพ ประวัติเก่าอาจอ้างไฟล์ที่ถูกเปลี่ยนชื่อไปแล้ว
  // ภาพหายไม่ควรทำให้แถวพัง ซ่อนภาพแล้วปล่อยให้ชื่อทำหน้าที่แทน
  img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
  return img;
}

// แถบสัดส่วน อ่านเร็วกว่าตัวเลขเวลาต้องกวาดสายตาหลายสิบแถว
function bar(value, cls) {
  const wrap = document.createElement('div');
  wrap.className = 'meter';
  const fill = document.createElement('div');
  fill.className = `meter-fill ${cls}`;
  // สเกลเทียบกับ 40% ไม่ใช่ 100% ฮีโร่ที่ดังที่สุดยังไม่ถึง 40% ของเกมด้วยซ้ำ
  // ถ้าสเกลเต็ม 100% ทุกแถบจะสั้นจนเท่ากันหมด แยกไม่ออกว่าตัวไหนมากกว่า
  fill.style.width = `${Math.min(100, (value / 0.4) * 100)}%`;
  wrap.appendChild(fill);
  return wrap;
}

function cell(text, cls = '') {
  const el = document.createElement('div');
  el.className = `col ${cls}`.trim();
  el.textContent = text;
  return el;
}

// RENDER -------------------------------------------------------------

function renderSummary() {
  const wrap = document.getElementById('summaryBadges');
  wrap.textContent = '';
  if (!summary) return;

  wrap.appendChild(badge(`${summary.games} ${summary.games === 1 ? 'game' : 'games'}`, 'count'));
  if (summary.games > 0) {
    wrap.appendChild(badge(`${summary.heroesSeen} heroes seen`));
    // บอกตรงๆ ว่าอัตราชนะอิงจากกี่เกม เกมที่ไม่มีใครกดผู้ชนะไม่ได้ถูกนับ
    wrap.appendChild(badge(
      `${summary.decidedGames} with a winner`,
      summary.decidedGames === summary.games ? 'active' : ''
    ));
  }
}

function headerRow() {
  const row = document.createElement('div');
  row.className = 'stat-row head';
  row.append(
    cell('', 'img'),
    cell('Hero', 'name'),
    cell('Presence', 'num'),
    cell('', 'meter-col'),
    cell('Pick', 'num'),
    cell('Ban', 'num'),
    cell('Win', 'num'),
    cell('Ban prio', 'num')
  );
  return row;
}

function statRow(stat) {
  const row = document.createElement('div');
  row.className = 'stat-row';

  const img = document.createElement('div');
  img.className = 'col img';
  img.appendChild(heroImage(stat.hero));

  const name = document.createElement('div');
  name.className = 'col name';
  name.textContent = stat.hero;

  const meter = document.createElement('div');
  meter.className = 'col meter-col';
  meter.appendChild(bar(stat.presence, 'presence'));

  // อัตราชนะ null = ยังไม่มีเกมที่รู้ผล ต่างจาก 0% ที่แปลว่าลงแล้วแพ้ล้วน
  const win = stat.winRate === null ? '—' : pct(stat.winRate);
  const winCell = cell(win, 'num win');
  if (stat.winRate !== null) {
    winCell.classList.add(stat.winRate >= 0.5 ? 'good' : 'bad');
    winCell.title = `${stat.wins} of ${stat.decided} games with a recorded winner`;
  } else if (stat.picked > 0) {
    winCell.title = 'No winner recorded for any game this hero was picked in';
  }

  const prio = cell(stat.banPriority === null ? '—' : `#${stat.banPriority}`, 'num prio');
  if (stat.earlyBans > 0) {
    prio.title = `${stat.earlyBans} first-phase bans (${pct(stat.earlyBanRate)} of games)`;
  }

  row.append(
    img,
    name,
    cell(pct(stat.presence), 'num strong'),
    meter,
    cell(pct(stat.pickRate), 'num'),
    cell(pct(stat.banRate), 'num'),
    winCell,
    prio
  );
  return row;
}

function matchesFilter(stat) {
  return !filter || stat.hero.toLowerCase().includes(filter.toLowerCase());
}

function render() {
  const body = document.getElementById('statsBody');
  body.textContent = '';
  renderSummary();

  if (!summary || summary.games === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = scope.tournamentId || scope.teamId
      ? 'No completed drafts in this scope yet.'
      : 'No completed drafts yet. Play a match from a tournament and the numbers appear here.';
    body.appendChild(empty);
    return;
  }

  const shown = heroes.filter((h) => h.present > 0).filter(matchesFilter);
  if (shown.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = `No hero matches "${filter}".`;
    body.appendChild(empty);
    return;
  }

  const table = document.createElement('div');
  table.className = 'stat-table';
  table.appendChild(headerRow());
  shown.forEach((stat) => table.appendChild(statRow(stat)));
  body.appendChild(table);
}

// ดราฟต์ครบทุกช่องหรือยัง คิดแบบเดียวกับ isDraftComplete ฝั่งเซิร์ฟเวอร์
//
// ครบ = ถูกล็อกและถูกนับเข้าเปอร์เซ็นต์ไปแล้ว ชั้นสดจึงต้องหายไป
// ถ้ายังโชว์อยู่ ป้าย "ยังไม่ถูกนับ" จะกลายเป็นคำโกหก และคนอ่านจะนึกว่า
// ดราฟต์ชุดนี้ยังรอคิวอยู่ ทั้งที่มันอยู่ในตัวเลขข้างล่างเรียบร้อยแล้ว
function draftIsComplete(state) {
  return ['teamBlue', 'teamRed'].every((team) => {
    const side = state?.[team];
    if (!side) return false;
    return (side.picks || []).every(Boolean) && (side.bans || []).every(Boolean);
  });
}

// ชั้นของดราฟต์ที่กำลังเล่น แยกจากตัวเลขสะสมโดยสิ้นเชิง
function renderLive() {
  const layer = document.getElementById('liveLayer');
  if (!layer) return;

  const picks = [];
  const bans = [];
  (['teamBlue', 'teamRed']).forEach((team) => {
    const side = liveState?.[team];
    if (!side) return;
    (side.picks || []).forEach((hero) => { if (hero) picks.push({ hero, team }); });
    (side.bans || []).forEach((hero) => { if (hero) bans.push({ hero, team }); });
  });

  if ((picks.length === 0 && bans.length === 0) || draftIsComplete(liveState)) {
    layer.hidden = true;
    return;
  }

  document.getElementById('liveTitle').textContent =
    `${liveState?.teamBlue?.name || 'Blue'} vs ${liveState?.teamRed?.name || 'Red'}`;
  document.getElementById('liveNote').textContent =
    `${picks.length} picked, ${bans.length} banned — not counted until the draft is complete`;

  const wrap = document.getElementById('liveHeroes');
  wrap.textContent = '';
  [...bans.map((b) => ({ ...b, kind: 'ban' })), ...picks.map((p) => ({ ...p, kind: 'pick' }))]
    .forEach((entry) => {
      const chip = document.createElement('span');
      chip.className = `live-chip ${entry.kind} ${entry.team === 'teamBlue' ? 'blue' : 'red'}`;
      chip.appendChild(heroImage(entry.hero));
      const label = document.createElement('span');
      label.textContent = entry.hero;
      chip.appendChild(label);
      wrap.appendChild(chip);
    });

  layer.hidden = false;
}

// SCOPE ---------------------------------------------------------------

function fillSelect(select, items, value, blankLabel) {
  select.textContent = '';
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = blankLabel;
  select.appendChild(blank);
  items.forEach((item) => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = item.name;
    if (item.id === value) opt.selected = true;
    select.appendChild(opt);
  });
}

async function loadScopeOptions() {
  const [tournaments, teams] = await Promise.all([
    fetchJson('/api/tournaments').then((d) => d.tournaments || []).catch(() => []),
    fetchJson('/api/teams').then((d) => d.teams || []).catch(() => [])
  ]);
  fillSelect(document.getElementById('fTournament'), tournaments, scope.tournamentId, 'All tournaments');
  fillSelect(document.getElementById('fTeam'), teams, scope.teamId, 'All teams');
}

async function load() {
  const params = new URLSearchParams();
  if (scope.tournamentId) params.set('tournamentId', scope.tournamentId);
  if (scope.teamId) params.set('teamId', scope.teamId);
  const query = params.toString();

  const data = await fetchJson(`/api/analytics${query ? `?${query}` : ''}`);
  heroes = data.heroes || [];
  summary = data.summary;
  render();
}

async function reload() {
  try {
    await load();
  } catch (error) {
    showToast(error.message || 'Could not load the statistics', 'red');
  }
}

// BOOT ----------------------------------------------------------------

function boot() {
  on('fTournament', 'change', (event) => {
    scope.tournamentId = event.target.value;
    reload();
  });
  on('fTeam', 'change', (event) => {
    scope.teamId = event.target.value;
    reload();
  });
  on('resetScopeBtn', 'click', () => {
    scope = { tournamentId: '', teamId: '' };
    document.getElementById('fTournament').value = '';
    document.getElementById('fTeam').value = '';
    reload();
  });
  on('searchBox', 'input', (event) => {
    filter = event.target.value.trim();
    render();
  });

  // ชั้นสด อ่านจาก state กลางที่ทุกหน้ารับอยู่แล้ว ไม่ต้องขออะไรเพิ่ม
  socket.on('stateUpdate', (state) => {
    liveState = state;
    renderLive();
  });

  // เข้าห้องเพื่อรับสัญญาณว่าตัวเลขสะสมเปลี่ยน (ดราฟต์ล็อก หรือมีการบันทึกผู้ชนะ)
  // ต้องเข้าใหม่ทุกครั้งที่ต่อใหม่ ห้องไม่ได้ตามมาเองหลัง reconnect
  socket.on('connect', () => socket.emit('analytics:join'));
  if (socket.connected) socket.emit('analytics:join');
  socket.on('analyticsChanged', reload);
  socket.on('connect_error', (error) => showToast(error.message || 'Connection error', 'red'));

  document.getElementById('foot').textContent =
    'Rates are per game, not per draft slot: a hero picked in 8 of 100 games shows 8%. ' +
    'Only games with a completed draft are counted, and the draft in progress is shown ' +
    'separately above so it never drags the percentages around mid-game.';
}

(async () => {
  try {
    boot();
  } catch (error) {
    console.error('analytics.js boot failed', error);
    showToast('Some controls on this page failed to start - try a hard reload', 'red');
  }

  try {
    await loadScopeOptions();
    await load();
  } catch (error) {
    showToast(error.message || 'Could not load the statistics', 'red');
  }
})();
