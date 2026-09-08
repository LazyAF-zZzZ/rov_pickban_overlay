// ตารางคะแนนของรอบแบ่งกลุ่ม สำหรับขึ้นจอระหว่างพัก
//
// รูปแบบพบกันหมดและแบ่งกลุ่มไม่มีสายให้ดูว่าใครไปต่อ ตารางคือตัวการแข่งขันเอง
// ก่อนหน้านี้ไม่มีทางเอาขึ้นจอเลย คนดูจึงไม่มีทางรู้ว่าใครนำอยู่
//
// พารามิเตอร์ที่รับ (ต่อท้าย URL ใน OBS ได้เลย):
//   ?tournament=<id>  ทัวร์นาเมนต์ที่จะแสดง ไม่ใส่ = ตามแมตช์ที่ออกอากาศ
//   ?title=           เปลี่ยนหัวเรื่อง ไม่ใส่ = ชื่อทัวร์นาเมนต์
//   ?through=1..8     ขีดเส้นว่ากี่ทีมแรกของแต่ละกลุ่มได้ไปต่อ ไม่ใส่ = ไม่ขีด
//   ?refresh=<วินาที> ดึงข้อมูลใหม่เป็นระยะ สำหรับกระดานที่เปิดค้างไว้ทั้งงาน
//
// หน้านี้เป็นหน้าดูอย่างเดียว ต่อ socket เปล่าๆ ไม่ต้องมีโทเคน
// และไม่เข้าห้อง dataChanged ด้วยเหตุผลเดียวกับกระดานสถิติ: ตัวเลขขยับตอน
// บันทึกผล ซึ่งเป็นตอนที่กระดานไม่ได้อยู่บนจอ

const params = new URLSearchParams(window.location.search);

// overlay-size.js อ่านตัวแปรชื่อ socket ตัวนี้ ต้องประกาศก่อนไฟล์นั้นถูกโหลด
const socket = io();

const ENTER_MS = 520;
const SAFETY_MS = 700;
const STAGGER_MS = 110;

let settleTimer = null;

const through = window.RovOverlay.intParam(params, 'through', 0, 0, 8);
const refreshSeconds = window.RovOverlay.intParam(params, 'refresh', 0, 5, 3600);

async function getJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response.json();
}

// เลือกทัวร์นาเมนต์: ระบุมาเอง > ตามแมตช์ที่ออกอากาศ > รายการล่าสุด
// URL เดียวใช้ได้ทั้งงานโดยไม่ต้องแก้ browser source ใน OBS
async function resolveTournamentId() {
    const given = params.get('tournament') || params.get('tournamentId');
    if (given) return given;

    try {
        const data = await getJson('/api/live-match');
        if (data.live && data.live.tournamentId) return data.live.tournamentId;
    } catch (error) { /* ยังไม่เคยเปิดแมตช์ไหน ไปดูรายการต่อ */ }

    try {
        const data = await getJson('/api/tournaments');
        const newest = (data.tournaments || [])[0];
        if (newest) return newest.id;
    } catch (error) { /* ไม่มีอะไรให้แสดง */ }

    return null;
}

const COLUMNS = [
    { key: 'played', label: 'P' },
    { key: 'won', label: 'W' },
    { key: 'lost', label: 'L' },
    { key: 'gameDiff', label: '+/-' },
    { key: 'points', label: 'PTS', cls: 'st-points' }
];

function cell(text, cls) {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    return td;
}

function groupCard(group, index) {
    const card = document.createElement('div');
    card.className = 'st-group';
    card.style.setProperty('--i', String(index));

    const name = document.createElement('div');
    name.className = 'st-group-name';
    name.textContent = `Group ${group.bracket}`;
    if (group.remaining > 0) {
        const left = document.createElement('span');
        left.className = 'st-group-note';
        left.textContent = group.remaining === 1 ? '1 match left' : `${group.remaining} matches left`;
        name.appendChild(left);
    }

    const table = document.createElement('table');
    table.className = 'st-table';

    const head = document.createElement('tr');
    head.appendChild(Object.assign(document.createElement('th'), { className: 'st-rank-col', textContent: '#' }));
    head.appendChild(Object.assign(document.createElement('th'), { className: 'st-name-col', textContent: 'Team' }));
    COLUMNS.forEach((col) => {
        head.appendChild(Object.assign(document.createElement('th'), { textContent: col.label }));
    });
    table.appendChild(head);

    group.rows.forEach((row, position) => {
        const tr = document.createElement('tr');
        tr.className = 'st-row';
        // เส้นตัดขีดตามตำแหน่งจริงในตาราง ไม่ใช่ตาม rank
        // สองทีมที่เสมอกันได้ rank เท่ากัน การขีดตาม rank จะได้เกินโควตา
        if (through > 0 && position < through) tr.classList.add('st-through');
        if (row.tied) tr.classList.add('st-tied');

        tr.appendChild(cell(String(row.rank), 'st-rank'));
        tr.appendChild(cell(row.name || '—', 'st-name'));
        COLUMNS.forEach((col) => {
            const value = row[col.key];
            const text = col.key === 'gameDiff' && value > 0 ? `+${value}` : String(value);
            tr.appendChild(cell(text, col.cls));
        });
        table.appendChild(tr);
    });

    card.append(name, table);
    card.addEventListener('animationend', () => card.classList.add('settled'), { once: true });
    return card;
}

// การันตีว่ากระดานจะถูกมองเห็น ต่อให้อนิเมชันไม่เคยเริ่มหรือไม่เคยจบ
// OBS หยุด browser source ที่ไม่ได้อยู่ในฉากที่ออกอากาศ
function settleSoon(count) {
    clearTimeout(settleTimer);
    const total = STAGGER_MS * Math.max(0, count - 1) + ENTER_MS + SAFETY_MS;
    settleTimer = setTimeout(() => {
        document.getElementById('stage').classList.add('settled');
    }, total);
}

// ย่อลงถ้ากลุ่มเยอะจนล้นผืน 1080
// เหตุผลและกับดักเหมือน overlay-prev.js: ย่ออย่างเดียว ไม่ขยายความกว้างชดเชย
function fitToStage() {
    const groups = document.getElementById('groups');
    groups.style.transform = '';

    const cards = groups.children;
    if (cards.length === 0) return;

    // วัดจากขอบบนของการ์ดใบแรก ไม่ใช่จากขอบบนของกล่อง
    //
    // ตอนวัด การ์ดทุกใบยังอยู่ที่เฟรมแรกของอนิเมชันเข้า ซึ่งเป็น translateY(24px)
    // (ดู .st-group ใน overlay-standings.css) ส่วนกล่องไม่ได้ถูกเลื่อน
    // วัดเทียบขอบกล่องจึงได้ค่าเกินมา 24px แล้วย่อทั้งกระดานทั้งที่ยังไม่ล้นจริง
    //
    // การ์ดเลื่อนลงเท่ากันทุกใบ วัดหัวถึงท้ายของการ์ดด้วยกันเองระยะเลื่อนจึงหักกันหมด
    // (บทเรียนเดียวกับ fitToStage ใน overlay-prev.js กับ overlay-teams.js
    //  ซึ่งแก้เรื่องนี้ไปแล้ว หน้านี้ยังค้างอยู่ที่เวอร์ชันเก่า)
    let lowest = -Infinity;
    let highest = Infinity;
    [...cards].forEach((card) => {
        const box = card.getBoundingClientRect();
        lowest = Math.max(lowest, box.bottom);
        highest = Math.min(highest, box.top);
    });
    const needed = lowest - highest;
    const available = groups.getBoundingClientRect().height;
    if (needed <= 0 || available <= 0 || needed <= available) return;

    const scale = available / needed;
    groups.style.transformOrigin = 'top center';
    groups.style.transform = `scale(${scale})`;
}

function columnsFor(count) {
    if (count <= 1) return 1;
    if (count <= 4) return 2;
    return 3;
}

function render(tournament, groups) {
    const box = document.getElementById('groups');
    box.textContent = '';
    document.getElementById('stage').classList.remove('settled');

    document.getElementById('title').textContent = params.get('title') || tournament.name || 'Standings';
    const finished = groups.every((g) => g.remaining === 0);
    document.getElementById('subtitle').textContent =
        params.get('subtitle') || (finished ? 'Final standings' : 'Group standings');
    document.title = `${tournament.name || 'Standings'} - ROV Overlay`;

    box.style.setProperty('--st-cols', String(columnsFor(groups.length)));
    box.style.setProperty('--st-stagger', `${STAGGER_MS}ms`);
    groups.forEach((group, index) => box.appendChild(groupCard(group, index)));

    window.RovOverlay.note(groups.length === 0 ? 'This tournament has no group stage.' : '');
    fitToStage();
    settleSoon(groups.length);
}

async function load() {
    const id = await resolveTournamentId();
    if (!id) {
        window.RovOverlay.note('No tournament found. Add ?tournament=<id> to this URL.');
        settleSoon(0);
        return;
    }

    try {
        const data = await getJson(`/api/tournaments/${encodeURIComponent(id)}/standings`);
        render(data.tournament || {}, data.groups || []);
    } catch (error) {
        window.RovOverlay.note('Could not load the standings.');
        settleSoon(0);
    }
}

load();
if (refreshSeconds > 0) setInterval(load, refreshSeconds * 1000);
