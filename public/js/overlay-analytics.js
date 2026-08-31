// Overlay กระดานสถิติ pick/ban ของทัวร์นาเมนต์หนึ่ง เอาไว้ขึ้นจอระหว่างพัก
//
// เสิร์ฟที่ /overlay-analytics ไม่ใช่ /analytics
// /analytics ถูกใช้เป็นหน้าสถิติของคนคุมงานไปแล้วตั้งแต่ Phase 8
// (กฎเดียวกับ /overlay-teams กับ /teams)
//
// พารามิเตอร์ที่รับ (ต่อท้าย URL ใน OBS ได้เลย):
//   ?tournament=<id>    ทัวร์นาเมนต์ที่จะแสดง ไม่ใส่ = ตามแมตช์ที่ออกอากาศ
//   ?mode=presence|pick|ban|win   จัดอันดับด้วยอะไร ไม่ใส่ = presence
//   ?top=1..20          กี่อันดับ ไม่ใส่ = 10
//   ?columns=1|2        จำนวนคอลัมน์ ไม่ใส่ = เลือกให้ตามจำนวนแถว
//   ?title=             เปลี่ยนหัวข้อ ไม่ใส่ = ชื่อทัวร์นาเมนต์
//   ?subtitle=          เปลี่ยนบรรทัดรอง ไม่ใส่ = ชื่อโหมด
//   ?minGames=<n>       ขั้นต่ำของเกมที่รู้ผล เฉพาะโหมด win ไม่ใส่ = 3
//   ?stagger=<ms>       ระยะห่างของการไล่เข้าทีละแถว ไม่ใส่ = 90ms
//   ?refresh=<วินาที>   ดึงข้อมูลใหม่เป็นรอบ ไม่ใส่ = ดึงครั้งเดียวตอนเปิด
//
// ทำไมไม่เข้าห้องสัญญาณ 'data' ที่หน้าคนคุมงานใช้:
// overlay ไม่เข้าห้องนั้นเป็นกฎของโปรเจกต์ (ดู CLAUDE.md) และตรงนี้ก็ไม่ได้อยากได้จริง
// ตัวเลขขยับตอนดราฟต์ล็อก ซึ่งเป็นจังหวะที่กระดานนี้ไม่ได้อยู่บนจอ
// และ OBS หยุด browser source ที่ไม่ได้ออกอากาศอยู่แล้ว สัญญาณจึงไปไม่ถึงตอนนั้นด้วยซ้ำ
// ท่าที่ใช้จริงคือให้ OBS ติ๊ก "Refresh browser when scene becomes active"
// ส่วน ?refresh= มีไว้สำหรับคนที่วางกระดานค้างไว้ทั้งงาน
//
// หน้านี้เป็นหน้าดูอย่างเดียว ต่อ socket เปล่าๆ ไม่ต้องมีโทเคน
// เหมือน /overlay กับ /overlay-teams และไม่ได้ใช้ app-client.js

const params = new URLSearchParams(window.location.search);

// overlay-size.js ไปอ่านตัวแปรชื่อ socket ตัวนี้ ต้องประกาศไว้ก่อนไฟล์นั้นถูกโหลด
const socket = io();

// ต้องตรงกับ overlay-analytics.css ถ้าแก้ที่ CSS แล้วลืมแก้ที่นี่
// ตัวจับเวลาสำรองจะทำงานก่อนอนิเมชันจบ แล้วจะเห็นแถวกระตุกตอนถูกบังคับสถานะ
const ROW_ENTER_MS = 520;
const BAR_DELAY_MS = 220;
const BAR_GROW_MS = 900;
const SAFETY_MS = 700;
const DEFAULT_STAGGER = 90;
const DEFAULT_TOP = 10;

// เวลาไล่เข้าทั้งชุดต้องไม่ยืดเกินไป กราฟิกช่วงพักมีเวลาไม่กี่วินาที
const MAX_TOTAL_STAGGER_MS = 1600;

const MODES = {
    presence: { label: 'Presence', accent: '#f5b942', accent2: '#fde68a' },
    pick: { label: 'Most picked', accent: '#3b82f6', accent2: '#93c5fd' },
    ban: { label: 'Most banned', accent: '#ef4444', accent2: '#fca5a5' },
    win: { label: 'Win rate', accent: '#22c55e', accent2: '#86efac' }
};

let settleTimer = null;
let refreshTimer = null;
let countdowns = [];

// ระวัง: Number(null) เป็น 0 และ 0 ก็ผ่าน Number.isFinite
// เช็คแค่ isFinite อย่างเดียว พารามิเตอร์ที่ไม่ได้ใส่มาจะกลายเป็น 0 ไม่ใช่ค่าเริ่มต้น
// เคยเป็นบั๊กจริงใน /overlay-teams: stagger กลายเป็น 0 แล้วการ์ดเข้าพร้อมกันหมด
// โดยไม่มีอะไรพัง จึงมองไม่เห็นจนกว่าจะจ้องดู
function intParam(name, fallback, min, max) {
    const value = params.get(name);
    if (value === null || value.trim() === '') return fallback;
    const raw = Number(value);
    if (!Number.isFinite(raw)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(raw)));
}

const stagger = intParam('stagger', DEFAULT_STAGGER, 0, 1000);
const topCount = intParam('top', DEFAULT_TOP, 1, 20);
const mode = MODES[params.get('mode')] ? params.get('mode') : 'presence';

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
function note(message) {
    const el = document.getElementById('note');
    el.textContent = message || '';
    el.hidden = !message;
}

const pct = (value) => (value * 100).toFixed(1) + '%';

// เลือกทัวร์นาเมนต์: ระบุมาเอง > ตามแมตช์ที่ออกอากาศ > รายการล่าสุด
//
// การตามแมตช์ที่ออกอากาศทำให้ URL เดียวใช้ได้ทั้งงานโดยไม่ต้องแก้ใน OBS
// ส่วน URL ที่ก๊อปจากหน้าทัวร์นาเมนต์จะมี id ติดมาแล้ว เพราะคนก๊อปเจาะจงรายการนั้น
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

function placeholderFace(hero) {
    const box = document.createElement('div');
    box.className = 'an-face placeholder';
    box.textContent = (hero || '?').slice(0, 2).toUpperCase();
    return box;
}

// ชื่อฮีโร่คือชื่อไฟล์ภาพ (ดู domain/heroes.ts)
// ประวัติเก่าอาจอ้างไฟล์ที่ถูกเปลี่ยนชื่อไปแล้ว ภาพหายต้องไม่ทิ้งกรอบว่างไว้กลางกราฟิก
function faceNode(hero) {
    const img = document.createElement('img');
    img.className = 'an-face';
    img.alt = '';
    img.src = '/images/heroes/' + encodeURIComponent(hero) + '.png';
    img.addEventListener('error', () => img.replaceWith(placeholderFace(hero)), { once: true });
    return img;
}

function statBlock(value, label, extraClass) {
    const wrap = document.createElement('div');
    wrap.className = 'an-stat' + (extraClass ? ' ' + extraClass : '');

    const number = document.createElement('div');
    number.className = 'an-value';
    number.textContent = value;

    const caption = document.createElement('div');
    caption.className = 'an-label';
    caption.textContent = label;

    wrap.append(number, caption);
    return wrap;
}

// ค่าที่แถบและตัวเลขหลักของแถวใช้ ต้องตรงกับ rankHeroes() ฝั่งเซิร์ฟเวอร์
// ถ้าสองที่นี้ไม่ตรงกัน กระดานจะเรียงตามอย่างหนึ่งแต่วาดแถบตามอีกอย่าง
function leadRate(stat) {
    if (mode === 'pick') return stat.pickRate;
    if (mode === 'ban') return stat.banRate;
    if (mode === 'win') return stat.winRate === null ? 0 : stat.winRate;
    return stat.presence;
}

// สเกลของแถบ: เทียบกับตัวที่สูงที่สุดในกระดาน ไม่ใช่เทียบกับ 100%
//
// ฮีโร่ที่ดังที่สุดในรายการอยู่ราวๆ 30-40% ของเกม ถ้าสเกลเต็ม 100%
// ทุกแถบจะสั้นและยาวเกือบเท่ากันหมด ซึ่งไม่ได้บอกอะไรคนดูเลย
// โหมด win ต่างออกไป: 50% คือเส้นแบ่งที่มีความหมายจริง จึงคงสเกล 0-100 ไว้
function barWidth(stat, peak) {
    const value = leadRate(stat);
    if (mode === 'win') return Math.max(0, Math.min(100, value * 100));
    if (peak <= 0) return 0;
    return Math.max(2, Math.min(100, (value / peak) * 100));
}

// ตัวเลขไต่ขึ้นจาก 0 ไปหาค่าจริง
//
// requestAnimationFrame ไม่เดินตอน OBS หยุด source ที่ไม่ได้ออกอากาศ
// ตัวไต่จึงค้างอยู่ที่เลขกลางทางได้ settleNow() เป็นตัวเขียนค่าสุดท้ายลงไปเสมอ
// เก็บ element กับข้อความปลายทางไว้ในลิสต์ เพื่อให้บังคับทีเดียวได้ทั้งกระดาน
function countUp(el, to, format, delay) {
    const finalText = format(to);
    countdowns.push({ el, finalText });
    el.textContent = format(0);

    const started = performance.now() + delay;
    const step = (now) => {
        if (now < started) { requestAnimationFrame(step); return; }
        const progress = Math.min(1, (now - started) / BAR_GROW_MS);
        // easing เดียวกับแถบ ตัวเลขกับแถบจึงหยุดพร้อมกัน
        const eased = 1 - Math.pow(1 - progress, 3);
        el.textContent = format(to * eased);
        if (progress < 1) requestAnimationFrame(step);
        else el.textContent = finalText;
    };
    requestAnimationFrame(step);
}

function row(stat, index, peak, step) {
    const el = document.createElement('div');
    el.className = 'an-row' + (index < 3 ? ' top' : '');
    el.style.setProperty('--i', String(index));
    el.style.setProperty('--accent', MODES[mode].accent);
    el.style.setProperty('--accent-2', MODES[mode].accent2);
    el.style.setProperty('--w', barWidth(stat, peak) + '%');

    const rank = document.createElement('div');
    rank.className = 'an-rank';
    rank.textContent = String(index + 1);

    const id = document.createElement('div');
    id.className = 'an-id';

    const name = document.createElement('div');
    name.className = 'an-name';
    name.textContent = stat.hero;

    const meter = document.createElement('div');
    meter.className = 'an-meter';
    const fill = document.createElement('div');
    fill.className = 'an-fill';
    meter.appendChild(fill);

    id.append(name, meter);

    const figures = document.createElement('div');
    figures.className = 'an-figures';

    const lead = statBlock('0.0%', MODES[mode].label, 'lead');
    figures.appendChild(lead);
    countUp(lead.querySelector('.an-value'), leadRate(stat), pct, index * step + BAR_DELAY_MS);

    // ตัวเลขประกอบ เลือกให้ไม่ซ้ำกับตัวเลขหลักของโหมด
    // ซ้ำแล้วจะกินที่ว่างไปโดยไม่ได้บอกอะไรเพิ่ม
    if (mode !== 'pick') figures.appendChild(statBlock(pct(stat.pickRate), 'Pick'));
    if (mode !== 'ban') figures.appendChild(statBlock(pct(stat.banRate), 'Ban'));

    if (mode !== 'win') {
        // winRate เป็น null = ยังไม่มีเกมที่รู้ผล ต่างจาก 0% ซึ่งแปลว่าลงแล้วแพ้ล้วน
        // ขีดกลางบอกว่า "ยังไม่รู้" ซึ่งซื่อสัตย์กว่าการโชว์ 0%
        const win = statBlock(stat.winRate === null ? '—' : pct(stat.winRate), 'Win', 'win');
        if (stat.winRate !== null) {
            win.querySelector('.an-value').classList.add(stat.winRate >= 0.5 ? 'good' : 'bad');
        }
        figures.appendChild(win);
    }

    el.append(rank, faceNode(stat.hero), id, figures);
    return el;
}

// การันตีว่ากระดานจะถูกมองเห็น ต่อให้อนิเมชันไม่เคยเริ่มหรือไม่เคยจบ
//
// OBS หยุด browser source ที่ไม่ได้อยู่ในฉากที่ออกอากาศ อนิเมชันจึงค้างได้
// และ animationend จะไม่ยิงเลย ทุกแถวเริ่มจาก opacity:0 และทุกแถบเริ่มจาก width:0
// ถ้าไม่มีตัวนี้ ผลลัพธ์คือกระดานเปล่าหรือกระดานที่ทุกแถบเป็นศูนย์ออกอากาศ
// ซึ่งแย่กว่าการข้ามอนิเมชันไปเลย
function settleNow() {
    document.getElementById('stage').classList.add('settled');
    countdowns.forEach(({ el, finalText }) => { el.textContent = finalText; });
}

function settleSoon(count, step) {
    clearTimeout(settleTimer);
    const total = step * Math.max(0, count - 1)
        + Math.max(ROW_ENTER_MS, BAR_DELAY_MS + BAR_GROW_MS) + SAFETY_MS;
    settleTimer = setTimeout(settleNow, total);
}

// ย่อทั้งกระดานลงถ้าแถวเยอะจนล้นผืน 1080
//
// วัดจากขอบล่างของแถวสุดท้ายจริงๆ ไม่ใช่ scrollHeight
// board ตัวนี้ overflow เป็น visible เนื้อหาที่ล้นจึงไม่ได้อยู่ในเขตที่เลื่อนได้
// scrollHeight จะคืนค่าเท่ากับ clientHeight เสมอ แปลว่า "ไม่ล้น" ตลอด
// เคยเขียนแบบนั้นใน /overlay-teams แล้วตัวย่อไม่เคยทำงานเลย
function fitToStage() {
    const board = document.getElementById('board');
    const stage = document.getElementById('stage');
    board.style.transform = '';
    board.style.width = '';
    board.classList.remove('overflowing');

    const rows = board.children;
    if (rows.length === 0) return;

    const boardBox = board.getBoundingClientRect();
    const stageStyle = getComputedStyle(stage);
    const available = stage.getBoundingClientRect().bottom
        - parseFloat(stageStyle.paddingBottom) - boardBox.top;

    // วัดความสูงจริงของแถวทั้งชุด ไม่ใช่จากขอบบนของ board
    // ตอนจัดกลางแนวตั้ง แถวแรกไม่ได้เริ่มที่ขอบบนของ board และถ้าล้น
    // มันจะล้นออกไปทางบนด้วย ระยะจากขอบบนของ board จึงน้อยกว่าความจริง
    const first = rows[0].getBoundingClientRect().top;
    const last = rows[rows.length - 1].getBoundingClientRect().bottom;
    const needed = last - first;

    if (needed <= 0 || available <= 0 || needed <= available) return;

    // ล้นแล้ว: เลิกจัดกลาง กลับไปเกาะขอบบน แล้วค่อยย่อจากจุดนั้น
    board.classList.add('overflowing');

    const scale = available / needed;
    // ขยายความกว้างชดเชยก่อนย่อ ไม่งั้นกระดานจะหดเข้าทางซ้ายเหลือที่ว่างทางขวา
    board.style.width = (100 / scale) + '%';
    board.style.transformOrigin = 'top left';
    board.style.transform = 'scale(' + scale + ')';
}

function columnsFor(count) {
    if (params.get('columns')) return intParam('columns', 1, 1, 2);
    return count > 12 ? 2 : 1;
}

function render(tournament, summary, heroes) {
    const board = document.getElementById('board');
    const stage = document.getElementById('stage');

    // เริ่มรอบใหม่ทุกครั้ง ไม่งั้น .settled ของรอบก่อนจะกดอนิเมชันรอบนี้ทิ้งทั้งชุด
    stage.classList.remove('settled');
    countdowns = [];
    board.textContent = '';

    const step = staggerFor(heroes.length);
    stage.style.setProperty('--stagger', step + 'ms');

    document.getElementById('title').textContent = params.get('title') || tournament.name || '';
    document.getElementById('subtitle').textContent = params.get('subtitle') || MODES[mode].label;
    document.title = (tournament.name || 'Analytics') + ' - ROV Analytics';

    // จำนวนเกมต้องอยู่บนจอเสมอ เปอร์เซ็นต์ที่ไม่บอกว่าหารด้วยอะไรอ่านผิดได้ทุกทาง
    const games = summary ? summary.games : 0;
    const meta = games === 1 ? '1 game' : games + ' games';
    document.getElementById('meta').textContent = mode === 'win' && summary
        ? meta + ' · ' + summary.decidedGames + ' with a winner'
        : meta;

    board.style.setProperty('--cols', String(columnsFor(heroes.length)));
    // เกินแปดแถวเริ่มแน่น ลดขนาดแถวก่อน แล้วค่อยให้ fitToStage() ย่อทั้งกระดานถ้ายังไม่พอ
    // ย่อทั้งกระดานทำให้ตัวหนังสือเล็กลงตามไปด้วย การลดระยะขอบก่อนจึงอ่านง่ายกว่า
    board.classList.toggle('dense', heroes.length > 8);

    const peak = heroes.reduce((max, stat) => Math.max(max, leadRate(stat)), 0);
    heroes.forEach((stat, index) => board.appendChild(row(stat, index, peak, step)));

    if (games === 0) note('No completed drafts in this tournament yet.');
    else if (heroes.length === 0) note('Nothing to rank in this mode yet.');
    else note('');

    fitToStage();

    // แถบโตด้วย transition จึงต้องให้เบราว์เซอร์เห็นความกว้าง 0 ก่อนหนึ่งเฟรม
    // เติมคลาสในเฟรมเดียวกับที่สร้าง element แล้วมันจะกระโดดไปค่าปลายทางทันที
    requestAnimationFrame(() => {
        [...board.children].forEach((el) => el.classList.add('grow'));
    });

    settleSoon(heroes.length, step);
}

async function load() {
    const id = await resolveTournamentId();
    if (!id) {
        note('No tournament found. Create one, or add ?tournament=<id> to this URL.');
        settleNow();
        return;
    }

    const query = new URLSearchParams({
        tournamentId: id,
        mode,
        top: String(topCount)
    });
    if (params.get('minGames')) query.set('minDecided', String(intParam('minGames', 3, 0, 999)));

    try {
        const [tournamentData, analytics] = await Promise.all([
            getJson('/api/tournaments/' + encodeURIComponent(id)),
            getJson('/api/analytics?' + query.toString())
        ]);
        render(tournamentData.tournament || {}, analytics.summary, analytics.heroes || []);
    } catch (error) {
        note('Could not load the statistics for that tournament.');
        settleNow();
    }
}

// ดึงซ้ำเป็นรอบ สำหรับคนที่วางกระดานค้างไว้ทั้งงาน
// ไม่ใช่ค่าเริ่มต้น: ท่าปกติคือให้ OBS รีเฟรชตอนสลับเข้าฉาก ซึ่งได้ข้อมูลสดโดยไม่ต้องวน
const refreshSeconds = intParam('refresh', 0, 5, 3600);
if (params.get('refresh') && refreshSeconds > 0) {
    refreshTimer = setInterval(load, refreshSeconds * 1000);
}

load();
