// ฮีโร่ที่สองทีมของคู่ที่ออกอากาศหยิบบ่อยสุดและโดนแบนบ่อยสุด "ในทัวร์นาเมนต์นี้"
//
// หน้าตาเหมือนกราฟิกหัวต่อหัวทุกอย่าง เพราะใช้แผ่นสไตล์เดียวกันจริงๆ
// (ดูคอมเมนต์ใน overlay-team-drafts.html) ต่างกันแค่ข้อมูลที่ใส่เข้าไป
//
// ทำไมต้องมีทั้งสองหน้า
//
//   หัวต่อหัว   นับเฉพาะเกมที่สองทีมนี้เจอกันเอง
//   หน้านี้     นับทุกเกมของแต่ละทีมในรายการนี้
//
// คู่ที่ไม่เคยเจอกันมาก่อนคือเรื่องปกติที่สุด (รอบแรกของทุกรายการ)
// หัวต่อหัวจะว่างทั้งกระดานตอนนั้น ส่วนหน้านี้ยังตอบได้ว่าแต่ละทีมชอบเล่นอะไร
// ซึ่งคือสิ่งที่คนพากย์อยากได้ก่อนเริ่มคู่จริงๆ
//
// พารามิเตอร์ที่รับ (ต่อท้าย URL ใน OBS ได้เลย):
//   ?a=<teamId>&b=<teamId>  ระบุคู่เอง ไม่ใส่ = คู่ที่กำลังออกอากาศ
//   ?tournament=<id>        ระบุรายการเอง ไม่ใส่ = รายการของคู่ที่ออกอากาศ
//   ?top=1..10              กี่ตัวต่อแถว ไม่ใส่ = 5
//   ?title= / ?subtitle=    เปลี่ยนข้อความหัว
//   ?refresh=<วินาที>       ดึงข้อมูลใหม่เป็นระยะ
//
// หน้านี้เป็นหน้าดูอย่างเดียว ต่อ socket เปล่าๆ ไม่ต้องมีโทเคน

const params = new URLSearchParams(window.location.search);

// overlay-size.js อ่านตัวแปรชื่อ socket ตัวนี้ ต้องประกาศก่อนไฟล์นั้นถูกโหลด
const socket = io();

const ENTER_MS = 520;
const SAFETY_MS = 900;

let settleTimer = null;
let lastSignature = null;

const refreshSeconds = window.RovOverlay.intParam(params, 'refresh', 0, 5, 3600);
// ชื่อ top ใช้ไม่ได้: สคริปต์แบบคลาสสิกอยู่บน global scope เดียวกับ window.top
// (overlay-analytics.js เรียกตัวนี้ว่า topCount ด้วยเหตุผลเดียวกัน)
const topCount = window.RovOverlay.intParam(params, 'top', 5, 1, 10);

function heroRow(list, banned) {
    const box = document.createElement('div');
    box.className = 'mu-heroes';

    if (list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'mu-empty';
        empty.textContent = 'No games on record';
        box.appendChild(empty);
        return box;
    }

    list.forEach((stat) => {
        const cell = document.createElement('div');
        cell.className = 'mu-hero';

        const art = document.createElement('div');
        art.className = banned ? 'mu-art banned' : 'mu-art';
        // ไอคอนก่อน ถอยไปรูปเต็มถ้าไม่มี (ดู lib/hero-art.js)
        window.RovHeroArt.paint(art, stat.hero);
        cell.appendChild(art);

        // จำนวนครั้ง ไม่ใช่เปอร์เซ็นต์
        //
        // กระดานสถิติใช้เปอร์เซ็นต์เพราะเทียบข้ามฮีโร่ทั้งรายการ
        // แต่ตรงนี้คนดูอยากรู้ว่า "ทีมนี้หยิบตัวนี้กี่ครั้ง" ซึ่งเป็นจำนวนนับ
        // และหารด้วยจำนวนเกมของทีมเดียวก็ได้ตัวเลขที่กระโดดแรงเวลาเล่นไปไม่กี่เกม
        const count = banned ? stat.banned : stat.picked;
        if (count > 1) {
            const badge = document.createElement('div');
            badge.className = 'mu-count';
            badge.textContent = `x${count}`;
            cell.appendChild(badge);
        }

        box.appendChild(cell);
    });

    return box;
}

function sideCard(side, which) {
    const card = document.createElement('div');
    card.className = `mu-side ${which}`;

    const name = document.createElement('div');
    name.className = 'mu-side-name';
    name.textContent = side.name || (which === 'blue' ? 'BLUE' : 'RED');

    const pickLabel = document.createElement('div');
    pickLabel.className = 'mu-label';
    pickLabel.textContent = 'Most picked';

    const banLabel = document.createElement('div');
    banLabel.className = 'mu-label';
    // "โดยทีมนี้" ไม่ใช่ "ใส่ทีมนี้"
    //
    // analytics.read({ teamId }) กรองช่องด้วยฝั่งที่ทีมนั้นเล่นอยู่
    // ช่องแบนฝั่งน้ำเงินคือแบนที่ทีมน้ำเงินเป็นคนกด ไม่ใช่แบนที่โดนใส่
    // (กราฟิกหัวต่อหัวนับแบบเดียวกันและใช้คำเดียวกัน ดู matchup.ts)
    banLabel.textContent = 'Most banned by them';

    card.append(
        name,
        pickLabel, heroRow(side.topPicks || [], false),
        banLabel, heroRow(side.topBans || [], true)
    );
    return card;
}

// การันตีว่ากระดานจะถูกมองเห็น ต่อให้อนิเมชันไม่เคยเริ่มหรือไม่เคยจบ
// OBS หยุด browser source ที่ไม่ได้อยู่ในฉากที่ออกอากาศ
function settleSoon() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
        document.getElementById('stage').classList.add('settled');
    }, ENTER_MS + SAFETY_MS);
}

function render(data) {
    // ข้อความแจ้งเตือนต้องถูกตัดสินใหม่ทุกครั้งที่โหลดสำเร็จ ไม่ใช่เฉพาะตอนข้อมูลเปลี่ยน
    //
    // ต้องอยู่ "เหนือ" ด่านลายเซ็นข้างล่าง วัดมาแล้ว: ดึงพลาดหนึ่งครั้งจะขึ้น
    // "Could not load the team picks and bans." แล้วการดึงรอบถัดไปที่สำเร็จ
    // ได้ข้อมูลชุดเดิม ลายเซ็นจึงเท่าเดิม แล้วออกตั้งแต่บรรทัดล่างนี้
    // ผลคือข้อความว่าโหลดไม่ได้ค้างอยู่บนออกอากาศตลอดไป ทั้งที่ข้อมูลมาครบแล้ว
    // (ยิ่งเป็นจริงเมื่อใช้ ?refresh= ซึ่งเป็นท่าของกระดานที่เปิดค้างไว้ทั้งงาน)
    const nothing = data.a.games === 0 && data.b.games === 0;
    window.RovOverlay.note(nothing ? 'Neither team has a recorded draft in this tournament yet.' : '');

    // วาดใหม่เฉพาะตอนข้อมูลเปลี่ยนจริง
    // หน้านี้ดึงซ้ำได้จาก ?refresh= การวาดใหม่ทุกครั้งแปลว่าอนิเมชันเข้าเล่นซ้ำเรื่อยๆ
    const signature = JSON.stringify(data);
    if (signature === lastSignature) return;
    lastSignature = signature;

    document.getElementById('stage').classList.remove('settled');

    document.getElementById('title').textContent =
        params.get('title') || `${data.a.name} vs ${data.b.name}`;
    document.getElementById('subtitle').textContent =
        params.get('subtitle') || data.tournament.name || 'Picks and bans';
    document.title = `${data.a.name} vs ${data.b.name} - ROV Overlay`;

    document.getElementById('nameA').textContent = data.a.name || 'BLUE';
    document.getElementById('nameB').textContent = data.b.name || 'RED';

    // ช่องกลางเป็นจำนวนเกมที่แต่ละทีมลงในรายการนี้ ไม่ใช่คะแนนหัวต่อหัว
    // รูปทรงเดียวกับกราฟิกหัวต่อหัว แต่ตอบคนละคำถาม จึงต้องมีบรรทัดกำกับข้างล่างเสมอ
    const numA = document.getElementById('numA');
    const numB = document.getElementById('numB');
    numA.textContent = String(data.a.games);
    numB.textContent = String(data.b.games);
    numA.classList.remove('lead');
    numB.classList.remove('lead');

    document.getElementById('scope').textContent = data.tournament.name
        ? `Games played in ${data.tournament.name}`
        : 'Games played in this tournament';

    const cols = document.getElementById('cols');
    cols.textContent = '';
    cols.append(sideCard(data.a, 'blue'), sideCard(data.b, 'red'));

    settleSoon();
}

async function load() {
    const query = [];
    ['a', 'b', 'tournament'].forEach((key) => {
        if (params.get(key)) query.push(`${key}=${encodeURIComponent(params.get(key))}`);
    });
    query.push(`top=${topCount}`);

    try {
        const response = await fetch(`/api/team-drafts?${query.join('&')}`);
        if (!response.ok) {
            window.RovOverlay.note('No match is on air yet.');
            settleSoon();
            return;
        }
        render(await response.json());
    } catch (error) {
        window.RovOverlay.note('Could not load the team picks and bans.');
        settleSoon();
    }
}

load();
if (refreshSeconds > 0) setInterval(load, refreshSeconds * 1000);
