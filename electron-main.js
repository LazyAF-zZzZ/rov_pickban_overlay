const http = require('http');
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, dialog, shell, globalShortcut } = require('electron');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 3000;
const BASE_URL = `http://${HOST}:${PORT}`;
const AGREEMENT_VERSION = 'noncommercial-v2';
const APP_ICON_PATH = path.join(__dirname, 'public', 'images', 'app-icon.ico');

const LICENSE_SUMMARY = [
  'ROV Overlay Tool is provided free for tournament, community, education, and personal broadcast use.',
  '',
  'You may use, copy, and share this app for free.',
  '',
  'You may not sell this app, resell it, rent it, include it in a paid package, charge for access to it, or claim it as your own product.',
  '',
  'If you modify or redistribute it, you must keep the license/credit notice and keep it free for users.',
  '',
  'Game names, hero images, logos, and other third-party assets belong to their respective owners.'
].join('\n');

let mainWindow;
let serverStartedByApp = false;

function agreementPath() {
  return path.join(app.getPath('userData'), 'agreement.json');
}

function hasAcceptedAgreement() {
  try {
    const data = JSON.parse(fs.readFileSync(agreementPath(), 'utf8'));
    return data && data.version === AGREEMENT_VERSION && data.accepted === true;
  } catch {
    return false;
  }
}

function saveAgreement() {
  fs.mkdirSync(path.dirname(agreementPath()), { recursive: true });
  fs.writeFileSync(
    agreementPath(),
    `${JSON.stringify({
      accepted: true,
      version: AGREEMENT_VERSION,
      acceptedAt: new Date().toISOString()
    }, null, 2)}\n`,
    'utf8'
  );
}

async function requireAgreement() {
  if (hasAcceptedAgreement()) return true;

  const result = await dialog.showMessageBox({
    type: 'warning',
    title: 'ROV Overlay Tool License Agreement',
    message: 'Free use only. Resale is not allowed.',
    detail: LICENSE_SUMMARY,
    buttons: ['I Agree', 'Exit'],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  });

  if (result.response !== 0) return false;
  saveAgreement();
  return true;
}

function showLicenseNotice() {
  dialog.showMessageBox({
    type: 'info',
    title: 'License / Terms',
    message: 'ROV Overlay Tool license summary',
    detail: LICENSE_SUMMARY,
    buttons: ['OK'],
    defaultId: 0,
    noLink: true
  });
}

function checkServer() {
  return new Promise((resolve) => {
    const req = http.get(BASE_URL, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });

    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForServer(timeoutMs = 8000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await checkServer()) return resolve();
      if (Date.now() - startedAt > timeoutMs) {
        return reject(new Error(`Server did not start at ${BASE_URL}`));
      }
      setTimeout(tick, 250);
    };

    tick();
  });
}

async function startServerIfNeeded() {
  if (await checkServer()) return;

  serverStartedByApp = true;
  process.env.ROV_USER_DATA_DIR = path.join(app.getPath('userData'), 'data');
  // ภาพที่อัปโหลดต้องอยู่นอก app.asar ไม่งั้นเขียนไม่ได้ (ENOTDIR)
  process.env.ROV_USER_MEDIA_DIR = path.join(app.getPath('userData'), 'media');
  require(path.join(__dirname, 'server.js'));
  await waitForServer();
}

// คีย์ลัดระดับระบบ -----------------------------------------------------------
//
// เหตุผลที่ต้องอยู่ตรงนี้: หน้าเว็บจองปุ่มกับระบบปฏิบัติการไม่ได้
// คีย์ลัดของหน้า Control ทำงานเฉพาะตอนหน้าต่างนั้นถูกโฟกัส ซึ่งไม่ใช่ท่าที่คนแคสต์ใช้จริง
// (โฟกัสอยู่ที่ OBS หรือที่เกม) มีแต่ process หลักของ Electron ที่จองได้
//
// ค่าอยู่ใน state ฝั่งเซิร์ฟเวอร์ ตั้งจากหน้า /hotkeys ตรงนี้จึงต้องคอยถามว่าเปลี่ยนหรือยัง
// ถามด้วย HTTP แบบวนถาม ไม่ใช่ socket ตั้งใจ: process นี้ไม่มี socket.io-client
// และแอพรองรับกรณีเซิร์ฟเวอร์ถูกสตาร์ทไว้ก่อนจากที่อื่น ซึ่ง require ตรงๆ ก็ไม่ได้
// การถาม localhost ทุกสองวินาทีถูกกว่าการมีสองเส้นทางให้ดูแล
const HOTKEY_POLL_MS = 2000;

let heldAccelerators = [];
let lastHotkeySignature = '';
let hotkeyPollTimer = null;

function apiRequest(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(payload.length);
    }
    // โทเคนอ่านตอนยิงทุกครั้ง ไม่ได้เก็บไว้ตอนเริ่ม เพราะ startServerIfNeeded
    // อาจตั้งค่า env ทีหลังในรอบชีวิตเดียวกัน
    if (process.env.CONTROL_TOKEN) {
      headers.Authorization = `Bearer ${process.env.CONTROL_TOKEN}`;
    }

    const req = http.request(
      { host: HOST, port: PORT, path: pathname, method, headers },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`${method} ${pathname} -> ${res.statusCode}`));
            return;
          }
          try { resolve(text ? JSON.parse(text) : {}); } catch (error) { reject(error); }
        });
      }
    );

    req.on('error', reject);
    req.setTimeout(1500, () => req.destroy(new Error('timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

function releaseGlobalHotkeys() {
  heldAccelerators.forEach((accelerator) => {
    try { globalShortcut.unregister(accelerator); } catch { /* จองไม่ติดอยู่แล้ว */ }
  });
  heldAccelerators = [];
}

// จองใหม่เฉพาะตอนค่าเปลี่ยนจริง ไม่ใช่ทุกครั้งที่ถาม
// ปลดแล้วจองใหม่ทุกสองวินาทีคือช่องว่างสั้นๆ ที่ปุ่มไม่ทำงาน ทุกสองวินาที
//
// ลายเซ็นต้องมาจากเฉพาะสิ่งที่กำหนด "ต้องจองอะไรบ้าง" คือ enabled กับ accelerators
//
// ห้ามเอาทั้งก้อนที่ได้จาก GET มาทำลายเซ็น เพราะในนั้นมี held ซึ่งเป็นผลลัพธ์ที่
// เราเป็นคน POST กลับไปเอง มันจึงกลายเป็นวงจรที่ป้อนตัวเอง: รอบแรก held เป็น null
// เราจอง แล้วรายงานกลับ รอบสอง GET ได้ held ที่เพิ่งส่งไป ลายเซ็นเลยเปลี่ยน
// แล้วปลดคีย์ทั้งชุดจองใหม่ทั้งที่ไม่มีอะไรเปลี่ยนเลย เกิดขึ้นสองวินาทีหลังเปิดแอพพอดี
function applyGlobalHotkeys(config) {
  const signature = JSON.stringify({
    enabled: Boolean(config && config.enabled),
    accelerators: (config && config.accelerators) || {}
  });

  // เซิร์ฟเวอร์ลืมว่าเราจองอะไรไว้ ก็บอกมันใหม่ โดยไม่ต้องไปยุ่งกับคีย์ที่จองอยู่
  //
  // เกิดได้สองทาง: POST รอบก่อนล้มเหลว (มันกลืน error เงียบๆ และมี timeout 1.5 วินาที)
  // หรือเซิร์ฟเวอร์ถูกสตาร์ทใหม่โดยที่แอพยังเปิดอยู่ (โหมดที่ต่อกับเซิร์ฟเวอร์ข้างนอก)
  // อาการคือหน้า /hotkeys กลับไปบอกว่าจองติดครบทุกปุ่ม ซึ่งเป็นคำโกหกแบบเดียวกับ
  // ที่ระบบรายงานนี้ถูกสร้างมาเพื่อกำจัด
  if (signature === lastHotkeySignature) {
    const serverHeld = config && config.held;
    const known = Array.isArray(serverHeld) ? JSON.stringify(serverHeld) : null;
    if (known !== JSON.stringify(heldAccelerators)) reportHeldAccelerators();
    return;
  }
  lastHotkeySignature = signature;

  releaseGlobalHotkeys();
  if (!config || !config.enabled) {
    reportHeldAccelerators();
    return;
  }

  Object.entries(config.accelerators || {}).forEach(([action, accelerator]) => {
    let ok = false;
    // register คืน false เมื่อโปรแกรมอื่นจองปุ่มนี้ไว้ก่อน ไม่ใช่ความผิดพลาดของเรา
    // และ throw ได้ถ้าข้อความ accelerator ใช้ไม่ได้ กันไว้ทั้งสองทาง
    // ตัวที่จองไม่ได้ต้องไม่ทำให้ตัวที่เหลือไม่ถูกจอง
    try {
      ok = globalShortcut.register(accelerator, () => {
        apiRequest('POST', '/api/global-hotkeys/fire', { action })
          .catch((error) => console.warn(`Global hotkey ${action} failed:`, error.message));
      });
    } catch (error) {
      ok = false;
    }

    if (ok) heldAccelerators.push(accelerator);
    else console.warn(`Global hotkey ${accelerator} (${action}) could not be registered - another program may hold it`);
  });

  reportHeldAccelerators();
}

// บอกเซิร์ฟเวอร์ว่าจองติดจริงกี่ปุ่ม เพื่อให้หน้า /hotkeys พูดตรงกับความจริง
//
// ไม่มีทางนี้ หน้าจะบอกว่าจองครบทุกปุ่มเสมอ แล้วปุ่มที่โปรแกรมอื่นในเครื่องยึดไว้ก่อน
// จะกลายเป็น "กดแล้วไม่มีอะไรเกิดขึ้น" ซึ่งเป็นอาการเดียวกับของเสีย
function reportHeldAccelerators() {
  apiRequest('POST', '/api/global-hotkeys/registered', { held: heldAccelerators })
    .catch(() => { /* เซิร์ฟเวอร์ปิดไปแล้ว ไม่มีใครรอฟังอยู่ */ });
}

function watchGlobalHotkeys() {
  const tick = () => {
    apiRequest('GET', '/api/global-hotkeys')
      .then(applyGlobalHotkeys)
      .catch(() => { /* เซิร์ฟเวอร์ยังไม่พร้อมหรือปิดไปแล้ว รอบหน้าค่อยถามใหม่ */ });
  };
  tick();
  hotkeyPollTimer = setInterval(tick, HOTKEY_POLL_MS);
}

// โฟลเดอร์เสียง อ่านจาก config ตัวเดียวกับที่เซิร์ฟเวอร์ใช้
//
// เมนูที่เปิดคนละโฟลเดอร์กับที่โปรแกรมอ่าน แปลว่าคนวางไฟล์ถูกที่ตามเมนูแล้วไม่มีเสียง
// ซึ่งหาสาเหตุไม่เจอเลย จึงไม่คำนวณเส้นทางเองซ้ำอีกชุด
//
// ถ้า build/ ยังไม่มี (ยังไม่ได้คอมไพล์) ค่อยคำนวณเอง เมนูจะได้ไม่พังทั้งอัน
// ส่วนตัวเซิร์ฟเวอร์เองก็เปิดไม่ขึ้นอยู่แล้วในสถานะนั้น (ดู server.js)
function soundsDir() {
  try {
    return require(path.join(__dirname, 'build', 'server', 'config')).USER_SOUND_DIR;
  } catch (error) {
    return path.join(__dirname, 'public', 'images', 'sounds');
  }
}

function createWindow(route = '/', options = {}) {
  const targetUrl = `${BASE_URL}${route}`;
  const windowTitle = options.title || 'ROV Overlay Tool';
  const win = new BrowserWindow({
    width: options.width || 1280,
    height: options.height || 820,
    minWidth: options.minWidth || 960,
    minHeight: options.minHeight || 640,
    title: windowTitle,
    icon: APP_ICON_PATH,
    backgroundColor: '#0f172a',
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.on('page-title-updated', (event) => {
    event.preventDefault();
    win.setTitle(windowTitle);
  });

  win.loadURL(targetUrl);
  return win;
}

function openToolWindow(label, route, width, height) {
  const targetUrl = `${BASE_URL}${route}`;
  createWindow(route, {
    title: `${label} - ${targetUrl}`,
    width,
    height,
    minWidth: Math.min(width, 960),
    minHeight: Math.min(height, 640)
  });
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'ROV Tool',
      submenu: [
        {
          // หน้าต่างหลักเปิดที่ / ซึ่งตอนนี้เป็นหน้าแรก ไม่ใช่ control panel
          label: 'Home',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.focus();
            } else {
              mainWindow = createWindow('/');
            }
          }
        },
        {
          label: 'Control Panel',
          click: () => openToolWindow('Control Panel', '/control', 1280, 900)
        },
        {
          label: 'Overlay 1080p',
          click: () => openToolWindow('Overlay 1920x1080', '/overlay', 1920, 1080)
        },
        {
          label: 'Overlay 1440p',
          click: () => openToolWindow('Overlay 2560x1440', '/overlay-1440', 1600, 900)
        },
        {
          label: 'Result',
          click: () => openToolWindow('Result', '/result', 1440, 900)
        },
        { type: 'separator' },
        {
          label: 'Custom Design',
          click: () => openToolWindow('Custom Design', '/design', 1280, 900)
        },
        { type: 'separator' },
        {
          // ผู้ใช้ต้องเอาไฟล์เสียงมาวางเอง เปิดให้เลยง่ายกว่าบอกเป็น path ให้ไปหาเอง
          //
          // ต้องเป็นโฟลเดอร์เดียวกับ USER_SOUND_DIR ใน server/config.ts เป๊ะๆ
          // เมนูที่เปิดคนละโฟลเดอร์กับที่โปรแกรมอ่าน แปลว่าคนวางไฟล์ถูกที่ตามเมนู
          // แล้วไม่มีเสียง ซึ่งหาสาเหตุไม่เจอเลย
          label: 'Open Sounds Folder',
          click: () => shell.openPath(soundsDir())
        },
        { type: 'separator' },
        {
          label: 'Open In Browser',
          click: () => shell.openExternal(BASE_URL)
        },
        {
          label: 'License / Terms',
          click: () => showLicenseNotice()
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'toggleDevTools', label: 'Developer Tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Reset Zoom' },
        { role: 'zoomIn', label: 'Zoom In' },
        { role: 'zoomOut', label: 'Zoom Out' }
      ]
    }
  ]);
}

app.whenReady().then(async () => {
  const accepted = await requireAgreement();
  if (!accepted) {
    app.quit();
    return;
  }

  // เซิร์ฟเวอร์ไม่ขึ้นต้องบอก ไม่ใช่เงียบ
  //
  // ก่อนหน้านี้ปล่อยให้ throw ทะลุออกจาก whenReady().then() ซึ่งไม่มีใครรับ
  // แอพจะค้างอยู่ในหน่วยความจำโดยไม่มีหน้าต่าง ไม่มีเมนู และไม่มีข้อความอะไรเลย
  // อาการที่ผู้ใช้เห็นคือ "ดับเบิลคลิกแล้วไม่มีอะไรเกิดขึ้น" ซึ่งเดาสาเหตุไม่ได้เลย
  // (เจอได้จริงเมื่อพอร์ต 3000 ถูกโปรแกรมอื่นยึด หรือยังไม่ได้ npm run build)
  try {
    await startServerIfNeeded();
  } catch (error) {
    dialog.showMessageBoxSync({
      type: 'error',
      title: 'ROV Overlay Tool',
      message: 'The local server did not start.',
      detail: `${error.message}\n\nAnother program may be using port ${PORT}. `
        + 'Close it and open ROV Overlay Tool again.',
      buttons: ['Exit'],
      noLink: true
    });
    app.quit();
    return;
  }

  Menu.setApplicationMenu(buildMenu());
  watchGlobalHotkeys();
  mainWindow = createWindow('/');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow('/');
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ปุ่มที่จองไว้ต้องคืนระบบก่อนปิด ไม่งั้นในบางกรณีปุ่มค้างอยู่กับ process ที่ตายไปแล้ว
app.on('will-quit', () => {
  if (hotkeyPollTimer) clearInterval(hotkeyPollTimer);
  releaseGlobalHotkeys();
  globalShortcut.unregisterAll();
  // บอกด้วยว่าตอนนี้ไม่ได้ถือปุ่มไหนแล้ว เผื่อเซิร์ฟเวอร์ยังทำงานต่อหลังแอพปิด
  reportHeldAccelerators();
});

app.on('before-quit', () => {
  if (serverStartedByApp) {
    console.log('Closing ROV Overlay Tool app and local server.');
  }
});
