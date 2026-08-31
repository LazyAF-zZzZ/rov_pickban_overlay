const http = require('http');
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');

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
          // ผู้ใช้ต้องเอาไฟล์เสียงมาวางเอง โฟลเดอร์อยู่คนละที่กันระหว่างรันจาก
          // source กับรันจากตัวติดตั้ง เปิดให้เลยง่ายกว่าบอกเป็น path ให้ไปหาเอง
          label: 'Open Sounds Folder',
          click: () => shell.openPath(path.join(app.getPath('userData'), 'media', 'sounds'))
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

  await startServerIfNeeded();
  Menu.setApplicationMenu(buildMenu());
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

app.on('before-quit', () => {
  if (serverStartedByApp) {
    console.log('Closing ROV Overlay Tool app and local server.');
  }
});
