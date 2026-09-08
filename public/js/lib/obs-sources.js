// รายการ URL ที่เอาไปวางเป็น browser source ใน OBS
//
// ใช้ทั้งหน้า Control และหน้าทัวร์นาเมนต์ เดิมอยู่ในหน้าทัวร์นาเมนต์ที่เดียว
// พอหน้า Control ต้องใช้ด้วย จึงย้ายมาไว้ที่เดียวกันตั้งแต่ยังมีสองที่
// (กฎเดียวกับ team-ui.js: สองชุดที่แก้คนละที่คือที่มาของบั๊กเดิม)
//
// วิธีใช้:
//   <script src="/js/lib/app-client.js"></script>
//   <script src="/js/lib/obs-sources.js"></script>
//   <script src="/js/หน้าใหม่.js"></script>
// แล้วเรียก
//   window.RovObsSources.render(document.getElementById('sources'));
//   window.RovObsSources.render(el, { tournamentId });   // ถ้าหน้านั้นผูกกับทัวร์นาเมนต์
//
// ต้องโหลดหลัง app-client.js เพราะอ่าน absoluteUrl / withToken / showToast

(function (global) {
  const { absoluteUrl, withToken, showToast } = global.RovClient;

  // sfx: true = URL ที่ก๊อปไปมี ?sfx=1 ติดมาให้เลย
  //
  // ค่าเริ่มต้นคือ "มีเสียง" เพราะการต้องมาพิมพ์ ?sfx=1 ต่อท้ายเองคือขั้นตอนที่
  // ลืมได้ง่ายที่สุด และอาการเวลาลืมคือ "เงียบ" ซึ่งแยกไม่ออกจากของเสีย
  // ใครไม่อยากได้เสียงก็ลบทิ้งได้ ซึ่งเห็นชัดกว่าการต้องรู้ว่าต้องเติมอะไร
  //
  // result กับ team list ไม่มี เพราะสองหน้านั้นไม่ได้โหลดตัวเล่นเสียงอยู่แล้ว
  const SOURCES = [
    { name: 'Overlay 1080p', path: '/overlay', size: '1920 x 1080', sfx: true },
    { name: 'Overlay 1440p', path: '/overlay-1440', size: '2560 x 1440', sfx: true },
    { name: 'Result', path: '/result', size: 'matches overlay size' },
    // ดราฟต์ของรอบก่อนหน้า หนึ่งแถว หนึ่ง browser source
    // ไม่มี ?sfx=1 เพราะหน้านี้ไม่ได้โหลดตัวเล่นเสียง เหมือน result กับ team list
    //
    // เดิมเป็นสองแถวแยกพิคกับแบน ผู้ใช้ขอให้รวมเป็นหน้าเดียวแล้วลบสองหน้านั้นทิ้ง
    // (2026-09-08) ตอนนี้เหลือกระดานเดียว ไม่มี URL แยกให้พิมพ์เองอีกแล้ว
    { name: 'Previous picks & bans', path: '/overlay-prev', size: 'matches overlay size' },
    // ตารางคะแนนของรอบแบ่งกลุ่ม ต้องแนบ id เหมือนรายชื่อทีมและกระดานสถิติ
    { name: 'Standings', path: '/overlay-standings', size: 'matches overlay size', perTournament: true },
    // หัวต่อหัว ไม่ต้องแนบ id: ไม่ระบุคู่มา มันจะตามคู่ที่กำลังออกอากาศเอง
    // ซึ่งเป็นสิ่งที่คนก๊อป URL ไปวางในฉาก "ก่อนเริ่มคู่" ต้องการพอดี
    { name: 'Head to head', path: '/overlay-matchup', size: 'matches overlay size' },
    // หน้าตาเหมือนหัวต่อหัว แต่นับทุกเกมของแต่ละทีมในรายการ ไม่ใช่เฉพาะเกมที่เจอกันเอง
    // ไม่ต้องแนบ id ด้วยเหตุผลเดียวกัน: ไม่ระบุมา มันตามคู่ที่ออกอากาศเอง
    { name: 'Team picks & bans', path: '/overlay-team-drafts', size: 'matches overlay size' },
    // รายชื่อทีมของทัวร์นาเมนต์นี้ ต้องแนบ id ไปกับ URL ด้วย
    // ไม่งั้น overlay จะเดาเอาจากแมตช์ที่ออกอากาศ ซึ่งไม่ใช่สิ่งที่คนก๊อป URL
    // จากหน้าทัวร์นาเมนต์ตั้งใจ ส่วนหน้า Control ไม่มี id ให้แนบ การเดาจาก
    // แมตช์ที่ออกอากาศจึงเป็นสิ่งที่ถูกต้องพอดีสำหรับหน้านั้น
    { name: 'Team list', path: '/overlay-teams', size: 'matches overlay size', perTournament: true },
    // กระดานสถิติของทัวร์นาเมนต์นี้ ต้องแนบ id เหมือนรายชื่อทีมด้วยเหตุผลเดียวกัน
    { name: 'Stats board', path: '/overlay-analytics', size: 'matches overlay size', perTournament: true }
    //
    // เคยมีอีกสองแถวตรงนี้: Most picked กับ Most banned ซึ่งเป็นหน้าเดียวกับ
    // กระดานสถิติ ต่างกันแค่ ?mode=pick / ?mode=ban ผู้ใช้ให้เอาออก
    //
    // โหมดพวกนั้นยังอยู่ครบที่ /overlay-analytics เหมือนเดิม ที่หายไปคือแถว
    // สำเร็จรูปในรายการนี้ ใครอยากได้ก็ต่อ ?mode=pick ท้าย URL ของ Stats board เอง
  ];

  function pathFor(source, options) {
    const params = [];
    if (source.sfx) params.push('sfx=1');
    if (source.perTournament && options.tournamentId) {
      params.push(`tournament=${encodeURIComponent(options.tournamentId)}`);
    }
    // พารามิเตอร์ประจำตัวของซอร์สนั้น เขียนไว้ในรายการ ไม่ใช่ให้คนไปเติมเอง
    // (เหตุผลเดียวกับ ?sfx=1 พารามิเตอร์ที่ต้องจำเอง คือพารามิเตอร์ที่ไม่มีใครใช้)
    //
    // ตอนนี้ยังไม่มีแถวไหนใช้ เก็บไว้เพราะการลบทิ้งแล้ววันหลังมีคนเติม query:
    // กลับเข้ามา จะได้ URL ที่ขาดพารามิเตอร์ไปเงียบๆ โดยไม่มีอะไรฟ้อง
    if (source.query) source.query.forEach((pair) => params.push(pair));
    return params.length ? `${source.path}?${params.join('&')}` : source.path;
  }

  // ทางสำรองแบบเก่า ใช้ได้แม้หน้าต่างไม่ได้ถูกโฟกัส
  function copyByTextField(url) {
    const input = document.createElement('input');
    input.value = url;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand('copy');
    input.remove();
    return ok;
  }

  // รอได้ไม่เกินเวลาที่กำหนด ไม่งั้นค้างตลอดกาล
  //
  // จำเป็นจริงๆ: บนเครื่องผู้ใช้จริง navigator.clipboard.writeText() คืน promise
  // ที่ไม่ resolve และไม่ reject เลย (ตระกูลเดียวกับ <audio> กับ AudioContext.resume()
  // ที่ค้างบนเครื่องเดียวกัน) ปุ่ม COPY URL จึงเงียบสนิท ไม่มีแม้แต่ข้อความบอกว่าพลาด
  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((resolve, reject) => setTimeout(() => reject(new Error('timeout')), ms))
    ]);
  }

  // ลอง clipboard API ก่อน ถ้าไม่ผ่านหรือค้าง ค่อยตกไปใช้ทางเก่า
  //
  // navigator.clipboard ปฏิเสธเมื่อหน้าต่างไม่ได้โฟกัส ซึ่งเกิดประจำเวลาคนคุมงาน
  // กดจากหน้าต่างที่ฝังอยู่ใน OBS ของเดิมยอมแพ้ตรงนั้นแล้วขึ้นว่า Copy failed
  // ทั้งที่ทางสำรองยังใช้ได้อยู่
  async function copyUrl(url) {
    if (navigator.clipboard?.writeText) {
      try {
        await withTimeout(navigator.clipboard.writeText(url), 600);
        showToast(t('URL copied'), 'green');
        return;
      } catch (error) {
        // ไม่ผ่านหรือค้าง ลองทางเก่าต่อ
      }
    }

    try {
      if (copyByTextField(url)) {
        showToast(t('URL copied'), 'green');
        return;
      }
    } catch (error) {
      // ตกไปที่ข้อความแจ้งเตือนข้างล่าง
    }

    showToast(t('Copy failed - select the URL and copy it by hand'), 'red');
  }

  function render(container, options = {}) {
    if (!container) return;
    container.textContent = '';

    SOURCES.forEach((source) => {
      const path = pathFor(source, options);
      const url = absoluteUrl(path);

      const row = document.createElement('div');
      row.className = 'src';

      const name = document.createElement('div');
      name.className = 'src-name';
      name.textContent = source.name;

      const urlEl = document.createElement('div');
      urlEl.className = 'src-url';
      urlEl.textContent = url;
      urlEl.title = tf('{url}  ({size})  - click to select, then Ctrl+C', { url, size: source.size });

      // คลิกที่ URL แล้วเลือกทั้งบรรทัดให้เลย
      //
      // ปุ่ม COPY URL พึ่ง clipboard ของเบราว์เซอร์ ซึ่งมีเครื่องที่มันไม่ทำงาน
      // (เจอมาแล้ว: writeText ค้างไม่ยอมจบ ส่วน execCommand คืน false ทั้งที่คลิกจริง)
      // ทางถอยจึงต้องไม่ใช่ให้ลากเมาส์คลุมเอาเองบน URL ยาวๆ ที่ถูกตัดปลายด้วย ...
      urlEl.addEventListener('click', () => {
        const selection = global.getSelection();
        if (!selection) return;
        const range = document.createRange();
        range.selectNodeContents(urlEl);
        selection.removeAllRanges();
        selection.addRange(range);
      });

      const actions = document.createElement('div');
      actions.className = 'src-actions';

      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'tlink';
      copy.textContent = t('COPY URL');
      copy.addEventListener('click', () => copyUrl(url));

      const open = document.createElement('a');
      open.className = 'tlink';
      open.href = withToken(path);
      open.target = '_blank';
      open.rel = 'noopener';
      open.textContent = t('OPEN');

      actions.append(copy, open);
      row.append(name, urlEl, actions);
      container.appendChild(row);
    });
  }

  global.RovObsSources = { SOURCES, render, copyUrl };
})(window);
