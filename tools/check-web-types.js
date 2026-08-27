// ตรวจชนิดของสคริปต์ฝั่งเบราว์เซอร์ ทีละหน้า
//
// public/js/ เป็นสคริปต์แบบคลาสสิก ทุกไฟล์ในหน้าเดียวกันแชร์ scope กัน
// ถ้าโยนทุกไฟล์เข้า tsc พร้อมกันครั้งเดียว จะได้ error ปลอมเป็นร้อย
// เพราะหลายหน้าประกาศ const socket / fetchJson ของตัวเอง ซึ่งไม่เคยเจอกันจริง
//
// จึงตรวจ "ตามหน้า" แทน: อ่านว่า html แต่ละไฟล์โหลด js อะไรบ้าง
// แล้วตรวจชุดนั้นเป็นโปรแกรมหนึ่งโปรแกรม ซึ่งตรงกับที่เบราว์เซอร์เห็นจริง
// วิธีนี้จับบั๊กแบบ Phase 3 ได้ตรงๆ: ไฟล์อ้างชื่อที่ไม่มีใครในหน้านั้นประกาศไว้

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
// ส่ง path แบบสัมพัทธ์กับ ROOT เสมอ
// path เต็มของโปรเจกต์นี้มีช่องว่างอยู่ ('rov overlay project')
// พอ execFileSync ใช้ shell บนวินโดวส์ อาร์กิวเมนต์จะถูกตัดตรงช่องว่างนั้น
const GLOBALS = 'types/web.d.ts';
const TSC_BIN = require.resolve('typescript/bin/tsc');
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

const TSC_FLAGS = [
  '--noEmit',
  '--allowJs',
  '--checkJs',
  '--target', 'ES2020',
  '--lib', 'ES2020,DOM,DOM.Iterable',
  '--moduleDetection', 'legacy',
  '--skipLibCheck'
];

// ดึงเฉพาะสคริปต์ของเราเอง ไม่เอา /socket.io/socket.io.js ที่เสิร์ฟจากไลบรารี
function scriptsIn(htmlFile) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const found = [];
  const pattern = /<script[^>]*src="([^"]+)"/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const src = match[1];
    if (!src.includes('/js/') && !src.startsWith('js/')) continue;
    const rel = src.replace(/^\//, '');
    found.push(path.join(PUBLIC_DIR, rel.replace(/^public\//, '')));
  }
  return found;
}

const pages = fs.readdirSync(PUBLIC_DIR)
  .filter((name) => name.endsWith('.html'))
  .map((name) => path.join(PUBLIC_DIR, name));

let failed = 0;
let checkedFiles = 0;
const seen = new Set();

pages.forEach((page) => {
  const scripts = scriptsIn(page).filter((file) => fs.existsSync(file));
  if (scripts.length === 0) return;

  scripts.forEach((file) => seen.add(file));
  checkedFiles += scripts.length;

  try {
    // เรียก tsc ผ่าน node ตรงๆ ไม่ผ่าน shell
    // npx ต้องใช้ shell บนวินโดวส์ ซึ่ง node เตือนเรื่องการต่อสตริงอาร์กิวเมนต์
    // และ path ของโปรเจกต์นี้มีช่องว่างอยู่ การเลี่ยง shell จึงปลอดภัยกว่าด้วย
    execFileSync(process.execPath, [TSC_BIN, ...TSC_FLAGS, GLOBALS, ...scripts.map(rel)], {
      cwd: ROOT,
      stdio: 'pipe'
    });
  } catch (error) {
    const output = String(error.stdout || '') + String(error.stderr || '');
    console.error(`\n${path.basename(page)}:`);
    console.error(output.trim());
    failed += 1;
  }
});

// ไฟล์ที่ไม่มีหน้าไหนโหลดเลย = ตายแล้ว หรือลืมใส่แท็ก script
const all = fs.readdirSync(path.join(PUBLIC_DIR, 'js'))
  .filter((n) => n.endsWith('.js'))
  .map((n) => path.join(PUBLIC_DIR, 'js', n))
  .concat(
    fs.readdirSync(path.join(PUBLIC_DIR, 'js', 'lib'))
      .filter((n) => n.endsWith('.js'))
      .map((n) => path.join(PUBLIC_DIR, 'js', 'lib', n))
  );
const orphans = all.filter((file) => !seen.has(file));

if (orphans.length > 0) {
  console.error(`\nnot loaded by any page: ${orphans.map((f) => path.basename(f)).join(', ')}`);
}

if (failed > 0) {
  console.error(`\ncheck-web-types: ${failed} page(s) with type errors`);
  process.exit(1);
}

console.log(`check-web-types: ${pages.length} pages, ${checkedFiles} script loads, no type errors`);
