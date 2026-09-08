// ประวัติพิค/แบนของทั้งทัวร์นาเมนต์
//
// ตอบคำถามที่เมื่อก่อนตอบไม่ได้เลย: "รายการนี้เล่นอะไรกันมาบ้าง"
// หน้าสถิติตอบเป็นตัวเลขรวมรายฮีโร่ กราฟิกรอบก่อนหน้าตอบเฉพาะซีรีส์ที่กำลังคุมอยู่
// ส่วนหน้านี้คือดราฟต์จริงทีละเกม เรียงจากใหม่ไปเก่า
//
// อยู่ที่ /tournament/:id/drafts ลึกสองชั้นเหมือนหน้าสายการแข่ง
// path ของ asset ทุกอันจึงต้องขึ้นต้นด้วย /
//
// ทุกอย่างประกอบด้วย textContent ไม่มีการต่อ innerHTML
// ชื่อทีมเป็นข้อความที่ผู้ใช้พิมพ์เอง (กฎเดียวกับหน้าอื่นที่วาดชื่อทีม)

const { fetchJson, showToast, onDataChange } = window.RovClient;

// /tournament/<id>/drafts -> เอาส่วนกลาง
const tournamentId = decodeURIComponent(window.location.pathname.split('/')[2] || '');

let games = [];
let tournamentName = '';

function heroUrl(hero) {
  if (!hero || typeof hero !== 'string') return '';
  return `/images/heroes/${encodeURIComponent(hero)}.png`;
}

// ชื่อรอบให้คนอ่านรู้เรื่อง ต้องรู้จักสายแพ้ รอบชิง และสายน็อกเอาต์ด้วย
// เหมาว่าอะไรที่ไม่ใช่ 'main' คือชื่อกลุ่ม คือความผิดพลาดที่เกิดมาแล้วสองรอบ
// (ดู label() ใน services/live-match.ts และ roundLabel() ใน team.js)
function whereLabel(game) {
  if (game.bracket === 'main') return `${t('Round')} ${game.round}`;
  if (game.bracket === 'losers') return `${t('Losers round')} ${game.round}`;
  if (game.bracket === 'grand') return t('Grand final');
  if (game.bracket === 'playoff') return `${t('Playoff round')} ${game.round}`;
  return `${t('Group')} ${game.bracket} · ${t('Round')} ${game.round}`;
}

function heroTile(hero, kind, highlight) {
  const box = document.createElement('div');
  box.className = `dh-hero ${kind}`;
  if (!hero) {
    box.classList.add('empty');
    return box;
  }
  box.style.backgroundImage = `url("${heroUrl(hero)}")`;
  box.title = hero;
  if (highlight) box.classList.add('match');
  return box;
}

function heroGroup(label, heroes, kind, needle) {
  const group = document.createElement('div');
  group.className = 'dh-group';

  const tag = document.createElement('span');
  tag.className = 'dh-label';
  tag.textContent = label;
  group.appendChild(tag);

  heroes.forEach((hero) => {
    const hit = Boolean(needle && hero && hero.toLowerCase().includes(needle));
    group.appendChild(heroTile(hero, kind, hit));
  });
  return group;
}

function sideRow(side, which, needle) {
  const row = document.createElement('div');
  row.className = `dh-side ${which}${side.won ? ' won' : ''}`;

  const name = document.createElement('div');
  name.className = 'dh-name';
  const dot = document.createElement('div');
  dot.className = 'dh-dot';
  const text = document.createElement('span');
  // ชื่อจากสำเนาแช่แข็ง = ชื่อ ณ วันที่ลงเล่น ไม่ใช่ชื่อปัจจุบัน
  // นี่คือประวัติ ทีมที่เปลี่ยนชื่อทีหลังต้องยังอ่านได้ว่าวันนั้นชื่ออะไร
  text.textContent = side.name || '—';
  name.append(dot, text);

  const rows = document.createElement('div');
  rows.className = 'dh-rows';
  rows.append(
    heroGroup(t('PICK'), side.picks, 'pick', needle),
    heroGroup(t('BAN'), side.bans, 'ban', needle)
  );

  row.append(name, rows);
  return row;
}

function gameCard(game, needle) {
  const card = document.createElement('div');
  card.className = 'dh-game';

  const head = document.createElement('div');
  head.className = 'dh-head';

  const where = document.createElement('span');
  where.className = 'dh-where';
  where.textContent = whereLabel(game);

  const teams = document.createElement('span');
  teams.className = 'dh-teams';
  teams.textContent = `${game.blue.name || '—'}  vs  ${game.red.name || '—'}`;

  const no = document.createElement('span');
  no.className = 'dh-game-no';
  no.textContent = `${t('GAME')} ${game.gameNo}`;

  head.append(where, teams, no);
  card.append(head, sideRow(game.blue, 'blue', needle), sideRow(game.red, 'red', needle));
  return card;
}

function matchesFilters(game, teamId, needle) {
  if (teamId && game.blue.teamId !== teamId && game.red.teamId !== teamId) return false;
  if (!needle) return true;

  // ค้นในทุกช่องของทั้งสองฝั่ง ทั้งพิคและแบน
  // คนถามว่า "ตัวนี้ถูกหยิบหรือแบนที่ไหนบ้าง" ไม่ได้แยกว่าฝั่งไหน
  return [game.blue, game.red].some((side) => (
    [...side.picks, ...side.bans].some((hero) => hero && hero.toLowerCase().includes(needle))
  ));
}

function render() {
  const teamField = /** @type {HTMLSelectElement|null} */ (document.getElementById('teamFilter'));
  const heroField = /** @type {HTMLInputElement|null} */ (document.getElementById('heroFilter'));
  const teamId = teamField?.value || '';
  const needle = (heroField?.value || '').trim().toLowerCase();

  const shown = games.filter((game) => matchesFilters(game, teamId, needle));

  const count = document.getElementById('count');
  count.textContent = shown.length === games.length
    ? tf('{n} games with a recorded draft', { n: games.length })
    : tf('{shown} of {total} games', { shown: shown.length, total: games.length });

  const list = document.getElementById('list');
  list.textContent = '';

  if (shown.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dh-empty';
    empty.textContent = games.length === 0
      ? t('No draft has been recorded in this tournament yet.')
      : t('Nothing matches that filter.');
    list.appendChild(empty);
    return;
  }

  shown.forEach((game) => list.appendChild(gameCard(game, needle)));
}

// รายชื่อทีมในตัวกรอง มาจากเกมที่มีจริง ไม่ใช่จากทะเบียน
// ทีมที่ถูกถอดออกจากทัวร์นาเมนต์ไปแล้วยังมีดราฟต์ค้างอยู่ในประวัติ
// ถ้าเอารายชื่อจากทะเบียน จะกรองหาดราฟต์ของทีมนั้นไม่ได้เลย
function buildTeamFilter() {
  const field = /** @type {HTMLSelectElement|null} */ (document.getElementById('teamFilter'));
  if (!field) return;

  const seen = new Map();
  games.forEach((game) => {
    [game.blue, game.red].forEach((side) => {
      if (side.teamId && !seen.has(side.teamId)) seen.set(side.teamId, side.name);
    });
  });

  field.textContent = '';
  const all = document.createElement('option');
  all.value = '';
  all.textContent = t('All teams');
  field.appendChild(all);

  [...seen.entries()]
    .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
    .forEach(([id, name]) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = name;
      field.appendChild(option);
    });
}

async function load() {
  try {
    const data = await fetchJson(`/api/tournaments/${encodeURIComponent(tournamentId)}/drafts`);
    games = data.games || [];
    tournamentName = data.tournament?.name || '';
    document.getElementById('pageTitle').textContent = tournamentName;
    document.title = `${tournamentName} - ${t('Pick / ban history')}`;
    const back = /** @type {HTMLAnchorElement|null} */ (document.getElementById('backLink'));
    if (back) back.href = `/tournament/${encodeURIComponent(tournamentId)}`;
    buildTeamFilter();
    render();
  } catch (error) {
    showToast(t(error.message || 'Could not load the draft history'), 'red');
  }
}

document.getElementById('teamFilter')?.addEventListener('change', render);
document.getElementById('heroFilter')?.addEventListener('input', render);

// ดราฟต์ถูกบันทึกระหว่างที่คนคุมงานทำงานอยู่ หน้านี้เปิดค้างไว้ได้
// (topic 'games' คือจังหวะที่ดราฟต์ล็อกหรือผู้ชนะรายเกมถูกบันทึก)
onDataChange((change) => {
  if (change.topic === 'games' || change.topic === 'matches') load();
});

load();
