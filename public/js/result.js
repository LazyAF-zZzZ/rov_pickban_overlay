const socket = io();

socket.on('connect', () => {
    console.log('Result overlay connected');
});

socket.on('stateUpdate', (state) => {
    updateResult(state);
});

function heroImageUrl(hero) {
    return 'images/heroes/' + encodeURIComponent(hero) + '.png';
}

function heroIconUrl(hero) {
    return 'images/heroes-icons/' + encodeURIComponent(hero) + '.png';
}

// เล่นอนิเมชันครั้งเดียวตอนที่ค่าเปลี่ยนจริงๆ
//
// ห้ามพึ่ง animationend อย่างเดียว OBS จะหยุด browser source ตอนที่ scene
// ไม่ได้ออกอากาศ ทำให้อนิเมชันค้างและ animationend ไม่ยิงเลย
const ANIM_CLEANUP_MS = 1200;

function playOnce(element, className) {
    clearTimeout(element._animTimer);
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);

    const clear = () => {
        clearTimeout(element._animTimer);
        element.classList.remove(className);
    };

    element.addEventListener('animationend', clear, { once: true });
    element._animTimer = setTimeout(clear, ANIM_CLEANUP_MS);
}

// state ถูกส่งมาทุกวินาทีตอนจับเวลา ถ้าล้างแล้วสร้าง img ใหม่ทุกครั้ง
// รูปจะถูกโหลดใหม่ตลอดและอนิเมชันจะเล่นซ้ำไม่หยุด
// จึงแตะ DOM เฉพาะตอนฮีโร่เปลี่ยนจริงเท่านั้น
function renderResultPicks(teamColor, picks) {
    picks.forEach((hero, index) => {
        const card = document.getElementById(`${teamColor}Pick${index}Result`);
        const artEl = /** @type {HTMLImageElement} */ (document.getElementById(`${teamColor}HeroArt${index}`));
        if (!card || !artEl) return;

        if (!hero) {
            card.classList.remove('filled');
            card.dataset.hero = '';
            artEl.src = '';
            artEl.style.display = '';
            return;
        }

        card.classList.add('filled');
        artEl.style.display = '';

        // เปลี่ยน src และเล่นอนิเมชันเฉพาะตอนฮีโร่เปลี่ยนจริง
        if (card.dataset.hero === hero) return;
        card.dataset.hero = hero;
        artEl.removeAttribute('src');
        artEl.src = heroImageUrl(hero);
        artEl.onerror = () => { artEl.style.display = 'none'; };
        playOnce(card, 'just-picked');
    });
}

function renderResultBans(teamColor, bans) {
    bans.forEach((hero, index) => {
        const slot = document.getElementById(`${teamColor}ResultBan${index}`);
        if (!slot) return;
        if (slot.dataset.hero === (hero || '')) return;
        slot.dataset.hero = hero || '';

        slot.textContent = '';
        if (!hero) return;

        const img = document.createElement('img');
        img.src = heroIconUrl(hero);
        img.onerror = () => { img.src = heroImageUrl(hero); };
        slot.appendChild(img);
        playOnce(slot, 'just-banned');
    });
}

function updateResult(state) {
    // Blue team name
    const blueNameEl = document.getElementById('blueNameResult');
    if (blueNameEl) blueNameEl.textContent = state.teamBlue.name;

    // Red team name
    const redNameEl = document.getElementById('redNameResult');
    if (redNameEl) redNameEl.textContent = state.teamRed.name;

    renderResultPicks('blue', state.teamBlue.picks);
    renderResultPicks('red', state.teamRed.picks);

    renderResultBans('blue', state.teamBlue.bans);
    renderResultBans('red', state.teamRed.bans);

    // Player names
    state.teamBlue.players.forEach((player, i) => {
        const el = document.getElementById(`blueResultPlayer${i}`);
        if (el) el.textContent = player || `Player ${i + 1}`;
    });

    state.teamRed.players.forEach((player, i) => {
        const el = document.getElementById(`redResultPlayer${i}`);
        if (el) el.textContent = player || `Player ${i + 1}`;
    });
}

socket.on('disconnect', () => {
    console.log('Result overlay disconnected');
});
