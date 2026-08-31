const socket = io();

// Connect to server
socket.on('connect', () => {
    console.log('Connected to server');
});

// Update overlay when state changes
socket.on('stateUpdate', (state) => {
    updateOverlay(state);
});

function imageUrl(folder, name) {
    if (!name || typeof name !== 'string') return '';
    return `images/${folder}/${encodeURIComponent(name)}.png`;
}

const LOGO_FILES = { teamBlue: 'blue-team', teamRed: 'red-team' };

// THEME ----------------------------------------------------------------
// Maps state.theme onto the CSS custom properties declared in :root.
// Values are written on <html> so they override the stylesheet without it
// needing to know anything about the Design page.
//
// Colours arrive validated as #rrggbb from the server, numbers clamped -
// nothing here is interpolated into CSS without having passed that.
/** @type {Record<string, [string, (v: any) => string]>} */
const THEME_VARS = {
    blue: ['--ov-blue', (v) => v],
    red: ['--ov-red', (v) => v],
    accent: ['--ov-accent', (v) => v],
    text: ['--ov-text', (v) => v],
    label: ['--ov-silver', (v) => v],
    typeCaption: ['--ov-type-caption', (v) => `${v}px`],
    typePlayer: ['--ov-type-player', (v) => `${v}px`],
    typeTournament: ['--ov-type-tournament', (v) => `${v}px`],
    typeTitle: ['--ov-type-title', (v) => `${v}px`],
    typeScore: ['--ov-type-score', (v) => `${v}px`],
    typeTimer: ['--ov-type-timer', (v) => `${v}px`],
    logoSize: ['--ov-logo-size', (v) => `${v}px`],
    logoInset: ['--ov-logo-inset', (v) => `${v}px`]
};

// rgb() needs the channels separately for the borders that use alpha
function hexToRgbTriplet(hex) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    return m ? `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}` : null;
}

function applyTheme(theme) {
    if (!theme || typeof theme !== 'object') return;
    const root = document.documentElement;

    Object.entries(THEME_VARS).forEach(([key, [prop, format]]) => {
        const value = theme[key];
        if (value === undefined || value === null || value === '') return;
        root.style.setProperty(prop, format(value));
    });

    const blueRgb = hexToRgbTriplet(theme.blue);
    const redRgb = hexToRgbTriplet(theme.red);
    if (blueRgb) root.style.setProperty('--ov-blue-rgb', blueRgb);
    if (redRgb) root.style.setProperty('--ov-red-rgb', redRgb);
}

// The first state arrives after the socket connects, which is already a
// frame or two after paint. Setting the hidden class then would play the
// slide-out on a page that should have started off-screen - visible every
// time the OBS source refreshes mid-match. Suppress the transition for
// that one update only.
let overlayVisibleApplied = false;

function applyOverlayVisible(visible) {
    const body = document.body;
    if (overlayVisibleApplied) {
        body.classList.toggle('overlay-hidden', !visible);
        return;
    }

    body.classList.add('no-anim');
    body.classList.toggle('overlay-hidden', !visible);
    void body.offsetWidth; // flush the class change before re-enabling motion
    body.classList.remove('no-anim');
    overlayVisibleApplied = true;
}

// Only touches src when the version actually changes. Reassigning src on
// every state update - and these arrive once a second while the draft
// timer runs - makes the image blink on air in OBS.
function renderTeamLogo(el, team, logo) {
    if (!el) return;
    const version = logo?.v || 0;
    const ext = logo?.ext || '';

    if (!version || !ext) {
        el.hidden = true;
        el.removeAttribute('src');
        el.dataset.version = '';
        return;
    }

    // ชื่อไฟล์มาจาก state ไม่ได้เดาจากฝั่ง
    // state บอกเองว่าภาพของทีมนี้อยู่ไฟล์ไหน สลับฝั่งแล้วภาพจึงสลับตาม
    // ไม่มี src (state.json รุ่นก่อน) ก็ถอยไปใช้ชื่อตามฝั่งเหมือนเดิม
    const file = logo?.src || LOGO_FILES[team];

    // src ต้องอยู่ในลายเซ็นด้วย ไม่งั้นสลับฝั่งที่ v กับ ext บังเอิญเท่ากัน
    // จะถูกมองว่า "ไม่มีอะไรเปลี่ยน" แล้วภาพเก่าค้างอยู่
    const stamp = `${version}.${ext}.${file}`;
    if (el.dataset.version === stamp) return;
    el.dataset.version = stamp;

    // If the file is missing the element still holds its 138px box, leaving a
    // hole in the banner on air. State can outlive the file - the images live
    // on disk while the version lives in state.json, so restoring an old state
    // or moving the app between machines can point at art that is not there.
    el.onerror = () => {
        el.hidden = true;
        el.dataset.version = '';
    };
    el.src = `images/team-logos/${file}.${ext}?v=${version}`;
    el.hidden = false;
}

// วินาทีล่าสุดที่เล่นเสียงติ๊กไปแล้ว
//
// เสียงเตือนดังทุกวินาทีในสิบวินาทีสุดท้าย (10, 9, ... , 1) ไม่ใช่ครั้งเดียวตอนข้ามเส้น
// ต้องจำ "วินาทีที่เล่นไปแล้ว" ไม่ใช่แค่ธงว่าอยู่ในช่วงเตือนหรือยัง
// เพราะ state ถูกส่งมาทุกครั้งที่มีอะไรเปลี่ยน ไม่ใช่วินาทีละครั้งเป๊ะๆ
// กด pick ระหว่างนับถอยหลังจะได้ state เพิ่มมาในวินาทีเดียวกัน
// ถ้าเล่นทุกครั้งที่ state มา เสียงจะรัวซ้อนกันตอนคนคุมงานกำลังกรอกดราฟต์
// null = ยังไม่อยู่ในช่วงเตือน หรือเฟสจบไปแล้ว
let lastTickSecond = null;

// "00:09" -> 9. รองรับกรณีส่งมาเป็นวินาทีล้วนด้วย
function timerToSeconds(timer) {
    if (!timer) return 0;
    const parts = String(timer).split(':');
    if (parts.length === 2) {
        const minutes = Number(parts[0]);
        const seconds = Number(parts[1]);
        return Number.isFinite(minutes) && Number.isFinite(seconds) ? minutes * 60 + seconds : 0;
    }
    const asNumber = Number(timer);
    return Number.isFinite(asNumber) ? asNumber : 0;
}

function updateOverlay(state) {
    // Update team names
    document.getElementById('blueTeamName').textContent = state.teamBlue.name;
    document.getElementById('redTeamName').textContent = state.teamRed.name;
    
    // Update center team names
    document.getElementById('blueCenterName').textContent = state.teamBlue.name;
    document.getElementById('redCenterName').textContent = state.teamRed.name;

    applyTheme(state.theme);

    // ระดับเสียงมากับ state ปรับจากหน้า Control แล้วมีผลทันทีโดยไม่ต้อง Refresh source
    RovSfx.setLevels(state.sfx);

    // Update team logos
    renderTeamLogo(document.getElementById('blueTeamLogo'), 'teamBlue', state.teamBlue.logo);
    renderTeamLogo(document.getElementById('redTeamLogo'), 'teamRed', state.teamRed.logo);

    // Show / hide the whole banner - CSS slides it off the bottom edge.
    // A class on <body> rather than a display change: the layout stays
    // measured, so OBS never sees the source blank and relayout.
    applyOverlayVisible(state.overlayVisible !== false);

    // Update scores
    document.getElementById('blueScore').textContent = state.teamBlue.score;
    document.getElementById('redScore').textContent = state.teamRed.score;
    
    // Update timer + draft label
    const timerEl = document.getElementById('timer');
    const draftLabelEl = document.getElementById('draftLabel');
    if (timerEl) {
        if (state.draftLabel === 'coming soon') {
            timerEl.textContent = '';
            timerEl.classList.remove('urgent');
            lastTickSecond = null;
        } else {
            timerEl.textContent = state.timer || '';
            const seconds = timerToSeconds(state.timer);
            const urgent = seconds > 0 && seconds <= 10;
            timerEl.classList.toggle('urgent', urgent);

            // ติ๊กหนึ่งครั้งต่อหนึ่งวินาที ตลอดสิบวินาทีสุดท้าย
            //
            // ไม่นับ 0 ตั้งใจ: หน้าจอที่ยังไม่ได้เริ่มจับเวลาก็ขึ้น 00:00 เหมือนกัน
            // ถ้าติ๊กที่ 0 ด้วย การกด RESET MATCH จะมีเสียงเตือนดังขึ้นมาเฉยๆ
            if (urgent && seconds !== lastTickSecond) {
                RovSfx.play('timer');
                lastTickSecond = seconds;
            }
            if (!urgent) lastTickSecond = null;
        }
    }
    if (draftLabelEl) {
        draftLabelEl.textContent = state.draftLabel || '';
    }
    
    // Update match info
    if (state.matchInfo) {
        document.getElementById('tournamentName').textContent = state.matchInfo.tournament || 'ROV Premier League';
        document.getElementById('matchTitle').textContent = state.matchInfo.title || '';
    }
    
    // Update player names
    state.teamBlue.players.forEach((player, index) => {
        const element = document.getElementById(`bluePlayer${index}`);
        if (element) {
            element.textContent = player || `Player ${index + 1}`;
        }
    });
    
    state.teamRed.players.forEach((player, index) => {
        const element = document.getElementById(`redPlayer${index}`);
        if (element) {
            element.textContent = player || `Player ${index + 1}`;
        }
    });
    
    // Update active slots highlight
    updateActiveSlots(state.draftActiveSlots || []);

    // Update bans
    updateBans('teamBlue', state.teamBlue.bans);
    updateBans('teamRed', state.teamRed.bans);
    
    // Update picks
    updatePicks('teamBlue', state.teamBlue.picks);
    updatePicks('teamRed', state.teamRed.picks);

    // state ก้อนแรกคือ "กระดานตอนนี้" ไม่ใช่ "มีอะไรเพิ่งเกิดขึ้น"
    // ทุก pick/ban ที่มีอยู่แล้วเพิ่งถูกนับเป็นการเปลี่ยนแปลงไปเมื่อกี้
    // ปลดล็อกเสียงหลังจากนั้น เปิด source กลางเกมจะได้ไม่มีเสียงรัวทั้งกระดาน
    RovSfx.arm();
}

function updateActiveSlots(activeSlots) {
    // clear all active classes
    document.querySelectorAll('.ban-slot.active, .pick-slot.active').forEach(el => {
        el.classList.remove('active');
    });

    if (!activeSlots || activeSlots.length === 0) return;

    // slotId format: blueBan0, redPick2, etc.
    activeSlots.forEach(slotId => {
        const m = slotId.match(/^(blue|red)(Pick|Ban)(\d)$/);
        if (!m) return;
        const teamAttr = m[1] === 'blue' ? 'teamBlue' : 'teamRed';
        const type = m[2];   // 'Pick' or 'Ban'
        const idx = m[3];    // '0','1',...

        if (type === 'Ban') {
            const slot = document.querySelector(`.ban-slot[data-team="${teamAttr}"][data-index="${idx}"]`);
            if (slot) slot.classList.add('active');
        } else {
            const slot = document.querySelector(`.pick-slot[data-team="${teamAttr}"][data-index="${idx}"]`);
            if (slot) slot.classList.add('active');
        }
    });
}

// เล่นอนิเมชันครั้งเดียวตอนที่ค่าเปลี่ยนจริงๆ
//
// ห้ามพึ่ง animationend อย่างเดียว OBS จะหยุด browser source ตอนที่ scene
// ไม่ได้ออกอากาศ ทำให้อนิเมชันค้างและ animationend ไม่ยิงเลย
// ถ้าไม่มีตัวสำรอง class จะค้างอยู่ถาวรและไปเล่นผิดจังหวะตอน scene กลับมา
const ANIM_CLEANUP_MS = 1200;

function playOnce(element, className) {
    clearTimeout(element._animTimer);
    element.classList.remove(className);
    void element.offsetWidth; // บังคับ reflow เพื่อให้เริ่มอนิเมชันใหม่ได้
    element.classList.add(className);

    const clear = () => {
        clearTimeout(element._animTimer);
        element.classList.remove(className);
    };

    element.addEventListener('animationend', clear, { once: true });
    element._animTimer = setTimeout(clear, ANIM_CLEANUP_MS);
}

function updateBans(team, bans) {
    bans.forEach((hero, index) => {
        const slot = /** @type {HTMLElement} */ (document.querySelector(`.ban-slot[data-team="${team}"][data-index="${index}"]`));
        if (!slot) return;

        // state ถูกส่งมาทุกวินาทีตอนจับเวลา ถ้าสร้าง img ใหม่ทุกครั้ง
        // รูปจะถูกโหลดใหม่ตลอดและอนิเมชันจะเล่นซ้ำไม่หยุด
        // จึงแตะ DOM เฉพาะตอนฮีโร่เปลี่ยนจริงเท่านั้น
        if (slot.dataset.hero === (hero || '')) return;
        slot.dataset.hero = hero || '';
        if (hero) RovSfx.play('ban');

        const oldImg = slot.querySelector('.ban-icon');
        if (oldImg) oldImg.remove();

        if (!hero) {
            slot.classList.remove('filled');
            return;
        }

        slot.classList.add('filled');
        const img = document.createElement('img');
        img.className = 'ban-icon';
        img.src = imageUrl('heroes-icons', hero);
        img.onerror = function () {
            // ถ้าไม่มีไอคอน ใช้รูปเต็มแทน
            this.src = imageUrl('heroes', hero);
        };
        slot.appendChild(img);
        playOnce(slot, 'just-banned');
    });
}

// โหลดรูปให้เสร็จก่อน แล้วค่อยแสดงพร้อมอนิเมชันในเฟรมเดียวกัน
function showHeroArtWhenReady(slot, heroImage, hero, cssUrl) {
    // onload และ decode() อาจยิงทั้งคู่ ถ้าปล่อยให้เรียกซ้ำ
    // อนิเมชันจะถูกรีสตาร์ทกลางทางและดูสะดุด
    let revealed = false;
    const reveal = () => {
        if (revealed) return;
        revealed = true;
        // ถ้าระหว่างรอ มีการเปลี่ยนฮีโร่อีก ให้ทิ้งผลลัพธ์เก่าไป
        if (slot.dataset.hero !== hero) return;
        heroImage.style.backgroundImage = cssUrl;
        playOnce(slot, 'just-picked');
    };

    const preload = new Image();
    preload.onload = () => {
        // decode() ให้ภาพพร้อมวาดจริงก่อนเฟรมแรกของอนิเมชัน
        if (preload.decode) preload.decode().then(reveal).catch(reveal);
        else reveal();
    };
    preload.onerror = reveal; // รูปหายก็ยังต้องเดินต่อ
    preload.src = imageUrl('heroes', hero);
}

function updatePicks(team, picks) {
    picks.forEach((hero, index) => {
        const slot = /** @type {HTMLElement} */ (document.querySelector(`.pick-slot[data-team="${team}"][data-index="${index}"]`));
        if (slot) {
            const heroImage = /** @type {HTMLElement} */ (slot.querySelector('.hero-image'));
            if (hero) {
                slot.classList.add('filled');
                const nextImage = `url("${imageUrl('heroes', hero)}")`;
                if (slot.dataset.hero !== hero) {
                    slot.dataset.hero = hero;
                    RovSfx.play('pick');
                    // รอให้รูปโหลดเสร็จก่อนค่อยเริ่มอนิเมชัน
                    // ไม่งั้นกล่องเปล่าจะขยับก่อน แล้วรูปเด้งขึ้นมากลางทาง
                    // ทำให้ดูสะดุด ถ้ารูปอยู่ใน cache แล้วจะเริ่มทันที
                    showHeroArtWhenReady(slot, heroImage, hero, nextImage);
                    return;
                }
                heroImage.style.backgroundImage = nextImage;
            } else {
                slot.classList.remove('filled');
                slot.dataset.hero = '';
                heroImage.style.backgroundImage = '';
            }
        }
    });
}

// Handle disconnection
socket.on('disconnect', () => {
    console.log('Disconnected from server');
});
