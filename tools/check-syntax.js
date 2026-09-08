// ตรวจไฟล์ JS ทุกไฟล์ในโปรเจกต์: parse ผ่านไหม และมีอักขระควบคุมหลงมาไหม
//
// ที่ต้องเช็คอักขระควบคุม เพราะ regex ที่เขียนช่วงอักขระควบคุมด้วย escape
// ถ้าถูกแก้ผ่านเครื่องมือที่ตีความ escape ผิด จะกลายเป็นไบต์จริงฝังในซอร์ส
// โค้ดยังรันได้ปกติ แต่ diff/editor/git จะเริ่มเพี้ยนแบบหาสาเหตุไม่เจอ
//
// tab กับ CR ปล่อยผ่าน ในโปรเจกต์นี้มีทั้งไฟล์ LF และ CRLF ปนกันอยู่แล้ว

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
// build/ คือผลลัพธ์จากคอมไพเลอร์ ไม่ใช่ซอร์ส ไม่ต้องตรวจ
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'backups', '_archive']);
const SKIP_FILES = new Set(['__oracle.js', '__original-server.js']);
const ALLOWED_CONTROL = new Set([9, 13]); // tab, CR

let checked = 0;
const problems = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('__')) continue;
      walk(path.join(dir, entry.name));
      continue;
    }
    const isJs = entry.name.endsWith('.js');
    const isTs = entry.name.endsWith('.ts');
    if ((!isJs && !isTs) || SKIP_FILES.has(entry.name)) continue;

    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full);
    checked += 1;

    fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
      const codes = [...line]
        .map((c) => c.charCodeAt(0))
        .filter((c) => (c < 32 || c === 127) && !ALLOWED_CONTROL.has(c));
      if (codes.length) problems.push(`${rel}:${i + 1} control chars ${JSON.stringify(codes)}`);
    });

    // node --check อ่าน TypeScript ไม่ได้ ไวยากรณ์ของ .ts ให้ tsc ตรวจ
    // ที่นี่จึงตรวจแค่ .js (ตัวเปิดแอพ, สคริปต์เครื่องมือ, ไฟล์หน้าเว็บ)
    if (!isJs) continue;

    try {
      execFileSync(process.execPath, ['--check', full], { stdio: 'pipe' });
    } catch (error) {
      problems.push(`${rel} syntax error\n${error.stderr.toString().split('\n').slice(0, 3).join('\n')}`);
    }
  }
}

walk(ROOT);

// package.json ยังครบไหม
//
// ไฟล์นี้ถือทั้งสคริปต์ที่ใช้ทำงานทุกอย่าง และ build.files ที่กันข้อมูลของผู้ใช้
// ออกจากตัวติดตั้ง ถ้ามันถูกเขียนทับ ทุกอย่างพังเงียบๆ: npm test หาสคริปต์ไม่เจอ
// และตัวติดตั้งรอบถัดไปอาจแพ็ค state กับโลโก้ทีมของเครื่องที่ build ไปด้วย
//
// เกิดขึ้นมาแล้วจริงตอนออกรุ่น 2.0.0 (2026-09-08) คำสั่งที่ใช้ตรวจตัวติดตั้ง
//   npx asar extract-file dist/win-unpacked/resources/app.asar package.json
// ถูกรันจากรากโปรเจกต์ asar เขียนไฟล์ที่แตกออกมาลง "โฟลเดอร์ปัจจุบัน" เสมอ
// package.json ของโปรเจกต์จึงถูกทับด้วยสำเนาที่อยู่ในแอพ ซึ่ง electron-builder
// ตัด scripts / devDependencies / build ทิ้งไปแล้วตอนแพ็ค
// ผลคือ 91 บรรทัดหายไปโดยไม่มีอะไรฟ้อง จนกว่าจะมีคนสั่ง npm อีกครั้ง
//
// (electron-builder ไม่ได้แตะไฟล์นี้ ยืนยันแล้วด้วยการรันแยกทีละขั้น)
// จะแตกไฟล์จาก asar มาดู ต้อง cd ไปโฟลเดอร์ชั่วคราวก่อนเสมอ
const REQUIRED_SCRIPTS = ['build', 'typecheck', 'typecheck:web', 'test', 'check', 'dist', 'start', 'app'];
// สองบรรทัดนี้คือสิ่งที่กันข้อมูลของผู้ใช้ออกจากไฟล์ .exe ห้ามหาย
const REQUIRED_EXCLUDES = ['!data/state.json', '!data/tournament.db*'];

try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  REQUIRED_SCRIPTS.forEach((name) => {
    if (!pkg.scripts || !pkg.scripts[name]) {
      problems.push(`package.json lost the "${name}" script`);
    }
  });
  if (!pkg.devDependencies || Object.keys(pkg.devDependencies).length === 0) {
    problems.push('package.json lost its devDependencies');
  }
  if (!pkg.main) problems.push('package.json lost "main", the Electron entry point');

  const buildFiles = (pkg.build && pkg.build.files) || [];
  if (buildFiles.length === 0) {
    problems.push('package.json lost build.files, which the installer is built from');
  }
  REQUIRED_EXCLUDES.forEach((entry) => {
    if (buildFiles.length && !buildFiles.includes(entry)) {
      problems.push(`build.files no longer excludes ${entry} - the installer would ship the builder's own data`);
    }
  });
} catch (error) {
  problems.push('package.json could not be read: ' + error.message);
}

if (problems.length) {
  console.error(`${problems.length} problem(s):`);
  problems.forEach((p) => console.error(`  ${p}`));
  process.exit(1);
}
console.log(`check: ${checked} JS files parse cleanly, no stray control characters, package.json intact`);
