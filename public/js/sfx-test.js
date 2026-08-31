// หน้าตรวจเสียง ตอบคำถามเดียว: "ทำไมไม่มีเสียง"
//
// จุดสำคัญคือมันถูกเปิดเป็น browser source ใน OBS ได้ ผลตรวจจึงต้องเป็นตัวหนังสือ
// บนหน้าจอ ไม่ใช่ console.log เพราะ OBS ไม่มีทางให้เปิด console ดู
//
// ต้องใช้ Web Audio เหมือน overlay-sfx.js ห้ามใช้ <audio> เด็ดขาด
// บนเครื่องที่ <audio> พัง (ค้างที่ readyState 0 แบบไม่มี error) หน้านี้จะรายงาน
// ผลผิดหมด แล้วเครื่องมือแก้ปัญหาก็กลายเป็นตัวหลอกเสียเอง ซึ่งแย่กว่าไม่มีเลย
//
// ไม่ใช้ app-client.js เพราะหน้านี้ต้องเปิดได้แม้ socket ต่อไม่ติด
// ตัวมันเองคือเครื่องมือแก้ปัญหา จะพังตามสิ่งที่กำลังตรวจอยู่ไม่ได้

const SOUNDS = [
  { key: 'pick', label: 'pick', when: 'when a hero is picked' },
  { key: 'ban', label: 'ban', when: 'when a hero is banned' },
  { key: 'timer', label: 'timer-warning', when: 'each of the last 10 seconds' }
];

const inOBS = typeof window.obsstudio === 'object' && window.obsstudio !== null;

/** @type {AudioContext | null} */
let ctx = null;
/** @type {Record<string, AudioBuffer>} */
const buffers = {};

function setVerdict(kind, head, lines) {
  const box = document.getElementById('verdict');
  box.className = `verdict ${kind}`;
  document.getElementById('verdictHead').textContent = head;

  const body = document.getElementById('verdictBody');
  body.textContent = '';
  lines.forEach((line) => {
    const p = document.createElement('p');
    p.textContent = line;
    body.appendChild(p);
  });
}

function playButton(key) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tlink primary';
  btn.textContent = 'PLAY';
  btn.disabled = !buffers[key];

  btn.addEventListener('click', () => {
    if (!ctx || !buffers[key]) return;
    // คลิกคือการอนุญาต resume ตรงนี้จึงผ่านเสมอ
    ctx.resume().catch(() => { /* ไม่ผ่านก็ยังเล่นไม่ได้อยู่ดี */ });

    const source = ctx.createBufferSource();
    source.buffer = buffers[key];
    source.connect(ctx.destination);
    source.start();
  });

  return btn;
}

function renderFiles(found) {
  const list = document.getElementById('fileList');
  list.textContent = '';

  SOUNDS.forEach((sound) => {
    const info = found[sound.key];
    const decoded = buffers[sound.key];

    const row = document.createElement('div');
    row.className = 'srow';

    const name = document.createElement('div');
    name.className = 'sname';
    name.textContent = info ? info.file : `${sound.label}.mp3`;

    const state = document.createElement('div');
    state.className = `sstate ${info ? '' : 'missing'}`.trim();
    if (!info) {
      state.textContent = `missing — put ${sound.label}.mp3 (or .wav) in the folder below`;
    } else if (decoded) {
      state.textContent =
        `ready, ${Math.round(info.bytes / 1024)} KB, ${decoded.duration.toFixed(2)}s — ${sound.when}`;
    } else {
      state.className = 'sstate missing';
      state.textContent = 'found on disk but could not be decoded — re-export it as a plain MP3';
    }

    row.append(name, state, playButton(sound.key));
    list.appendChild(row);
  });
}

// โหลดและ decode ทุกไฟล์ที่เซิร์ฟเวอร์บอกว่ามี
// decode ผ่าน = ไฟล์ใช้ได้จริง ไม่ใช่แค่มีอยู่
async function decodeAll(found) {
  await Promise.all(SOUNDS.map(async (sound) => {
    const info = found[sound.key];
    if (!info || !ctx) return;
    try {
      const res = await fetch(info.url);
      if (!res.ok) return;
      buffers[sound.key] = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch (error) {
      // decode ไม่ผ่าน ปล่อยให้ renderFiles รายงานว่าไฟล์ใช้ไม่ได้
    }
  }));
}

async function boot() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) {
    setVerdict('bad', 'This browser has no Web Audio', [
      'Nothing here can play sound. Use a current version of Chrome, Edge or OBS.'
    ]);
    return;
  }
  ctx = new Ctor();

  let report = { dir: '', sounds: {} };
  try {
    report = await (await fetch('/api/sounds')).json();
  } catch (error) {
    setVerdict('bad', 'Cannot reach the app', [
      'This page loaded but the app did not answer. Is the ROV Overlay Tool still running?'
    ]);
    return;
  }

  document.getElementById('folderPath').textContent = report.dir;
  await decodeAll(report.sounds);
  renderFiles(report.sounds);

  const ready = SOUNDS.filter((s) => buffers[s.key]).map((s) => s.label);
  const missing = SOUNDS.filter((s) => !report.sounds[s.key]).map((s) => s.label);

  if (!ready.length) {
    setVerdict('bad', missing.length === SOUNDS.length ? 'No sound files found' : 'No sound file could be decoded', [
      missing.length === SOUNDS.length
        ? 'The folder shown below is empty, so there is nothing for the overlay to play.'
        : 'The files are there but none of them decoded. Re-export them as plain MP3 or WAV.',
      'Put pick.mp3, ban.mp3 and timer-warning.mp3 in the folder below, then reload this page.'
    ]);
    return;
  }

  if (ctx.state === 'running') {
    setVerdict('good', 'Sound is working here', [
      `Decoded and ready: ${ready.join(', ')}.`,
      missing.length ? `Still missing: ${missing.join(', ')} — those events stay silent.` : 'All three sounds are in place.',
      inOBS
        ? 'This is running inside OBS. If the overlay is still silent, its URL is missing ?sfx=1, or the source needs a Refresh.'
        : 'If the overlay is still silent, its URL is missing ?sfx=1, or it needs a reload.'
    ]);
    return;
  }

  // suspended = ยังไม่ได้รับอนุญาตจากผู้ใช้ ไม่ใช่ความผิดพลาด
  setVerdict('bad', 'Waiting for a click before sound can play', [
    'The browser will not let a page make sound until you click on it once. That is a browser rule, not a fault in the app.',
    'Press one of the PLAY buttons above — after that, sound works for the rest of this page visit.',
    'Inside OBS this restriction does not exist, so the overlay plays on its own there.'
  ]);

  const wake = () => {
    if (!ctx) return;
    ctx.resume().then(() => {
      if (ctx && ctx.state === 'running') {
        setVerdict('good', 'Sound is working here', [
          `Decoded and ready: ${ready.join(', ')}.`,
          'Press PLAY above to hear each one.'
        ]);
      }
    }).catch(() => { /* ยังต้องรอคลิกจริง */ });
  };
  document.addEventListener('pointerdown', wake);
  document.addEventListener('keydown', wake);
}

boot();
