// เทสต์ตารางคำแปล อ่านไฟล์ตรงๆ ไม่ได้รันมัน
//
// public/js/lib/i18n.js เป็นสคริปต์ของเบราว์เซอร์ แตะ window / document / localStorage
// ตั้งแต่ตอนโหลด การเอามารันใน Node ต้องปลอมของพวกนั้นให้ครบ ซึ่งเปราะกว่าตัวที่ตรวจ
// อ่านเป็นข้อความแล้วดึงตารางออกมาก็พอ เพราะสิ่งที่ต้องการรู้เป็นเรื่องของตัวข้อความล้วนๆ
//
// เรื่องที่ตั้งใจจับคือช่องแทนค่าไม่ตรงกันระหว่างต้นฉบับกับคำแปล
// tf('Deleted {name}') ที่คำแปลไทยเขียน {teamName} จะโชว์คำว่า {teamName} ดิบๆ บนจอ
// ไม่มี error ไม่มี log และคนที่เห็นคือผู้ใช้ ไม่ใช่คนเขียน

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const I18N = path.join(ROOT, 'public', 'js', 'lib', 'i18n.js');

function readSource(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

// ดึงคู่ 'กุญแจ': 'คำแปล' ออกจากตาราง TH
// ทั้งสองฝั่งเป็นสตริงเดี่ยวเสมอ (มีเทสต์ข้างล่างกันไม่ให้ใครเขียนเป็นการต่อสตริง)
function translationPairs(): [string, string][] {
  const source = readSource(I18N);
  const start = source.indexOf('const TH = {');
  assert.ok(start > -1, 'the translation table is still called TH');
  const table = source.slice(start, source.indexOf('\n  };', start));

  const pairs: [string, string][] = [];
  const re = /'((?:[^'\\]|\\.)*)':\s*\n?\s*'((?:[^'\\]|\\.)*)'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(table)) !== null) {
    pairs.push([match[1] as string, match[2] as string]);
  }
  assert.ok(pairs.length > 100, `found only ${pairs.length} translations, the parser is probably broken`);
  return pairs;
}

function placeholders(text: string): string[] {
  return (text.match(/\{\w+\}/g) || []).sort();
}

test('every Thai translation uses exactly the placeholders its English key has', () => {
  const wrong: string[] = [];
  translationPairs().forEach(([key, value]) => {
    const from = placeholders(key);
    const to = placeholders(value);
    if (from.join(',') !== to.join(',')) {
      wrong.push(`${JSON.stringify(key)}\n    English: ${from.join(' ') || '(none)'}\n    Thai:    ${to.join(' ') || '(none)'}`);
    }
  });

  assert.deepStrictEqual(
    wrong, [],
    // ขาดช่อง = ข้อมูลหายไปเงียบๆ / เกินช่อง = คำว่า {foo} ไปโผล่บนจอ
    `these translations do not carry the same placeholders as their key:\n  ${wrong.join('\n  ')}`
  );
});

test('no key is translated twice, because the second one wins in silence', () => {
  const seen = new Set<string>();
  const twice: string[] = [];
  translationPairs().forEach(([key]) => {
    if (seen.has(key)) twice.push(key);
    seen.add(key);
  });
  assert.deepStrictEqual(twice, [], `duplicated keys: ${twice.join(', ')}`);
});

// tf() มีไว้สำหรับข้อความที่มีข้อมูลแทรก ถ้ากรอบไม่มีช่องเลยแปลว่าเรียกผิดตัว
// ควรใช้ t() แทน ซึ่งอ่านง่ายกว่าและไม่ต้องเดาว่าค่าที่หายไปควรอยู่ตรงไหน
test('every tf() frame actually has a placeholder in it', () => {
  const bad: string[] = [];
  for (const file of browserScripts()) {
    const source = readSource(file);
    const re = /\btf\('((?:[^'\\]|\\.)*)'/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const key = match[1] as string;
      if (placeholders(key).length === 0) bad.push(`${path.basename(file)}: ${JSON.stringify(key)}`);
    }
  }
  assert.deepStrictEqual(bad, [], `tf() without a placeholder - use t() instead:\n  ${bad.join('\n  ')}`);
});

// กรอบที่มีข้อมูลแทรกต้องมีคำแปลเสมอ ต่างจากข้อความธรรมดาที่ตกไปเป็นอังกฤษได้เงียบๆ
// ประโยคที่ครึ่งหนึ่งเป็นไทยครึ่งหนึ่งเป็นอังกฤษอ่านเหมือนของเสีย มากกว่าอ่านเหมือนยังไม่ได้แปล
test('every tf() frame has a Thai translation', () => {
  const translated = new Set(translationPairs().map(([key]) => key));
  const missing: string[] = [];
  for (const file of browserScripts()) {
    const source = readSource(file);
    const re = /\btf\('((?:[^'\\]|\\.)*)'/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const key = (match[1] as string).replace(/\\'/g, "'");
      if (!translated.has(key)) missing.push(`${path.basename(file)}: ${JSON.stringify(key)}`);
    }
  }
  assert.deepStrictEqual(missing, [], `no Thai for these frames:\n  ${missing.join('\n  ')}`);
});

// หน้าจอของคนดูไม่แปล เป็นการตัดสินใจของงานถ่ายทอด ไม่ใช่ของหน้าคนคุม
// เทสต์นี้กันไม่ให้ใครเผลอเรียก t() ในไฟล์ของ overlay ซึ่งจะพังทันทีเพราะไม่มีโมดูลโหลดอยู่
test('broadcast scripts never call the translator', () => {
  const broadcast = ['overlay.js', 'overlay-teams.js', 'result.js', 'overlay-sfx.js'];
  broadcast.forEach((name) => {
    const file = path.join(ROOT, 'public', 'js', name);
    if (!fs.existsSync(file)) return;
    assert.ok(
      !/\btf?\(/.test(readSource(file).replace(/\bif\s*\(/g, '')),
      `${name} must not translate anything - viewers see English`
    );
  });
});

function browserScripts(): string[] {
  const dir = path.join(ROOT, 'public', 'js');
  const found: string[] = [];
  const walk = (at: string): void => {
    fs.readdirSync(at, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) found.push(full);
    });
  };
  walk(dir);
  return found;
}
