// หัวต่อหัว: สองทีมนี้เคยเจอกันมาแล้วยังไง
//
// ทุกตัวเลขในหน้านี้อ่านจากดราฟต์และผู้ชนะรายเกมที่แอพเก็บอยู่แล้วตั้งแต่ Phase 5
// ไม่มีข้อมูลใหม่ที่ต้องกรอกเพิ่มเลย มันแค่ไม่เคยถูกเอาขึ้นจอ
//
// พารามิเตอร์ที่รับ (ต่อท้าย URL ใน OBS ได้เลย):
//   ?a=<teamId>&b=<teamId>  ระบุคู่เอง ไม่ใส่ = คู่ที่กำลังออกอากาศ
//   ?title=                 เปลี่ยนหัวเรื่อง
//   ?refresh=<วินาที>       ดึงข้อมูลใหม่เป็นระยะ
//
// ไม่ใส่ a/b คือท่าปกติ: URL เดียวใช้ได้ทั้งงาน เปลี่ยนคู่ที่ออกอากาศแล้วกราฟิก
// ตามเอง ไม่ต้องไปแก้ browser source ใน OBS (หลักเดียวกับ /overlay-teams)
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

    list.forEach((entry) => {
        const cell = document.createElement('div');
        cell.className = 'mu-hero';

        const art = document.createElement('div');
        art.className = banned ? 'mu-art banned' : 'mu-art';
        // ไอคอนก่อน ถอยไปรูปเต็มถ้าไม่มี (ดู lib/hero-art.js)
        window.RovHeroArt.paint(art, entry.hero);
        cell.appendChild(art);

        // แสดงเลขเฉพาะตอนที่หยิบซ้ำ เลข 1 ทุกช่องคือหมึกที่ไม่ได้บอกอะไร
        if (entry.count > 1) {
            const count = document.createElement('div');
            count.className = 'mu-count';
            count.textContent = `x${entry.count}`;
            cell.appendChild(count);
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
    pickLabel.textContent = 'Most picked in this matchup';

    const banLabel = document.createElement('div');
    banLabel.className = 'mu-label';
    banLabel.textContent = 'Most banned by them';

    card.append(
        name,
        pickLabel, heroRow(side.topPicks || [], false),
        banLabel, heroRow(side.topBans || [], true)
    );
    return card;
}

function settleSoon() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
        document.getElementById('stage').classList.add('settled');
    }, ENTER_MS + SAFETY_MS);
}

function render(matchup) {
    // ข้อความแจ้งเตือนต้องถูกตัดสินใหม่ทุกครั้งที่โหลดสำเร็จ ไม่ใช่เฉพาะตอนข้อมูลเปลี่ยน
    //
    // ต้องอยู่ "เหนือ" ด่านลายเซ็นข้างล่าง วัดมาแล้ว: ดึงพลาดหนึ่งครั้งจะขึ้น
    // "Could not load the head to head." แล้วการดึงรอบถัดไปที่สำเร็จได้ข้อมูล
    // ชุดเดิม ลายเซ็นจึงเท่าเดิม แล้วออกตั้งแต่บรรทัดล่างนี้ ผลคือข้อความว่า
    // โหลดไม่ได้ค้างอยู่บนออกอากาศตลอดไป ทั้งที่ข้อมูลมาครบแล้ว
    window.RovOverlay.note(matchup.seriesPlayed === 0 ? 'These two have not met before.' : '');

    // วาดใหม่เฉพาะตอนข้อมูลเปลี่ยนจริง
    //
    // หน้านี้ดึงข้อมูลซ้ำได้ทั้งจาก ?refresh= และจากการเปลี่ยนคู่ที่ออกอากาศ
    // วาดใหม่ทุกครั้งแปลว่าอนิเมชันเข้าเล่นซ้ำเรื่อยๆ บนจอที่ไม่มีอะไรเปลี่ยน
    const signature = JSON.stringify(matchup);
    if (signature === lastSignature) return;
    lastSignature = signature;

    const stage = document.getElementById('stage');
    stage.classList.remove('settled');

    document.getElementById('title').textContent =
        params.get('title') || `${matchup.a.name} vs ${matchup.b.name}`;
    document.getElementById('subtitle').textContent = params.get('subtitle') || 'Head to head';
    document.title = `${matchup.a.name} vs ${matchup.b.name} - ROV Overlay`;

    document.getElementById('nameA').textContent = matchup.a.name || 'BLUE';
    document.getElementById('nameB').textContent = matchup.b.name || 'RED';

    const numA = document.getElementById('numA');
    const numB = document.getElementById('numB');
    numA.textContent = String(matchup.a.seriesWon);
    numB.textContent = String(matchup.b.seriesWon);
    numA.classList.toggle('lead', matchup.a.seriesWon > matchup.b.seriesWon);
    numB.classList.toggle('lead', matchup.b.seriesWon > matchup.a.seriesWon);

    const scope = document.getElementById('scope');
    scope.textContent = matchup.seriesPlayed === 0
        ? 'First meeting'
        : `${matchup.seriesPlayed} series · ${matchup.gamesPlayed} games · `
          + `${matchup.a.gamesWon}-${matchup.b.gamesWon} on games`;

    const cols = document.getElementById('cols');
    cols.textContent = '';
    cols.append(sideCard(matchup.a, 'blue'), sideCard(matchup.b, 'red'));

    settleSoon();
}

async function load() {
    const query = [];
    if (params.get('a')) query.push(`a=${encodeURIComponent(params.get('a'))}`);
    if (params.get('b')) query.push(`b=${encodeURIComponent(params.get('b'))}`);
    const url = `/api/matchup${query.length ? `?${query.join('&')}` : ''}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            window.RovOverlay.note('No match is on air yet.');
            settleSoon();
            return;
        }
        const data = await response.json();
        render(data.matchup);
    } catch (error) {
        window.RovOverlay.note('Could not load the head to head.');
        settleSoon();
    }
}

load();
if (refreshSeconds > 0) setInterval(load, refreshSeconds * 1000);
