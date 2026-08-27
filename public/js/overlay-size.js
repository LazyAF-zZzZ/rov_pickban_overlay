// ขนาดหน้าจอ overlay เลือกครั้งเดียวจาก Control Panel แล้วทุกหน้าตามทันที
//
// หน้าไหนที่ถูกล็อกขนาดไว้แล้ว (เช่น /overlay-1440 ที่ยังมีคนใส่ไว้ใน OBS)
// ให้ใส่ data-lock-size ไว้ที่ <body> หน้านั้นจะไม่เปลี่ยนตาม
(function () {
    const body = document.body;
    const locked = body.dataset.lockSize;

    // ลิงก์ CSS ของ 1440 จะถูกเปิด/ปิดตามขนาดที่เลือก
    const sheet1440 = /** @type {HTMLLinkElement} */ (document.getElementById('size1440'));

    function applySize(size) {
        const next = size === '1440' ? '1440' : '1080';
        const wantDisabled = next !== '1440';

        // แต่ละอย่างเช็คแยกกัน ไม่ใช้ตัวเดียวคุมทั้งคู่
        // ถ้าเช็คแค่ dataset แล้วรีเทิร์นทิ้ง เวลาที่ dataset กับ stylesheet
        // ไม่ตรงกัน (เช่นถูกสลับจากที่อื่น) จะกลับมาตรงกันไม่ได้เลย
        if (body.dataset.size !== next) body.dataset.size = next;

        // แผ่น 1440 ถูกปิดถาวร ตอนนี้ 1440p ใช้วิธีขยาย layout 1080p ด้วย 4/3
        // แทนการมีชุดขนาดแยกอีกชุด รายละเอียดอยู่ในคอมเมนต์ของ overlay.css
        if (sheet1440 && !sheet1440.disabled) sheet1440.disabled = true;
    }

    window.applyOverlaySize = applySize;

    // --- ภาพพื้นหลังที่ผู้ใช้ออกแบบเอง ------------------------------
    // แต่ละหน้าบอกไว้ที่ <body data-skin-slots> ว่าใช้ slot ไหนกับ element ไหน
    // เช่น "overlayTop:.ban-section, overlayBottom:.pick-section"
    // 1080p กับ 1440p ใช้คนละไฟล์ ชื่อ slot จริงคือ base + ขนาด
    // เช่น overlayTop -> overlayTop1080 หรือ overlayTop1440
    const SKIN_FILES = {
        overlayTop1080: 'overlay-top-1080',
        overlayTop1440: 'overlay-top-1440',
        overlayBottom1080: 'overlay-bottom-1080',
        overlayBottom1440: 'overlay-bottom-1440',
        resultTop1080: 'result-top-1080',
        resultTop1440: 'result-top-1440',
        resultBottom1080: 'result-bottom-1080',
        resultBottom1440: 'result-bottom-1440'
    };
    const skinTargets = (body.dataset.skinSlots || '').split(',')
        .map((pair) => pair.split(':').map((s) => s.trim()))
        .filter(([base, sel]) => base && sel);

    // นามสกุลไฟล์ไม่ได้เก็บไว้ใน state จึงลองทีละแบบจนกว่าจะโหลดได้
    const EXTS = ['png', 'jpg', 'webp'];
    const resolved = {};

    function findSkinUrl(slot, version) {
        const cacheKey = slot + ':' + version;
        if (resolved[cacheKey]) return Promise.resolve(resolved[cacheKey]);

        return EXTS.reduce((chain, ext) => chain.then((found) => {
            if (found) return found;
            const url = `images/skins/${SKIN_FILES[slot]}.${ext}?v=${version}`;
            return new Promise((res) => {
                const img = new Image();
                img.onload = () => res(url);
                img.onerror = () => res(null);
                img.src = url;
            });
        }), Promise.resolve(null)).then((url) => {
            if (url) resolved[cacheKey] = url;
            return url;
        });
    }

    function applySkin(skin) {
        const on = Boolean(skin && skin.enabled);
        body.classList.toggle('skin-on', on);
        body.classList.toggle('panels-off', Boolean(skin) && skin.showPanels === false);

        const size = body.dataset.size === '1440' ? '1440' : '1080';

        skinTargets.forEach(([base, selector]) => {
            const el = /** @type {HTMLElement} */ (document.querySelector(selector));
            if (!el) return;
            const slot = base + size;                       // เลือกไฟล์ตามขนาดที่ใช้อยู่
            const version = (skin && skin.slots && skin.slots[slot]) || 0;

            if (!on || !version || !SKIN_FILES[slot]) {
                el.style.backgroundImage = '';
                el.classList.remove('has-skin');
                return;
            }
            findSkinUrl(slot, version).then((url) => {
                if (!url) return;
                el.style.backgroundImage = `url("${url}")`;
                el.classList.add('has-skin');
            });
        });
    }

    // เปลี่ยนขนาดแล้วต้องสลับไฟล์ภาพตามด้วย
    window.reapplySkin = () => applySkin(window.__lastSkin);

    applySize(locked || '1080');
    if (locked) {
        // หน้าที่ล็อกขนาดไว้ ยังต้องรับภาพพื้นหลังตามปกติ
        if (typeof socket !== 'undefined') {
            socket.on('stateUpdate', (s) => {
                window.__lastSkin = s && s.skin;
                applySkin(window.__lastSkin);
            });
        }
        return;
    }

    // socket ถูกสร้างไว้แล้วในไฟล์หลักของแต่ละหน้า
    // applySize ต้องมาก่อน applySkin เพราะการเลือกไฟล์ขึ้นกับขนาดที่เพิ่งตั้ง
    if (typeof socket !== 'undefined') {
        socket.on('stateUpdate', (state) => {
            applySize(state && state.overlaySize);
            window.__lastSkin = state && state.skin;
            applySkin(window.__lastSkin);
        });
    }
})();
