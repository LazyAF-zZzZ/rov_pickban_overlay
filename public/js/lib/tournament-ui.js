// ชิ้นส่วนหน้าจอที่เกี่ยวกับ "ทัวร์นาเมนต์" ซึ่งมีมากกว่าหนึ่งหน้าใช้
//
// ตอนนี้มีอย่างเดียวคือการลบทัวร์นาเมนต์ ซึ่งใช้ทั้งที่หน้าแรก (ปุ่มบนการ์ดในรายการ)
// และหน้ารายละเอียด การลบนี้ย้อนไม่ได้ ข้อความยืนยันจึงต้องบอกให้ครบว่าอะไรหายบ้าง
// ถ้าปล่อยให้สองหน้าเขียนคำเตือนกันเอง มันจะค่อยๆ เพี้ยนออกจากกัน
// แปลว่าคนกดลบได้คำเตือนไม่เท่ากันขึ้นอยู่กับว่ากดมาจากหน้าไหน ซึ่งไม่ควรเกิด
//
// วิธีใช้:
//   <script src="/socket.io/socket.io.js"></script>
//   <script src="/js/lib/app-client.js"></script>
//   <script src="/js/lib/tournament-ui.js"></script>
//   <script src="/js/หน้าใหม่.js"></script>
// แล้วในไฟล์ js ขึ้นต้นด้วย
//   const { confirmAndDelete } = window.RovTournamentUI;
//
// ต้องโหลดหลัง app-client.js เสมอ เพราะอ่าน fetchJson / confirmBox จาก window.RovClient

(function (global) {
  const { fetchJson, confirmBox, showToast } = global.RovClient;

  // สรุปของที่เพิ่งหายไป เอาไว้ต่อท้าย toast ให้เห็นว่าการลบกินอะไรไปจริงบ้าง
  //
  // ไม่แจกแจงเป็นรายการต่อกันด้วย "and" เพราะการต่อคำเองแปลไม่ได้
  // ภาษาอื่นเรียงลำดับคำไม่เหมือนกัน กรอบเดียวที่มีทั้งสองตัวเลขจึงแปลได้จริง
  function removedSummary(removed) {
    if (!removed) return '';
    if (!removed.matches && !removed.games) return '';
    return tf(' ({matches} matches and {games} drafts gone)', {
      matches: removed.matches || 0,
      games: removed.games || 0
    });
  }

  // ถามให้แน่ใจก่อน แล้วค่อยลบถาวร คืน true เมื่อลบไปแล้วจริงเท่านั้น
  //
  // เช็คก่อนว่าอันนี้กำลังออกอากาศอยู่หรือเปล่า เพราะนั่นคือเหตุผลเดียวที่คนตั้งใจลบ
  // ควรเปลี่ยนใจกลางคัน ถ้าถามเซิร์ฟเวอร์ไม่ได้ก็ข้ามไป
  // คำถามเสริมต้องไม่ทำให้การลบทำไม่ได้
  async function confirmAndDelete(tournament) {
    let onAir = false;
    try {
      const { live } = await fetchJson('/api/live-match');
      onAir = live?.tournamentId === tournament.id;
    } catch (error) {
      onAir = false;
    }

    const body = [
      tf('Delete "{name}" permanently?', { name: tournament.name }),
      t('Its team list, every match in the bracket and every draft recorded under it are erased. '
        + 'There is no undo and nothing left behind to restore from.'),
      t('The teams themselves stay in the registry, along with their history in other tournaments.')
    ];
    if (onAir) {
      body.splice(1, 0, t('It is on air right now. Deleting it takes the match off the broadcast.'));
    }

    const sure = await confirmBox({
      title: t('Delete tournament'),
      body,
      confirmLabel: t('DELETE FOREVER'),
      danger: true
    });
    if (!sure) return false;

    try {
      const result = await fetchJson(
        `/api/tournaments/${encodeURIComponent(tournament.id)}`,
        { method: 'DELETE' }
      );
      showToast(tf('Deleted {name}', { name: tournament.name }) + removedSummary(result.removed), 'red');
      return true;
    } catch (error) {
      showToast(error.message || t('Could not delete the tournament'), 'red');
      return false;
    }
  }

  global.RovTournamentUI = { confirmAndDelete };
})(window);
