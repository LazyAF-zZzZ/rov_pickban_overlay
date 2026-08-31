// เสียงเอฟเฟกต์ของ overlay
//
// ปิดไว้เป็นค่าเริ่มต้น เปิดด้วย ?sfx=1 ต่อท้าย URL ของ browser source
//
// ที่ต้องเปิดทีละ source เพราะ overlay 1080p, 1440p และหน้า result
// รับ state ชุดเดียวกันหมด ถ้าเปิดพร้อมกันสองอัน เสียงจะดังซ้อนกันสองครั้ง
// เหลื่อมกันนิดหน่อย ซึ่งฟังออกชัดมากบนสตรีม
// ให้ source ที่ "มีเสียง" มีได้อันเดียว อันที่เหลือปล่อยเงียบไว้
//
// พารามิเตอร์:
//   ?sfx=1        เปิดเสียง
//   &vol=0.5      ระดับเสียง 0 ถึง 1 (ไม่ใส่ = 1 คือดังเต็มไฟล์)
//   &v=2          เลขรุ่นของไฟล์เสียง ใส่ต่อท้ายชื่อไฟล์เพื่อล้าง cache
//                 OBS จำไฟล์เก่าไว้แน่นมาก เปลี่ยนไฟล์แล้วเสียงไม่เปลี่ยน
//                 ให้บวกเลขนี้ทีละหนึ่ง
//
// ไฟล์เสียงอยู่ในโฟลเดอร์ media ของผู้ใช้ ไม่ได้อยู่ในตัวแอพ
// ชื่อไฟล์ตายตัวสามชื่อ: pick, ban, timer-warning  (.mp3 หรือ .wav)
//
// ที่อยู่ของโฟลเดอร์ต่างกันตามวิธีเปิดแอพ เซิร์ฟเวอร์จึงสร้างให้เองตอนเปิด
// แล้วพิมพ์ path เต็มออก console (ดู ensureSoundDir ใน server/domain/media.ts)
// ในแอพ Electron มีเมนู ROV Tool -> Open Sounds Folder เปิดให้ถึงที่
//
// ใช้ Web Audio ไม่ใช่ <audio> ตั้งใจ และเป็นเรื่องที่เสียเวลาไปมากกว่าจะรู้
//
// บนเครื่องของผู้ใช้จริง <audio> ค้างอยู่ที่ readyState 0 ตลอดกาล
// ไม่ error ไม่เล่น ไม่มีอะไรบอกสักอย่าง ทั้งที่ไฟล์โหลดผ่าน fetch ได้ปกติ
// (ลองเล่นจาก blob ในหน่วยความจำก็ค้างเหมือนกัน จึงไม่ใช่เรื่องเน็ตหรือ Range)
// แต่ AudioContext ทำงานปกติ decode ไฟล์เดียวกันได้ และนาฬิกาของมันเดินจริง
//
// Web Audio ยังดีกว่าตรงอื่นด้วย: เสียงซ้อนกันได้ฟรีเพราะแต่ละครั้งเป็น
// BufferSource คนละตัว ไม่ต้องโคลน element และหน่วงต่ำกว่าเพราะ decode ไว้แล้ว
// ห้ามเปลี่ยนกลับไปใช้ <audio> เพราะดูโค้ดสั้นกว่า มันพังมาแล้ว

(function (global) {
  const params = new URLSearchParams(global.location.search);
  const enabled = params.get('sfx') === '1';

  // ค่าเริ่มต้นคือดังเต็มไฟล์ ไม่ใช่ 0.7
  //
  // ระดับเสียงจริงมีตัวหรี่อยู่หลายชั้นแล้ว: Volume Mixer ของ Windows ต่อ
  // ระดับเสียงหลักของเครื่อง ต่อมิกเซอร์ของ OBS ถ้าแอพหรี่ลงมาอีกชั้น
  // มันจะเบาจนหาสาเหตุไม่เจอ (เคยเจอมาแล้ว: Chrome ถูกตั้งไว้ 19% ในมิกเซอร์
  // คูณกับ 47% ของเครื่อง คูณกับ 0.7 ของตรงนี้ เหลือราว 6% เบาจนนึกว่าไม่ดัง)
  // ที่ที่ควรหรี่คือมิกเซอร์ ซึ่งเป็นที่ที่คนคุมงานมองหาอยู่แล้ว
  // ระวัง params.get() คืน null เมื่อไม่มีพารามิเตอร์ และ Number(null) คือ 0
  // ไม่ใช่ NaN ถ้าเขียน Number(params.get('vol')) ตรงๆ แล้วเช็คแค่ช่วง 0..1
  // ค่าที่ได้ตอนไม่ได้ใส่ &vol= จะเป็น 0 พอดี = เงียบสนิททั้งที่ทุกอย่างทำงานถูก
  // บั๊กนี้ทำให้ overlay เงียบอยู่หลายรอบ ขณะที่หน้า /sfx-test ดังปกติ
  // เพราะหน้านั้นต่อ source เข้า destination ตรงๆ ไม่ผ่าน gain ตัวนี้
  const volume = (() => {
    const given = params.get('vol');
    if (given === null || given === '') return 1;
    const raw = Number(given);
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1;
  })();

  const version = params.get('v') || '1';

  // ชื่อเหตุการณ์ -> ชื่อไฟล์ ชื่อไฟล์มาจากตารางนี้เท่านั้น
  // ไม่มีทางที่ข้อความจากผู้ใช้จะกลายเป็น path ได้ (กฎเดียวกับ domain/media.ts)
  const FILES = {
    pick: 'pick',
    ban: 'ban',
    timer: 'timer-warning'
  };

  const EXTS = ['mp3', 'wav'];

  // เปิดอยู่ใน OBS หรือในเบราว์เซอร์ธรรมดา
  //
  // obs-browser ฝัง window.obsstudio ไว้ให้เสมอ ใช้แยกสองกรณีนี้ได้ตรงๆ
  // ป้าย "กดเพื่อเปิดเสียง" ห้ามโผล่ใน OBS เด็ดขาด มันจะไปนั่งอยู่บนจอคนดู
  // ตลอดรายการ เพราะใน OBS ไม่มีใครคลิก ป้ายจึงไม่มีวันหายไปเอง
  const inOBS = typeof global.obsstudio === 'object' && global.obsstudio !== null;

  /** @type {AudioContext | null} */
  let ctx = null;
  /** @type {Record<string, AudioBuffer>} */
  const buffers = {};

  // ระดับเสียงแยกต่อเหตุการณ์ มาจาก state.sfx ซึ่งปรับได้จากหน้า Control ระหว่างงาน
  // ตัวคูณจาก &vol= ยังอยู่ เป็นตัวหรี่รวมของ source นั้นๆ ทับอีกชั้น
  /** @type {Record<string, GainNode>} */
  const gains = {};
  let levels = { pick: 1, ban: 1, timer: 1 };

  function applyLevels() {
    Object.keys(gains).forEach((name) => {
      const level = Number.isFinite(levels[name]) ? levels[name] : 1;
      gains[name].gain.value = level * volume;
    });
  }

  // overlay.js เรียกทุกครั้งที่ state มาถึง ค่าจึงตามการปรับสไลเดอร์แบบทันที
  // เรียกก่อน load() เสร็จก็ได้ ค่าจะถูกเก็บไว้แล้วเอาไปใช้ตอนสร้าง gain
  function setLevels(next) {
    if (!next || typeof next !== 'object') return;
    ['pick', 'ban', 'timer'].forEach((name) => {
      const n = Number(next[name]);
      if (Number.isFinite(n) && n >= 0 && n <= 1) levels[name] = n;
    });
    applyLevels();
  }

  let badge = null;

  // หน้านี้เคยถูกแตะหรือยัง เบราว์เซอร์ปลดล็อกเสียงจากตรงนี้ ไม่ใช่จาก ctx.state
  function hasBeenActive() {
    return Boolean(global.navigator.userActivation && global.navigator.userActivation.hasBeenActive);
  }

  function showBadge() {
    if (inOBS || badge || !document.body) return;

    badge = document.createElement('div');
    badge.textContent = 'Click to enable sound';
    badge.setAttribute('style', [
      'position:fixed', 'left:16px', 'bottom:16px', 'z-index:99999',
      'padding:10px 16px', 'border-radius:8px',
      'background:rgba(0,0,0,0.82)', 'color:#f2f1ee',
      'border:1px solid rgba(215,178,106,0.6)',
      "font-family:'Segoe UI',system-ui,Arial,sans-serif", 'font-size:14px',
      'font-weight:600', 'cursor:pointer', 'user-select:none'
    ].join(';'));
    badge.addEventListener('click', unlock);
    document.body.appendChild(badge);
  }

  function hideBadge() {
    if (!badge) return;
    badge.remove();
    badge = null;
  }

  // เบราว์เซอร์เปิด AudioContext มาในสถานะ suspended จนกว่าผู้ใช้จะแตะหน้าสักครั้ง
  // resume() ต้องถูกเรียกในจังหวะของ event จริงๆ ถ้า await อะไรก่อนจะสายเกินไป
  // OBS ไม่มีข้อห้ามนี้ context จึง running ตั้งแต่แรกและป้ายไม่เคยขึ้น
  //
  // ห้ามรอผลของ resume() และห้ามใช้ ctx.state เป็นเงื่อนไขว่าจะเล่นหรือไม่
  //
  // บนเครื่องของผู้ใช้จริง resume() คืน promise ที่ไม่ resolve และไม่ reject เลย
  // ทั้งที่เสียงเล่นได้ปกติ (หน้า /sfx-test พิสูจน์แล้ว มันสั่ง resume แบบไม่รอ
  // แล้ว start() ทันที) ถ้ารอผลหรือเช็ค state ก่อน จะไม่มีวันได้เล่นสักครั้ง
  function unlock() {
    if (!ctx) return;
    ctx.resume().catch(() => { /* ขอไว้เฉยๆ ไม่ต้องรู้ผล */ });
    hideBadge();
  }

  // โหลดและ decode ไว้ล่วงหน้าตั้งแต่เปิดหน้า
  //
  // decode ครั้งเดียวตอนเริ่ม ตอนเล่นจริงจึงไม่มีดีเลย์ ดราฟต์รอไม่ได้
  // ไฟล์ไหนไม่มีก็ข้ามไป เหตุการณ์นั้นจะเงียบ ส่วนที่เหลือยังทำงาน
  async function load() {
    const Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) return;

    ctx = new Ctor();

    // gain แยกต่อเหตุการณ์ เพื่อให้หรี่ pick โดยไม่กระทบ ban ได้
    Object.keys(FILES).forEach((name) => {
      const node = ctx.createGain();
      node.connect(ctx.destination);
      gains[name] = node;
    });
    applyLevels();

    await Promise.all(Object.entries(FILES).map(async ([name, file]) => {
      for (const ext of EXTS) {
        try {
          const res = await fetch(`/sounds/${file}.${ext}?v=${encodeURIComponent(version)}`);
          if (!res.ok) continue;   // ไม่มีนามสกุลนี้ ลองอันถัดไป
          buffers[name] = await ctx.decodeAudioData(await res.arrayBuffer());
          return;
        } catch (error) {
          // โหลดไม่ได้หรือ decode ไม่ผ่าน ลองนามสกุลถัดไป
        }
      }
    }));

    // ขึ้นป้ายเฉพาะตอนที่ยังไม่มีใครแตะหน้านี้เลยจริงๆ
    //
    // ctx.state อย่างเดียวเชื่อไม่ได้: บนเครื่องที่ resume() ไม่ resolve
    // state จะค้างเป็น suspended ตลอดกาลทั้งที่เสียงออกปกติ ถ้าดูแค่ state
    // ป้ายจะขึ้นค้างไว้ตลอดรายการแล้วบอกให้คลิกทั้งที่ไม่ต้องคลิกอะไรแล้ว
    if (ctx.state === 'suspended' && !hasBeenActive()) showBadge();
  }

  // ก่อน arm() เสียงทุกอย่างถูกกลืนทิ้ง
  //
  // state ก้อนแรกที่มาถึงคือดราฟต์ทั้งกระดานพร้อมกัน ไม่ใช่การเปลี่ยนแปลง
  // ถ้าไม่กั้นไว้ เปิด OBS source กลางเกมทีเดียวจะได้เสียง pick รัวสิบกว่าครั้ง
  // overlay.js เรียก arm() ท้าย updateOverlay ครั้งแรก หลังวาดกระดานเสร็จแล้ว
  let armed = false;

  function arm() {
    armed = true;
  }

  function play(name) {
    if (!enabled || !armed || !ctx || !gains[name]) return;

    const buffer = buffers[name];
    if (!buffer) return;

    // ยังไม่ running ก็ขอปลดล็อกไว้ แล้วเล่นต่อไปเลย ไม่รอ ไม่ return
    // ถ้าเบราว์เซอร์ไม่ยอมจริงๆ start() จะเงียบไปเอง ซึ่งเสียหายน้อยกว่า
    // การไม่ยอมเล่นทั้งที่เล่นได้
    if (ctx.state !== 'running') ctx.resume().catch(() => { /* ขอไว้เฉยๆ */ });

    // แต่ละครั้งเป็น source ใหม่ ใช้ buffer ก้อนเดิม
    // pick สองครั้งติดกันเร็วๆ จึงดังซ้อนกันได้ ไม่ใช่ครั้งที่สองไปตัดครั้งแรก
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gains[name]);
    source.start();

    // ถ้าเคยมีคนแตะหน้านี้แล้ว ป้ายที่บอกให้คลิกก็หมดหน้าที่
    //
    // ห้ามซ่อนเพียงเพราะ start() ถูกเรียก: บน context ที่ยัง suspended
    // start() ไม่ error แต่ก็ไม่มีเสียงออก ซ่อนป้ายตอนนั้นคือโกหกผู้ใช้
    // ว่าเสียงทำงานแล้ว ทั้งที่ยังต้องคลิกอยู่
    if (hasBeenActive()) hideBadge();
  }

  if (enabled) {
    // คลิกที่ไหนก็ได้บนหน้าถือว่าอนุญาตแล้ว ไม่จำเป็นต้องกดที่ป้าย
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    load();
  }

  global.RovSfx = { enabled, play, arm, setLevels };
})(window);
