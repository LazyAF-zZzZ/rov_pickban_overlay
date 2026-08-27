// หน้าจัดการการแข่ง (match session) แสดงผลเป็นสายการแข่งอย่างเดียว
//
// อ่าน id จาก /tournament/:id/bracket
// จัดกลุ่มคู่ตาม bracket แล้วตามรอบ แล้วปล่อยให้ CSS จัดตำแหน่งเอง
// (ทุกรอบสูงเท่ากัน + flex:1 ต่อช่อง = คู่รอบถัดไปไปอยู่กึ่งกลางของสองคู่ที่ป้อนเข้ามา)
//
// หน้านี้รับงานทั้งหมดที่เคยอยู่ในหัวข้อ Matches ของหน้าทัวร์นาเมนต์:
// จับคู่ ล้างสาย กรอกผล และเอาแมตช์ขึ้นจอ
// เหตุผลที่แยก: หน้าทัวร์นาเมนต์คือการตั้งค่าก่อนแข่ง (ทีม รูปแบบ URL ของ OBS)
// ส่วนหน้านี้คือตอนแข่งจริง ซึ่งใช้คนละเวลาและคนละสมาธิกัน
// และเหลือมุมมองเดียวคือสาย ไม่มีรายการแบบแบนอีก จะได้ไม่ต้องดูแลสองมุมมอง
// ที่แสดงข้อมูลชุดเดียวกันแล้วค่อยๆ เพี้ยนออกจากกัน
//
// สายแพ้กับรอบชิงแบบต้องชนะสองครั้งเรนเดอร์ได้แล้ว และเคยเห็นด้วยตาจริง
// หัวข้อเรียงตามเส้นทางของทีมเสมอ: สายชนะ -> กลุ่ม -> สายแพ้ -> รอบชิง

const { socket, fetchJson, withToken, showToast } = window.RovClient;
const { badge, on } = window.RovTeamUI;

const parts = window.location.pathname.split('/').filter(Boolean);
const tournamentId = decodeURIComponent(parts[1] || '');

let tournament = null;
let roster = [];
let liveMatchId = null;
let drawn = [];   // ตารางแข่งชุดล่าสุดที่โหลด/บันทึกมา

// สูงต่อหนึ่งช่องของรอบแรก ใช้คำนวณความสูงรวมของสาย
//
// ต้องมากกว่าความสูงของกล่อง (สองแถว ราว 54px) พอสมควร
// ส่วนต่างคือช่องว่างระหว่างคู่ ถ้าตั้งเท่ากับความสูงกล่อง กล่องจะชนกันหมด
// จนดูเป็นรายการก้อนเดียว ไม่ใช่สายการแข่ง
const SLOT_HEIGHT = 78;

function teamOf(id) {
  return roster.find((t) => t.id === id) || null;
}

// ROW ----------------------------------------------------------------

// คืน { row, score } เพราะผู้เรียกต้องอ่านค่าของทั้งสองฝั่งพร้อมกันตอนบันทึกผล
// ฝั่งเดียวบอกอะไรไม่ได้ เซิร์ฟเวอร์รับคะแนนเป็นคู่เสมอ
function teamRow(match, which, editable) {
  const id = which === 'a' ? match.teamAId : match.teamBId;
  const team = teamOf(id);
  const value = which === 'a' ? match.scoreA : match.scoreB;

  const row = document.createElement('div');
  row.className = 'mrow';

  const seed = document.createElement('span');
  seed.className = 'seed';
  seed.textContent = team ? String(team.seed || '') : '';

  const name = document.createElement('span');
  name.className = 'nm';
  if (team) {
    name.textContent = team.name;
  } else {
    name.classList.add('tbd');
    // บายไม่มีคู่ต่อสู้ ส่วนรอบหลังคือยังไม่รู้ว่าใครชนะมา
    name.textContent = match.isBye ? 'bye' : 'to be decided';
  }

  // คู่ที่ยังไม่รู้ทีมครบทั้งสองฝั่ง กรอกผลไม่ได้ จึงเป็นข้อความเฉยๆ
  // ไม่ใช่ช่องกรอกที่ disabled เพราะช่องที่กดไม่ได้ในกล่องเล็กๆ ดูเหมือนพัง
  let score;
  if (editable) {
    score = document.createElement('input');
    score.type = 'number';
    score.className = 'sc sc-input';
    score.min = '0';
    score.max = String(Math.floor(match.bestOf / 2) + 1);
    score.value = String(value);
    score.setAttribute('aria-label', `${team ? team.name : which} score`);
  } else {
    score = document.createElement('span');
    score.className = 'sc';
    score.textContent = String(value);
  }

  if (match.winnerId) row.classList.add(match.winnerId === id ? 'won' : 'lost');

  row.append(seed, name, score);
  return { row, score };
}

function matchBox(match, number) {
  const box = document.createElement('div');
  box.className = `mbox ${match.status}`;
  if (match.isBye) box.classList.add('bye');
  if (liveMatchId === match.id) box.classList.add('live');

  const playable = Boolean(match.teamAId && match.teamBId) && !match.isBye;
  if (playable) {
    box.classList.add('playable');
    box.title = 'Click to put this match on air. Type in the score boxes to record a result.';
    box.addEventListener('click', () => openInControl(match));
  }

  const a = teamRow(match, 'a', playable);
  const b = teamRow(match, 'b', playable);
  box.append(a.row, b.row);

  if (playable) {
    // กล่องทั้งใบเป็นปุ่ม "เอาขึ้นจอ" อยู่ ช่องคะแนนอยู่ข้างในกล่องนั้น
    // ถ้าไม่หยุด event ไว้ การกดจะกรอกคะแนนไม่ได้เลย เพราะเด้งไป Control Panel ก่อน
    // ช่องคะแนนเป็น input เสมอเมื่อ playable ส่วนที่ยังไม่รู้ทีมเป็น span อ่านค่าไม่ได้
    const scoreOf = (side) => Number(/** @type {HTMLInputElement} */ (side.score).value);
    const commit = () => recordResult(match, scoreOf(a), scoreOf(b));
    [a.score, b.score].forEach((input) => {
      ['click', 'mousedown', 'dblclick'].forEach((type) => {
        input.addEventListener(type, (event) => event.stopPropagation());
      });
      input.addEventListener('change', commit);
    });
  }

  if (number !== null) {
    const no = document.createElement('div');
    no.className = 'mno';
    no.textContent = String(number);
    box.appendChild(no);
  }
  return box;
}

// LAYOUT --------------------------------------------------------------

function roundColumn(title, matches, numbers, elimination) {
  const round = document.createElement('div');
  round.className = 'round';

  const head = document.createElement('div');
  head.className = 'round-title';
  head.textContent = title;
  round.appendChild(head);

  const body = document.createElement('div');
  body.className = 'round-body';

  matches.forEach((match, index) => {
    const slot = document.createElement('div');
    slot.className = 'slot';
    // คู่บน/คู่ล่างของแต่ละคู่ที่จะไหลไปรวมกันในรอบถัดไป
    if (elimination) slot.classList.add(index % 2 === 0 ? 'pair-top' : 'pair-bottom');
    slot.appendChild(matchBox(match, numbers.get(match.id) ?? null));
    body.appendChild(slot);
  });

  round.appendChild(body);
  return round;
}

// ชื่อหัวข้อของแต่ละสาย
function sectionTitle(name) {
  if (name === 'main') return 'Winners bracket';
  if (name === 'losers') return 'Losers bracket';
  if (name === 'grand') return 'Grand final';
  return `Group ${name}`;
}

// ชื่อรอบท้ายๆ เรียกตามที่คนเรียกกันจริง ไม่ใช่ "รอบที่ 5"
//
// ใช้ได้เฉพาะรูปแบบที่แพ้แล้วตกรอบเท่านั้น
// พบกันหมดรอบสุดท้ายไม่ใช่ "รอบชิง" มันคือรอบที่เหลือของตาราง ทุกทีมยังเล่นพร้อมกันอยู่
// เรียกว่า Final แล้วคนอ่านจะนึกว่าเหลือสองทีม ทั้งที่ยังเล่นกันทั้งกลุ่ม
function roundTitle(roundNo, totalRounds, bracketName, elimination) {
  if (bracketName === 'grand') return roundNo === 1 ? 'Grand final' : 'Reset (if needed)';
  if (bracketName !== 'main' || !elimination) return `Round ${roundNo}`;
  const fromEnd = totalRounds - roundNo;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round ${roundNo}`;
}

function render(matches) {
  const body = document.getElementById('bracketBody');
  body.textContent = '';

  if (matches.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'bracket-empty';
    empty.textContent = tournament && tournament.teamCount < 2
      ? 'Add at least two teams on the tournament page, then draw the bracket here.'
      : 'No matches drawn yet. Use DRAW MATCHES above to build the bracket.';
    body.appendChild(empty);
    return;
  }

  const elimination = tournament?.format === 'single_elim' || tournament?.format === 'double_elim';

  // จัดกลุ่มตามสาย (main / A / B / losers / grand)
  const brackets = new Map();
  matches.forEach((m) => {
    if (!brackets.has(m.bracket)) brackets.set(m.bracket, []);
    brackets.get(m.bracket).push(m);
  });

  // ลำดับหัวข้อต้องเรียงตามเส้นทางของทีม ไม่ใช่ตามตัวอักษร
  //
  // เซิร์ฟเวอร์ส่งมาแบบ ORDER BY bracket ซึ่งเรียง grand < losers < main
  // ปล่อยตามนั้นแล้วหน้าเว็บขึ้นรอบชิงชนะเลิศไว้บนสุด ตามด้วยสายแพ้ แล้วค่อยสายชนะ
  // คืออ่านจากจุดจบย้อนกลับไปหาจุดเริ่ม ซึ่งกลับหัวกับที่คนไล่สายจริงๆ
  const SECTION_ORDER = { main: 0, losers: 2, grand: 3 };
  const rankOf = (name) => (name in SECTION_ORDER ? SECTION_ORDER[name] : 1);
  const ordered = [...brackets.entries()].sort(
    (a, b) => rankOf(a[0]) - rankOf(b[0]) || a[0].localeCompare(b[0])
  );

  // เลขคู่ไว้อ้างอิงเวลาคุยกันว่า "คู่ที่ 21"
  //
  // ต้องนับตามลำดับที่แสดงบนจอ ไม่ใช่ลำดับที่เซิร์ฟเวอร์ส่งมา
  // ไม่งั้นคู่ที่ 1 จะกลายเป็นรอบชิงชนะเลิศ ส่วนรอบแรกของสายชนะได้เลขท้ายๆ
  const numbers = new Map();
  let counter = 1;
  ordered.forEach(([, list]) => {
    [...list]
      .sort((a, b) => a.round - b.round || a.slot - b.slot)
      .forEach((m) => { numbers.set(m.id, counter); counter += 1; });
  });

  ordered.forEach(([name, list]) => {
    const section = document.createElement('div');
    section.className = 'bracket-section';

    if (brackets.size > 1 || name !== 'main') {
      const title = document.createElement('div');
      title.className = 'bracket-section-title';
      title.textContent = sectionTitle(name);
      section.appendChild(title);
    }

    const rounds = new Map();
    list.forEach((m) => {
      if (!rounds.has(m.round)) rounds.set(m.round, []);
      rounds.get(m.round).push(m);
    });

    const wrap = document.createElement('div');
    wrap.className = `bracket${elimination ? '' : ' flat'}`;

    const roundNumbers = [...rounds.keys()].sort((a, b) => a - b);
    const total = roundNumbers.length;

    if (elimination) {
      // ความสูงรวมมาจากรอบแรก ทุกรอบสูงเท่ากันจึงเรียงตรงกันเอง
      const first = rounds.get(roundNumbers[0]) || [];
      wrap.style.height = `${Math.max(first.length, 1) * SLOT_HEIGHT + 40}px`;
    }

    roundNumbers.forEach((roundNo, index) => {
      const here = (rounds.get(roundNo) || []).sort((a, b) => a.slot - b.slot);
      const next = rounds.get(roundNumbers[index + 1]) || [];

      // เส้นบรรจบวาดได้เฉพาะรอบที่สองคู่ไหลไปรวมเป็นคู่เดียวจริงๆ
      //
      // สายชนะเป็นแบบนั้นทุกรอบ แต่สายแพ้ไม่ใช่
      // สายแพ้สลับกันระหว่างรอบที่ผู้ชนะมาเจอกันเอง (คู่ลดครึ่ง)
      // กับรอบที่ผู้ชนะไปเจอผู้แพ้ที่เพิ่งตกลงมาจากสายชนะ (จำนวนคู่เท่าเดิม)
      // ลากเส้นบรรจบในรอบแบบหลังคือการบอกเส้นทางผิด
      const merges = next.length > 0 && next.length === here.length / 2;

      wrap.appendChild(roundColumn(
        roundTitle(roundNo, total, name, elimination),
        here,
        numbers,
        elimination && merges
      ));
    });

    section.appendChild(wrap);
    body.appendChild(section);
  });
}

// ตัวเลขและปุ่มบนแถบหัว ขึ้นกับตารางแข่งชุดปัจจุบัน
function renderControls() {
  const badges = document.getElementById('headBadges');
  badges.textContent = '';
  if (tournament) {
    badges.appendChild(badge(tournament.status === 'finished' ? 'Finished' : 'Active', tournament.status));
    badges.appendChild(badge(`Bo${tournament.bestOf}`));
    badges.appendChild(badge(`${tournament.teamCount} teams`, 'count'));
  }

  const played = drawn.filter((m) => m.status === 'complete' && !m.isBye).length;
  const total = drawn.filter((m) => !m.isBye).length;
  if (total > 0) {
    badges.appendChild(badge(`${played} / ${total} played`, played === total ? 'active' : 'count'));
  }

  const clearBtn = document.getElementById('clearMatchesBtn');
  if (clearBtn) clearBtn.hidden = drawn.length === 0;

  // จับคู่ใหม่ทับของเดิมได้ แต่ต้องบอกให้ชัดว่าปุ่มกำลังจะทำอะไร
  const drawBtn = document.getElementById('drawBtn');
  if (drawBtn) {
    drawBtn.textContent = drawn.length === 0 ? 'DRAW MATCHES' : 'DRAW AGAIN';
    drawBtn.title = drawn.length === 0
      ? 'Build the bracket from the teams entered'
      : 'Replace the current bracket and every score on it';
  }
}

function apply(list) {
  drawn = list;
  renderControls();
  render(drawn);
}

// ACTIONS -------------------------------------------------------------

async function openInControl(match) {
  try {
    const data = await fetchJson(`/api/matches/${encodeURIComponent(match.id)}/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    showToast(`Game ${data.live?.gameNo ?? 1} is on air`, 'green');
    window.location.href = withToken('/control');
  } catch (error) {
    showToast(error.message || 'Could not put this match on air', 'red');
  }
}

async function recordResult(match, scoreA, scoreB) {
  try {
    const data = await fetchJson(`/api/matches/${encodeURIComponent(match.id)}/result`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scoreA, scoreB })
    });
    // ผู้ชนะเลื่อนไปรอบถัดไปแล้ว ต้องวาดใหม่ทั้งสาย ไม่ใช่แค่กล่องนี้
    apply(data.matches || []);
  } catch (error) {
    // เช่นกรอกให้ทั้งสองฝั่งชนะครบ ค่าที่ค้างในช่องไม่ตรงกับฐานแล้ว โหลดใหม่ให้ตรง
    showToast(error.message || 'Could not record the result', 'red');
    reload();
  }
}

async function drawMatches() {
  const randomise = /** @type {HTMLInputElement} */ (document.getElementById('randomiseDraw')).checked;
  if (drawn.length > 0 && !window.confirm(
    'Draw again?\n\nThe current bracket and every score recorded on it are replaced.'
  )) return;

  try {
    const data = await fetchJson(`/api/tournaments/${encodeURIComponent(tournamentId)}/matches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ randomise })
    });
    apply(data.matches || []);
    showToast(randomise ? 'Matches drawn at random' : 'Matches drawn by seed', 'green');
  } catch (error) {
    showToast(error.message || 'Could not draw matches', 'red');
  }
}

async function clearMatches() {
  if (!window.confirm('Clear the bracket?\n\nEvery match and score is removed.')) return;
  try {
    await fetchJson(`/api/tournaments/${encodeURIComponent(tournamentId)}/matches`, { method: 'DELETE' });
    apply([]);
    showToast('Bracket cleared', 'blue');
  } catch (error) {
    showToast(error.message || 'Could not clear the bracket', 'red');
  }
}

async function load() {
  const [detail, matchData, liveData] = await Promise.all([
    fetchJson(`/api/tournaments/${encodeURIComponent(tournamentId)}`),
    fetchJson(`/api/tournaments/${encodeURIComponent(tournamentId)}/matches`),
    fetchJson('/api/live-match').catch(() => ({ live: {} }))
  ]);

  tournament = detail.tournament;
  roster = detail.teams || [];
  liveMatchId = liveData.live?.matchId || null;

  document.getElementById('headName').textContent = tournament.name;
  document.title = `${tournament.name} - match session - ROV Overlay Tool`;
  /** @type {HTMLAnchorElement} */ (document.getElementById('backLink')).href = withToken(`/tournament/${encodeURIComponent(tournamentId)}`);

  apply(matchData.matches || []);
}

async function reload() {
  try {
    await load();
  } catch (error) {
    showToast(error.message || 'Could not reload the bracket', 'red');
  }
}

socket.on('connect_error', (error) => showToast(error.message || 'Connection error', 'red'));

(async () => {
  // ผูกปุ่มก่อนโหลดข้อมูล ปุ่มจะได้ใช้ได้แม้การโหลดครั้งแรกล้ม
  on('drawBtn', 'click', drawMatches);
  on('clearMatchesBtn', 'click', clearMatches);

  if (!tournamentId) {
    document.getElementById('headName').textContent = 'Tournament not found';
    return;
  }
  try {
    await load();
  } catch (error) {
    document.getElementById('headName').textContent = 'Could not load this match session';
    showToast(error.message || 'Could not load the bracket', 'red');
  }
})();
