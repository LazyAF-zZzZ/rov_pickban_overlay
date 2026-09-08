// กระดานดราฟต์ของรอบก่อนหน้า
//
// หน้าเดียว: /overlay-prev พิคกับแบนของทุกรอบก่อนหน้าอยู่ในกระดานเดียว
//
// เคยเป็นสองหน้าแยกกัน (/overlay-prev-picks กับ /overlay-prev-bans) ตามที่ผู้ใช้
// ขอไว้ตอนแรก แล้วผู้ใช้ขอให้รวมเป็นหน้าเดียวและลบสองหน้านั้นทิ้ง (2026-09-08)
// โหมดแยกพิค/แยกแบนถูกเอาออกไปพร้อมกับหน้าของมัน ไม่เหลือ <body data-kind> แล้ว
// จะเอากลับมาต้องเอากลับทั้งคู่: หน้า HTML, route และสาขาในไฟล์นี้
//
// ข้อมูลมาจาก state.rounds ซึ่งเดินทางมากับ stateUpdate เหมือนทุกอย่างที่กราฟิกวาด
// ไม่ได้ยิง API ไปถามฐานเอง หน้านี้ไม่ได้ถือโทเคน และแมตช์เดี่ยวก็ไม่มีแถวในฐานอยู่แล้ว
// (ดู server/domain/rounds.ts ว่าทำไมข้อมูลถึงอยู่ใน state)
//
// พารามิเตอร์ที่รับ (ต่อท้าย URL ใน OBS ได้เลย):
//   ?rounds=1..15   แสดงกี่รอบล่าสุด ไม่ใส่ = ทุกรอบที่ผ่านมา
//   ?title=         เปลี่ยนหัวเรื่อง
//   ?subtitle=      เปลี่ยนบรรทัดรอง
//   ?stagger=<ms>   ระยะห่างของการไล่เข้าทีละแถว ไม่ใส่ = 110ms
//
// หน้านี้เป็นหน้าดูอย่างเดียว ต่อ socket เปล่าๆ ไม่ต้องมีโทเคน
// เหมือน /overlay กับ /result และไม่ได้ใช้ app-client.js

const params = new URLSearchParams(window.location.search);

// overlay-size.js ไปอ่านตัวแปรชื่อ socket ตัวนี้ ต้องประกาศไว้ก่อนไฟล์นั้นถูกโหลด
const socket = io();

const DEFAULT_TITLE = 'Previous picks and bans';

// กลุ่มช่องในหนึ่งฝั่ง เรียงซ้ายไปขวา พิคก่อนแล้วแบน
// (ฝั่งแดงสลับลำดับด้วย CSS ไม่ใช่ที่นี่ ดู .pv-side.red .pv-groups)
const GROUPS = [
    { kind: 'picks', count: 5 },
    { kind: 'bans', count: 4 }
];

// ต้องตรงกับ overlay-prev.css ถ้าแก้ที่ CSS แล้วลืมแก้ที่นี่
// ตัวจับเวลาสำรองจะทำงานก่อนอนิเมชันจบ แล้วจะเห็นแถวกระตุกตอนถูกบังคับสถานะ
const ENTER_MS = 520;
const SAFETY_MS = 700;
const DEFAULT_STAGGER = 110;
const MAX_ROUNDS = 15;

let settleTimer = null;

const stagger = window.RovOverlay.intParam(params, 'stagger', DEFAULT_STAGGER, 0, 1000);
const limit = window.RovOverlay.intParam(params, 'rounds', MAX_ROUNDS, 1, MAX_ROUNDS);

// THEME ----------------------------------------------------------------
// สำเนาย่อของตารางใน overlay.js เอาเฉพาะตัวที่แผ่นนี้ใช้จริง
// สีมาจากเซิร์ฟเวอร์ในรูป #rrggbb ที่ผ่านตัวกรองแล้ว ไม่มีอะไรถูกต่อเป็น CSS ดิบๆ
const THEME_VARS = {
    blue: '--ov-blue',
    red: '--ov-red',
    accent: '--ov-accent',
    text: '--ov-text',
    label: '--ov-silver'
};

function hexToRgbTriplet(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : null;
}

function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return;
    const root = document.documentElement;

    Object.entries(THEME_VARS).forEach(([key, prop]) => {
        const value = theme[key];
        if (value === undefined || value === null || value === '') return;
        root.style.setProperty(prop, value);
    });

    const blueRgb = hexToRgbTriplet(theme.blue);
    const redRgb = hexToRgbTriplet(theme.red);
    if (blueRgb) root.style.setProperty('--ov-blue-rgb', blueRgb);
    if (redRgb) root.style.setProperty('--ov-red-rgb', redRgb);
}

// RENDER ---------------------------------------------------------------

function slotNode(hero) {
    const slot = document.createElement('div');
    slot.className = 'pv-slot';
    if (!hero) return slot;

    slot.classList.add('filled');
    const art = document.createElement('div');
    art.className = 'pv-art';
    // ไอคอนก่อน ถอยไปรูปเต็มถ้าไม่มี (ดู lib/hero-art.js)
    window.RovHeroArt.paint(art, hero);
    slot.appendChild(art);
    return slot;
}

function sideNode(side, which) {
    const wrap = document.createElement('div');
    wrap.className = `pv-side ${which}`;

    const team = document.createElement('div');
    team.className = 'pv-team';
    const dot = document.createElement('div');
    dot.className = 'pv-dot';
    const name = document.createElement('div');
    name.className = 'pv-name';
    name.textContent = side.name || (which === 'blue' ? 'BLUE' : 'RED');
    team.append(dot, name);

    const groups = document.createElement('div');
    groups.className = 'pv-groups';

    GROUPS.forEach((group) => {
        const slots = document.createElement('div');
        // คลาส bans เป็นตัวสั่งให้ทำเป็นขาวดำ ไม่ใช่ data-kind ที่ <body> อีกแล้ว
        // หน้ารวมมีทั้งพิคและแบนอยู่ในหน้าเดียวกัน ตัวชี้ที่ระดับหน้าจึงใช้ไม่ได้
        slots.className = group.kind === 'bans' ? 'pv-slots bans' : 'pv-slots';
        // จำนวนคอลัมน์ติดไปกับกลุ่ม ไม่ได้อยู่ที่ <body>
        // ด้วยเหตุผลเดียวกัน: หน้าเดียวมีได้ทั้งกลุ่มห้าช่องและกลุ่มสี่ช่อง
        slots.style.setProperty('--pv-cols', String(group.count));
        // ให้กลุ่มกว้างตามจำนวนช่อง ช่องทุกช่องจึงเป็นสี่เหลี่ยมจัตุรัสขนาดเท่ากัน
        // ทั้งสองกลุ่ม ถ้าแบ่งครึ่งเท่ากัน ช่องแบนจะใหญ่กว่าช่องพิคอย่างเห็นได้ชัด
        slots.style.flexGrow = String(group.count);

        const heroes = (group.kind === 'bans' ? side.bans : side.picks) || [];
        for (let i = 0; i < group.count; i += 1) slots.appendChild(slotNode(heroes[i]));
        groups.appendChild(slots);
    });

    wrap.append(team, groups);
    return wrap;
}

function roundNode(record, index) {
    const row = document.createElement('div');
    row.className = 'pv-round';
    row.style.setProperty('--i', String(index));

    const no = document.createElement('div');
    no.className = 'pv-no';
    const word = document.createElement('div');
    word.className = 'pv-no-word';
    word.textContent = 'Round';
    const value = document.createElement('div');
    value.className = 'pv-no-value';
    value.textContent = String(record.round);
    no.append(word, value);

    const split = document.createElement('div');
    split.className = 'pv-split';

    row.append(no, sideNode(record.blue || {}, 'blue'), split, sideNode(record.red || {}, 'red'));

    // ทางลัดตอนอนิเมชันได้เล่นจริง ตัวจับเวลาข้างล่างเป็นตัวการันตี ไม่ใช่ตัวนี้
    row.addEventListener('animationend', () => row.classList.add('settled'), { once: true });
    return row;
}

// ย่อทั้งรายการลงถ้ารอบเยอะจนล้นผืน 1080
//
// จำเป็นจริง ไม่ใช่กันไว้เฉยๆ: หนึ่งรอบสูงราว 210px (ช่องฮีโร่เป็นสี่เหลี่ยมจัตุรัส
// กว้างตามคอลัมน์) ห้ารอบก็เต็มจอแล้ว และ Bo7 มีรอบก่อนหน้าได้ถึงหก
// วัดจริงตอนหกรอบ: แถวสุดท้ายจบที่ 1559px ล้นออกไป 480px
// body เป็น overflow:hidden รอบที่เกินจึงหายไปเงียบๆ ซึ่งบนอากาศแปลว่า
// ดราฟต์ของสองเกมล่าสุดไม่เคยขึ้นจอ โดยไม่มีอะไรบอกว่าขาด
//
// วัดจากขอบล่างของแถวสุดท้ายจริงๆ ไม่ใช่ scrollHeight
// รายการนี้ overflow เป็น visible เนื้อหาที่ล้นจึงไม่ได้อยู่ในเขตที่เลื่อนได้
// scrollHeight จะเท่ากับ clientHeight เสมอ แปลว่า "ไม่ล้น" ตลอด
// (บทเรียนเดียวกับ fitToStage ใน overlay-teams.js)
function fitToStage() {
    const list = document.getElementById('list');
    const stage = document.getElementById('stage');
    list.style.transform = '';

    const rows = list.children;
    if (rows.length === 0) return;

    // วัดจากแถวแรกถึงแถวสุดท้าย ไม่ใช่จากขอบบนของกล่อง
    //
    // ตอนวัด ทุกแถวยังอยู่ที่เฟรมแรกของอนิเมชันเข้า ซึ่ง translateY(26px)
    // วัดเทียบกับขอบกล่อง (ที่ไม่ได้ถูกเลื่อน) จะได้ค่าเกินมา 26px
    // วัดหัวถึงท้ายของแถวด้วยกันเอง ระยะเลื่อนเท่ากันจึงหักกันหมด
    const needed = rows[rows.length - 1].getBoundingClientRect().bottom
        - rows[0].getBoundingClientRect().top;

    // ที่ว่างคือความสูงของกล่องรายการเอง ไม่ต้องไปคำนวณจาก padding ของเวที
    //
    // .pv-list เป็น flex:1 กับ min-height:0 มันจึงกินที่ที่เหลือพอดีอยู่แล้ว
    // และค่านี้เป็นพิกเซลหลังถูกย่อ/ขยายจริง จึงถูกทั้งโหมด 1080 และ 1440
    // ถ้าไปอ่าน paddingBottom จาก getComputedStyle จะได้ค่าก่อนสเกล (62px)
    // มาลบกับพิกัดหลังสเกล ซึ่งเพี้ยนไปราว 21px ในโหมด 1440
    const available = list.getBoundingClientRect().height;

    if (needed <= 0 || available <= 0 || needed <= available) return;

    // ย่ออย่างเดียว ห้ามขยายความกว้างชดเชยแบบที่ overlay-teams.js ทำ
    //
    // ที่นั่นได้ผลเพราะการ์ดสูงเท่าเนื้อหาข้างใน ที่นี่ช่องฮีโร่เป็นสี่เหลี่ยมจัตุรัส
    // ความสูงจึงมาจากความกว้างของคอลัมน์ ขยายกว้างขึ้น 1/s แล้วย่อลง s
    // สองอย่างหักล้างกันพอดี ความสูงที่เห็นเท่าเดิมเป๊ะ วัดแล้วว่ายังล้นอยู่ 366px
    //
    // พอความกว้างคงที่ ความสูงจึงลดตาม s ตรงๆ คำนวณรอบเดียวได้พอดี
    // และย่อจากกึ่งกลางด้านบน ที่ว่างจะได้เฉลี่ยสองข้างแทนที่จะไปกองอยู่ทางขวา
    const scale = available / needed;
    list.style.transformOrigin = 'top center';
    list.style.transform = 'scale(' + scale + ')';
}

// การันตีว่ากระดานจะถูกมองเห็น ต่อให้อนิเมชันไม่เคยเริ่มหรือไม่เคยจบ
//
// OBS หยุด browser source ที่ไม่ได้อยู่ในฉากที่ออกอากาศ อนิเมชันจึงค้างได้
// และ animationend จะไม่ยิงเลย ทุกแถวเริ่มจาก opacity:0
// ถ้าไม่มีตัวนี้ ผลลัพธ์คือจอว่างเปล่าออกอากาศ ซึ่งแย่กว่าการข้ามอนิเมชันไปเลย
function settleSoon(count) {
    clearTimeout(settleTimer);
    const total = stagger * Math.max(0, count - 1) + ENTER_MS + SAFETY_MS;
    settleTimer = setTimeout(() => {
        document.getElementById('stage').classList.add('settled');
    }, total);
}

// รอบก่อนหน้าเท่านั้น รอบที่กำลังเล่นอยู่มีแถบหลักโชว์อยู่แล้ว
//
// state.rounds เก็บรอบที่เคยเดินผ่านทั้งหมด รวมถึงรอบที่เลขมากกว่ารอบปัจจุบัน
// ซึ่งเกิดได้เมื่อคนคุมงานกดเดินหน้าเกินแล้วถอยกลับมา ข้อมูลนั้นต้องไม่หาย
// (กดเดินหน้าอีกทีต้องได้ดราฟต์เดิมคืน) แต่ก็ไม่ควรขึ้นจอในชื่อ "รอบก่อนหน้า"
function previousRounds(state) {
    const current = Number(state.round) || 1;
    return (Array.isArray(state.rounds) ? state.rounds : [])
        .filter((r) => r && Number(r.round) < current)
        .sort((a, b) => a.round - b.round)
        .slice(-limit)
        .map((r) => orientTo(r, state));
}

// วางคอลัมน์ให้ตรงกับแถบหลักที่ออกอากาศอยู่ตอนนี้ โดยดูจากชื่อทีมในรอบนั้นเอง
//
// เซิร์ฟเวอร์จัดฝั่งให้ตอนประกอบรอบก่อนหน้าไปแล้วครั้งหนึ่ง (roundsBefore) แต่จัดตาม
// สภาพ ณ ตอนนั้น พอกด SWITCH TEAMS กลางซีรีส์ แถบหลักสลับข้าง ส่วนกองรอบไม่ขยับ
// คนดูก็จะเห็นสองทีมสลับที่กันระหว่างแบนเนอร์กับกระดานย้อนหลังในฉากเดียวกัน
// วัดแล้ว: แบนเนอร์เป็น BRAVO/ALPHA ส่วนการ์ดรอบ 1 ยังเป็น ALPHA/BRAVO
//
// ตรวจที่นี่แทนการให้เซิร์ฟเวอร์คอยสลับกองตาม เพราะมันแก้ได้ทุกทางที่ทำให้ฝั่งสลับ
// ทั้งปุ่มสลับฝั่ง การกด Ctrl+Z หลังสลับ และทางอื่นที่จะมีในอนาคต
// โดยไม่ต้องมีใครจำว่าต้องไปแก้กองรอบด้วย
//
// สลับเฉพาะตอนที่ชื่อไขว้กันครบทั้งสองข้างเท่านั้น
// ชื่อซ้ำกันสองฝั่ง หรือมีคนแก้ชื่อทีมกลางซีรีส์ = แยกไม่ออก อย่าเดา ปล่อยไว้ตามเดิม
function orientTo(record, state) {
    const liveBlue = (state.teamBlue && state.teamBlue.name) || '';
    const liveRed = (state.teamRed && state.teamRed.name) || '';
    const blue = (record.blue && record.blue.name) || '';
    const red = (record.red && record.red.name) || '';
    if (!blue || !red || blue === red) return record;
    if (blue !== liveRed || red !== liveBlue) return record;
    return { round: record.round, blue: record.red, red: record.blue };
}

// วาดใหม่เฉพาะตอนข้อมูลเปลี่ยนจริง
//
// stateUpdate มาทุกวินาทีตอนนาฬิกาดราฟต์เดิน ถ้าวาดใหม่ทุกครั้ง อนิเมชันเข้า
// จะถูกรีสตาร์ททุกวินาทีตลอดเวลาที่กระดานอยู่บนอากาศ = แถวกะพริบไม่หยุด
// ต้องมีทั้งพิคและแบนอยู่ในลายเซ็น ไม่ใช่อย่างใดอย่างหนึ่ง
//
// ตอนที่ยังเป็นสองหน้าแยกกัน หน้าหนึ่งวาดอย่างเดียว ลายเซ็นจึงเฝ้าอย่างเดียวพอ
// กระดานรวมวาดทั้งสองอย่าง ถ้าเฝ้าแค่พิค การแก้แบนจะไม่ทำให้วาดใหม่
// ครึ่งแบนของกระดานจะค้างเป็นของเก่าอยู่บนอากาศโดยไม่มีอะไรบอก
function signatureOf(rounds) {
    return JSON.stringify(rounds.map((r) => [
        r.round,
        r.blue && r.blue.name, r.red && r.red.name,
        r.blue && r.blue.picks, r.blue && r.blue.bans,
        r.red && r.red.picks, r.red && r.red.bans
    ]));
}

let lastSignature = null;
let lastHeading = null;

// คืนเป็นสองค่า ไม่ใช่ข้อความเดียวที่คั่นด้วยอักขระ
//
// ของเดิมต่อด้วย \n แล้วค่อย split กลับ ซึ่งพังทันทีถ้าหัวเรื่องมี \n อยู่ข้างใน
// ?title= มาจาก URL คนใส่ %0A มาได้ ผลคือบรรทัดรองกลายเป็นครึ่งหลังของหัวเรื่อง
// แล้วชื่อทัวร์นาเมนต์หายไป ตัวคั่นที่ผู้ใช้ใส่เองได้ ไม่ใช่ตัวคั่น
function headingOf(state) {
    const info = state.matchInfo || {};
    return {
        title: params.get('title')
            || DEFAULT_TITLE,
        subtitle: params.get('subtitle') || info.tournament || ''
    };
}

function render(state) {
    const heading = headingOf(state);
    const headingKey = JSON.stringify(heading);
    if (headingKey !== lastHeading) {
        document.getElementById('title').textContent = heading.title;
        document.getElementById('subtitle').textContent = heading.subtitle;
        document.title = `${heading.title} - ROV Overlay`;
        lastHeading = headingKey;
    }

    const rounds = previousRounds(state);
    const signature = signatureOf(rounds);
    if (signature === lastSignature) return;
    lastSignature = signature;

    const list = document.getElementById('list');
    list.textContent = '';
    document.getElementById('stage').classList.remove('settled');
    document.getElementById('stage').style.setProperty('--pv-stagger', `${stagger}ms`);

    rounds.forEach((record, index) => list.appendChild(roundNode(record, index)));

    window.RovOverlay.note(rounds.length === 0 ? 'No earlier round has been played yet.' : '');
    fitToStage();
    settleSoon(rounds.length);
}

socket.on('stateUpdate', (state) => {
    if (!state || typeof state !== 'object') return;
    applyTheme(state.theme);
    render(state);
});
