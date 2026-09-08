// Overlay รายชื่อทีมที่ลงแข่ง เอาไว้เปิดก่อนเริ่มงาน
//
// เสิร์ฟที่ /overlay-teams ไม่ใช่ /teams
// /teams ถูกใช้เป็นหน้าทะเบียนทีมของคนคุมงานไปแล้วตั้งแต่ Phase 6
//
// พารามิเตอร์ที่รับ (ต่อท้าย URL ใน OBS ได้เลย):
//   ?tournament=<id>   ทัวร์นาเมนต์ที่จะแสดง ไม่ใส่ = ตามแมตช์ที่ออกอากาศ
//   ?title=            เปลี่ยนหัวข้อ ไม่ใส่ = ชื่อทัวร์นาเมนต์
//   ?subtitle=         เปลี่ยนบรรทัดรอง ไม่ใส่ = จำนวนทีม
//   ?columns=1..6      บังคับจำนวนคอลัมน์ ไม่ใส่ = เลือกให้ตามจำนวนทีม
//   ?roster=off        ไม่ต้องแสดงรายชื่อผู้เล่น
//   ?stagger=<ms>      ระยะห่างของการไล่เข้าทีละใบ ไม่ใส่ = 90ms
//
// หน้านี้เป็นหน้าดูอย่างเดียว ต่อ socket เปล่าๆ ไม่ต้องมีโทเคน
// เหมือน /overlay กับ /result และไม่ได้ใช้ app-client.js

const params = new URLSearchParams(window.location.search);

// overlay-size.js ไปอ่านตัวแปรชื่อ socket ตัวนี้ ต้องประกาศไว้ก่อนไฟล์นั้นถูกโหลด
const socket = io();

// ต้องตรงกับ overlay-teams.css ถ้าแก้ที่ CSS แล้วลืมแก้ที่นี่
// ตัวจับเวลาสำรองจะทำงานก่อนอนิเมชันจบ แล้วจะเห็นการ์ดกระตุกตอนถูกบังคับสถานะ
const ENTER_MS = 560;
const SAFETY_MS = 700;
const DEFAULT_STAGGER = 90;

let settleTimer = null;


const stagger = window.RovOverlay.intParam(params, 'stagger', DEFAULT_STAGGER, 0, 1000);


// เวลาไล่เข้าทั้งชุดต้องไม่ยืดเกินไปเมื่อทีมเยอะ
//
// 90ms x 64 ทีม = เกือบหกวินาทีกว่าใบสุดท้ายจะโผล่ ซึ่งนานเกินสำหรับกราฟิกก่อนเริ่มงาน
// จึงบีบระยะห่างลงให้ทั้งชุดจบในราวสองวินาทีครึ่ง
// ถ้าผู้ใช้ระบุ ?stagger= มาเอง ให้เคารพค่านั้น เขาตั้งใจเลือกแล้ว
const MAX_TOTAL_STAGGER_MS = 2200;

function staggerFor(count) {
    if (params.get('stagger')) return stagger;
    if (count <= 1) return stagger;
    return Math.min(stagger, Math.floor(MAX_TOTAL_STAGGER_MS / (count - 1)));
}
async function getJson(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(url + ' returned ' + response.status);
    return response.json();
}

// ข้อความช่วยตอนตั้งค่า จงใจให้จาง ถ้าหลุดออกอากาศจะได้ไม่เด่น


// เลือกทัวร์นาเมนต์: ระบุมาเอง > ตามแมตช์ที่ออกอากาศ > รายการล่าสุด
//
// การตามแมตช์ที่ออกอากาศทำให้ URL เดียวใช้ได้ทั้งงานโดยไม่ต้องแก้ใน OBS
async function resolveTournamentId() {
    const given = params.get('tournament') || params.get('tournamentId');
    if (given) return given;

    try {
        const data = await getJson('/api/live-match');
        if (data.live && data.live.tournamentId) return data.live.tournamentId;
    } catch (error) {
        /* ยังไม่เคยเปิดแมตช์ไหนก็ไม่เป็นไร ไปดูรายการต่อ */
    }

    try {
        const data = await getJson('/api/tournaments');
        const newest = (data.tournaments || [])[0];   // API เรียงใหม่สุดมาก่อน
        if (newest) return newest.id;
    } catch (error) {
        /* ไม่มีอะไรให้แสดง ผู้เรียกจะขึ้นข้อความบอกเอง */
    }

    return null;
}

function placeholderLogo(team) {
    const box = document.createElement('div');
    box.className = 'tl-logo placeholder';
    box.textContent = (team.tag || team.name || '?').slice(0, 3).toUpperCase();
    return box;
}

function logoNode(team) {
    if (!team.logo || !team.logo.v || !team.logo.ext) return placeholderLogo(team);

    const img = document.createElement('img');
    img.className = 'tl-logo';
    img.alt = '';
    img.src = '/images/team-logos/' + encodeURIComponent(team.id) + '.' + team.logo.ext
        + '?v=' + team.logo.v;
    // ไฟล์หายไม่ควรทิ้งช่องโหว่ไว้กลางกราฟิก สลับไปใช้ตัวย่อแทน
    img.addEventListener('error', () => img.replaceWith(placeholderLogo(team)), { once: true });
    return img;
}

// จำนวนคอลัมน์ตามจำนวนทีม กว้างที่ใช้ได้คือ 1736px (1920 ลบขอบสองข้าง)
function columnsFor(count) {
    if (params.get('columns')) return window.RovOverlay.intParam(params, 'columns', 3, 1, 6);
    if (count <= 8) return 2;
    if (count <= 18) return 3;
    if (count <= 32) return 4;
    return 5;
}

function teamCard(team, index, showRoster) {
    const card = document.createElement('div');
    card.className = 'tl-card';
    card.style.setProperty('--i', String(index));

    const id = document.createElement('div');
    id.className = 'tl-id';

    const name = document.createElement('div');
    name.className = 'tl-name';
    name.textContent = team.name;
    id.appendChild(name);

    if (team.tag) {
        const tag = document.createElement('span');
        tag.className = 'tl-tag';
        tag.textContent = team.tag;
        id.appendChild(tag);
    }

    if (showRoster) {
        const named = (team.players || []).filter((player) => player.name);
        if (named.length > 0) {
            const roster = document.createElement('div');
            roster.className = 'tl-roster';
            named.forEach((player) => {
                const el = document.createElement('span');
                el.className = 'tl-player' + (player.isCaptain ? ' captain' : '');
                el.textContent = player.name;
                roster.appendChild(el);
            });
            id.appendChild(roster);
        }
    }

    card.append(logoNode(team), id);

    // ทางลัดตอนอนิเมชันได้เล่นจริง ตัวจับเวลาข้างล่างเป็นตัวการันตี ไม่ใช่ตัวนี้
    card.addEventListener('animationend', () => card.classList.add('settled'), { once: true });
    return card;
}

// การันตีว่ารายชื่อจะถูกมองเห็น ต่อให้อนิเมชันไม่เคยเริ่มหรือไม่เคยจบ
//
// OBS หยุด browser source ที่ไม่ได้อยู่ในฉากที่ออกอากาศ อนิเมชันจึงค้างได้
// และ animationend จะไม่ยิงเลย การ์ดทุกใบเริ่มจาก opacity:0
// ถ้าไม่มีตัวนี้ ผลลัพธ์คือจอว่างเปล่าออกอากาศ ซึ่งแย่กว่าการข้ามอนิเมชันไปเลย
function settleSoon(count, step = stagger) {
    clearTimeout(settleTimer);
    const total = step * Math.max(0, count - 1) + ENTER_MS + SAFETY_MS;
    settleTimer = setTimeout(() => {
        document.getElementById('stage').classList.add('settled');
    }, total);
}


// ย่อทั้งตารางลงถ้าจำนวนทีมมากจนล้นผืน 1080
//
// ทัวร์นาเมนต์รับได้ถึง 128 ทีม แต่ผืนจอสูงเท่าเดิม
// ถ้าไม่ย่อ การ์ดที่เกินจะถูก overflow:hidden ตัดทิ้งเงียบๆ
// ซึ่งบนกราฟิกออกอากาศแปลว่ามีทีมหายไปจากรายชื่อโดยไม่มีใครรู้
// ย่อให้เล็กลงอ่านยากขึ้น ยังดีกว่าทีมท้ายๆ ไม่ได้ขึ้นจอเลย
function fitToStage() {
    const grid = document.getElementById('grid');
    const stage = document.getElementById('stage');
    grid.style.transform = '';
    grid.style.width = '';

    const cards = grid.children;
    if (cards.length === 0) return;

    // วัดจากขอบล่างของการ์ดใบสุดท้ายจริงๆ ไม่ใช่ scrollHeight
    //
    // grid ตัวนี้ overflow เป็น visible เนื้อหาที่ล้นจึงไม่ได้อยู่ในเขตที่เลื่อนได้
    // scrollHeight จะคืนค่าเท่ากับ clientHeight เสมอ แปลว่า "ไม่ล้น" ตลอด
    // เคยเขียนแบบนั้นแล้วตัวย่อไม่เคยทำงานเลย ทั้งที่การ์ดล้นออกไปนอกจอจริง
    const gridTop = grid.getBoundingClientRect().top;
    const needed = cards[cards.length - 1].getBoundingClientRect().bottom - gridTop;

    // padding จาก getComputedStyle เป็นค่าก่อนถูกสเกล พิกัดจาก rect เป็นค่าหลังสเกล
    //
    // โหมด 1440 ขยายทั้งเวทีด้วย 4/3 ขอบล่าง 62px จึงกินที่จริง 82.7px
    // เอาสองหน่วยนี้มาลบกันตรงๆ ทำให้ "ที่ว่าง" เกินจริงไป 21px
    // ผลคือตอนที่ตัวย่อทำงาน การ์ดแถวสุดท้ายถูกตัดหายไปนิดหนึ่งเฉพาะที่ 1440
    // offsetHeight เป็นความสูงตามผัง ส่วน rect.height เป็นความสูงที่เห็นจริง
    // อัตราส่วนของสองค่านี้คือสเกลที่กำลังถูกใช้อยู่
    const stageRect = stage.getBoundingClientRect();
    const stageScale = stage.offsetHeight ? stageRect.height / stage.offsetHeight : 1;
    const stageStyle = getComputedStyle(stage);
    const available = stageRect.bottom
        - parseFloat(stageStyle.paddingBottom) * stageScale - gridTop;

    if (needed <= 0 || available <= 0 || needed <= available) return;

    const scale = available / needed;
    // ขยายความกว้างชดเชยก่อนย่อ ไม่งั้นตารางจะหดเข้าทางซ้ายเหลือที่ว่างทางขวา
    grid.style.width = (100 / scale) + '%';
    grid.style.transformOrigin = 'top left';
    grid.style.transform = 'scale(' + scale + ')';
}
function render(tournament, teams) {
    const grid = document.getElementById('grid');
    grid.textContent = '';

    const step = staggerFor(teams.length);
    document.getElementById('stage').style.setProperty('--stagger', step + 'ms');
    document.getElementById('title').textContent = params.get('title') || tournament.name || '';
    document.getElementById('subtitle').textContent = params.get('subtitle')
        || (teams.length === 1 ? '1 team' : teams.length + ' teams');
    document.title = (tournament.name || 'Teams') + ' - ROV Team List';

    grid.style.setProperty('--cols', String(columnsFor(teams.length)));
    grid.classList.toggle('dense', teams.length > 12);

    const showRoster = params.get('roster') !== 'off' && teams.length <= 12;
    teams.forEach((team, index) => grid.appendChild(teamCard(team, index, showRoster)));

    window.RovOverlay.note(teams.length === 0 ? 'No teams have been added to this tournament yet.' : '');
    fitToStage();
    settleSoon(teams.length, step);
}

async function load() {
    const id = await resolveTournamentId();
    if (!id) {
        window.RovOverlay.note('No tournament found. Create one, or add ?tournament=<id> to this URL.');
        settleSoon(0);
        return;
    }

    try {
        const data = await getJson('/api/tournaments/' + encodeURIComponent(id));
        render(data.tournament || {}, data.teams || []);
    } catch (error) {
        window.RovOverlay.note('Could not load that tournament.');
        settleSoon(0);
    }
}

load();
