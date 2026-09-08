// เทสต์แบบแพ้สองครั้งคัดออก
//
// จุดที่พังง่ายที่สุดคือเส้นทางของผู้แพ้ ไม่ใช่ของผู้ชนะ
// สายที่ต่อผิดจะดูปกติดีตอนวาด แล้วไปโผล่กลางรายการแข่งว่ามีคนตกรอบไปแล้ว
// ยังอยู่ในสาย หรือคนที่แพ้ครั้งเดียวหายไปเฉยๆ
//
// จึงเทสต์ด้วยการ "เล่นจนจบ" จริงๆ แล้วตรวจว่าทุกคนแพ้ครบสองครั้งถึงตกรอบ

import test from 'node:test';
import assert from 'node:assert';
import { doubleElimination, generateMatches } from '../server/domain/bracket';
import type { PlannedMatch, Destination } from '../server/domain/bracket';

const teams = (n: number): string[] => Array.from({ length: n }, (_, i) => `t${i + 1}`);

// จำนวนทีมที่เอามาตรวจโครงสร้างทุกข้อ
//
// ต้องมีที่ไม่ใช่กำลังของสองด้วย ไม่ใช่แค่ 4/8/16/32
// จำนวนที่เป็นกำลังของสองพอดีไม่มีบายเลย ซึ่งเป็นเคสที่ง่ายที่สุดและไม่เคยพัง
// ส่วนจำนวนอื่นทำให้รอบแรกมีบาย = ไม่มีผู้แพ้ให้ส่งลงสายแพ้
// ตอนที่เทสต์ชุดนี้ตรวจแค่กำลังของสอง สาย 5 ทีมค้าง 8 คู่จาก 15 โดยไม่มีใครเห็น
const SIZES = [4, 5, 6, 7, 8, 9, 11, 12, 16, 21, 32];

const key = (bracket: string, round: number, slot: number) => `${bracket}#${round}#${slot}`;
const at = (list: PlannedMatch[], d: Destination) =>
  list.find((m) => m.bracket === d.bracket && m.round === d.round && m.slot === d.slot);

test('four teams produce a complete double elimination shape', () => {
  const list = doubleElimination(teams(4));
  const count = (b: string) => list.filter((m) => m.bracket === b).length;

  assert.strictEqual(count('main'), 3, 'two semis and a winners final');
  assert.strictEqual(count('losers'), 2, 'two losers rounds');
  assert.strictEqual(count('grand'), 2, 'grand final plus the reset');
});

test('eight teams produce the standard shape', () => {
  const list = doubleElimination(teams(8));
  assert.strictEqual(list.filter((m) => m.bracket === 'main').length, 7);
  // สายแพ้ของสาย 8 ทีม = 6 คู่ (2+2+1+1)
  assert.strictEqual(list.filter((m) => m.bracket === 'losers').length, 6);
  assert.strictEqual(list.filter((m) => m.bracket === 'grand').length, 2);

  const lbRounds = new Set(list.filter((m) => m.bracket === 'losers').map((m) => m.round));
  assert.deepStrictEqual([...lbRounds].sort((a, b) => a - b), [1, 2, 3, 4]);
});

test('fewer than four teams is not a double elimination bracket', () => {
  assert.deepStrictEqual(doubleElimination(teams(2)), []);
  assert.deepStrictEqual(doubleElimination(teams(3)), []);
});

test('every destination a match points at actually exists', () => {
  // ปลายทางที่ชี้ไปยังช่องที่ไม่มีอยู่จริง = ทีมหายไปเงียบๆ กลางทัวร์นาเมนต์
  SIZES.forEach((n) => {
    const list = doubleElimination(teams(n));
    list.forEach((m) => {
      if (m.winnerTo) {
        assert.ok(at(list, m.winnerTo), `n=${n} ${key(m.bracket, m.round, m.slot)} winner goes nowhere`);
      }
      if (m.loserTo) {
        assert.ok(at(list, m.loserTo), `n=${n} ${key(m.bracket, m.round, m.slot)} loser goes nowhere`);
      }
    });
  });
});

test('no two matches feed the same slot and side', () => {
  // ถ้าสองคู่ส่งคนไปช่องเดียวกัน คนหลังจะเขียนทับคนแรก แล้วทีมนั้นหายไป
  SIZES.forEach((n) => {
    const list = doubleElimination(teams(n));
    const taken = new Map<string, string>();

    list.forEach((m) => {
      [m.winnerTo, m.loserTo].forEach((dest) => {
        if (!dest) return;
        const slotKey = `${key(dest.bracket, dest.round, dest.slot)}:${dest.side}`;
        const owner = `${key(m.bracket, m.round, m.slot)}`;
        assert.ok(
          !taken.has(slotKey),
          `n=${n}: ${slotKey} filled by both ${taken.get(slotKey)} and ${owner}`
        );
        taken.set(slotKey, owner);
      });
    });
  });
});

test('every slot that needs filling has something feeding it', () => {
  SIZES.forEach((n) => {
    const list = doubleElimination(teams(n));
    const fed = new Set<string>();
    list.forEach((m) => {
      [m.winnerTo, m.loserTo].forEach((d) => {
        if (d) fed.add(`${key(d.bracket, d.round, d.slot)}:${d.side}`);
      });
    });

    list.forEach((m) => {
      // รอบแรกของสายชนะมีทีมอยู่แล้ว ไม่ต้องมีใครป้อน
      if (m.bracket === 'main' && m.round === 1) return;
      [0, 1].forEach((side) => {
        const slotKey = `${key(m.bracket, m.round, m.slot)}:${side}`;
        assert.ok(fed.has(slotKey), `n=${n}: nothing ever fills ${slotKey}`);
      });
    });
  });
});

// ---- เล่นจนจบ ----

// เล่นทั้งทัวร์นาเมนต์ โดยให้ทีมที่ id เล็กกว่าชนะเสมอ
// คืนจำนวนครั้งที่แต่ละทีมแพ้ และแชมป์
function playOut(list: PlannedMatch[]) {
  const board = list.map((m) => ({ ...m }));
  const losses = new Map<string, number>();
  const seat = new Map<string, string | null>();

  board.forEach((m) => {
    seat.set(`${key(m.bracket, m.round, m.slot)}:0`, m.teamAId);
    seat.set(`${key(m.bracket, m.round, m.slot)}:1`, m.teamBId);
  });

  const order = board.slice().sort((a, b) => {
    const rank = (m: typeof a) => (m.bracket === 'main' ? 0 : m.bracket === 'losers' ? 1 : 2);
    // เดินตามรอบ สายชนะก่อนสายแพ้ในรอบเดียวกัน
    return a.round - b.round || rank(a) - rank(b) || a.slot - b.slot;
  });

  let champion: string | null = null;

  // วนหลายรอบจนไม่มีอะไรเปลี่ยน เพราะบางคู่ต้องรอผลจากอีกสาย
  for (let pass = 0; pass < 12; pass += 1) {
    order.forEach((m) => {
      if (m.winnerId) return;
      const a = seat.get(`${key(m.bracket, m.round, m.slot)}:0`) ?? null;
      const b = seat.get(`${key(m.bracket, m.round, m.slot)}:1`) ?? null;

      // นัดตัดสินจะถูกเล่นก็ต่อเมื่อแชมป์สายแพ้ชนะนัดแรก
      if (m.bracket === 'grand' && m.round === 2 && (!a || !b)) return;
      if (!a && !b) return;
      if (!a || !b) {
        // บายรู้ผู้ชนะทันทีและต้องถูกดันเข้ารอบถัดไปด้วย ไม่ใช่แค่ติดธงว่าชนะ
        // ถ้าไม่ดันต่อ สายที่มีบาย (ทีมไม่ครบกำลังสอง) จะเดินต่อไม่ได้ในเทสต์
        // ทั้งที่ของจริงเดินได้ แล้วเทสต์จะมองไม่เห็นบั๊กในสายพวกนั้นเลย
        if (!m.isBye) return;
        m.teamAId = a;
        m.teamBId = b;
        m.winnerId = a ?? b;
        if (m.winnerTo && m.winnerId) {
          seat.set(`${key(m.winnerTo.bracket, m.winnerTo.round, m.winnerTo.slot)}:${m.winnerTo.side}`, m.winnerId);
        }
        return;
      }

      // เขียนทีมกลับลงกระดานด้วย ไม่ใช่เก็บไว้แต่ในตารางที่นั่ง
      // ไม่งั้นตรวจย้อนหลังทีหลังจะเห็นเป็นช่องว่างทั้งที่เล่นไปแล้ว
      m.teamAId = a;
      m.teamBId = b;

      const winner = Number(a.slice(1)) < Number(b.slice(1)) ? a : b;
      const loser = winner === a ? b : a;
      m.winnerId = winner;
      losses.set(loser, (losses.get(loser) || 0) + 1);

      if (m.winnerTo) seat.set(`${key(m.winnerTo.bracket, m.winnerTo.round, m.winnerTo.slot)}:${m.winnerTo.side}`, winner);
      if (m.loserTo) seat.set(`${key(m.loserTo.bracket, m.loserTo.round, m.loserTo.slot)}:${m.loserTo.side}`, loser);

      // แชมป์สายชนะชนะนัดแรกของรอบชิง = จบ ไม่ต้องเล่นนัดตัดสิน
      if (m.bracket === 'grand' && m.round === 1 && winner === a) {
        champion = winner;
        const reset = board.find((x) => x.bracket === 'grand' && x.round === 2);
        if (reset) reset.winnerId = 'skipped';
      }
      if (m.bracket === 'grand' && m.round === 2 && m.winnerId !== 'skipped') champion = winner;
    });
  }

  return { board, losses, champion };
}

test('playing a bracket out eliminates everyone on their second loss', () => {
  SIZES.forEach((n) => {
    const { losses, champion } = playOut(doubleElimination(teams(n)));

    assert.strictEqual(champion, 't1', `n=${n}: the strongest team should win`);

    // แชมป์ไม่แพ้เลยในกรณีนี้ ที่เหลือต้องแพ้ไม่เกินสองครั้ง
    teams(n).forEach((id) => {
      const lost = losses.get(id) || 0;
      assert.ok(lost <= 2, `n=${n}: ${id} lost ${lost} times, more than twice`);
      if (id !== 't1') {
        assert.ok(lost >= 1, `n=${n}: ${id} never lost yet did not win`);
      }
    });

    assert.strictEqual(losses.get('t1') || 0, 0, `n=${n}: the champion never lost`);
  });
});

test('a team knocked into the losers bracket can still reach the grand final', () => {
  // t2 แพ้ t1 ในสายชนะ แล้วต้องไต่สายแพ้กลับมาถึงรอบชิงได้
  const { board } = playOut(doubleElimination(teams(4)));
  const grand = board.find((m) => m.bracket === 'grand' && m.round === 1);
  assert.ok(grand, 'a grand final exists');
  assert.ok(grand?.teamAId && grand?.teamBId, 'both finalists are decided');
  assert.notStrictEqual(grand?.teamAId, grand?.teamBId, 'a team cannot play itself');
});

test('the grand final sends both teams to the reset match', () => {
  const list = doubleElimination(teams(8));
  const grand = list.find((m) => m.bracket === 'grand' && m.round === 1) as PlannedMatch;

  assert.deepStrictEqual(grand.winnerTo, { bracket: 'grand', round: 2, slot: 0, side: 0 });
  assert.deepStrictEqual(grand.loserTo, { bracket: 'grand', round: 2, slot: 0, side: 1 });

  const reset = list.find((m) => m.bracket === 'grand' && m.round === 2) as PlannedMatch;
  assert.strictEqual(reset.winnerTo, null, 'the reset decides the tournament');
  assert.strictEqual(reset.loserTo, null);
});

test('the winners final feeds the grand final, and its loser drops to the losers bracket', () => {
  const list = doubleElimination(teams(8));
  const wbFinal = list.find((m) => m.bracket === 'main' && m.round === 3) as PlannedMatch;

  assert.deepStrictEqual(wbFinal.winnerTo, { bracket: 'grand', round: 1, slot: 0, side: 0 });
  assert.strictEqual(wbFinal.loserTo?.bracket, 'losers');
  assert.strictEqual(wbFinal.loserTo?.round, 4, 'the last losers round');
});

test('losers bracket champion enters the grand final on the other side', () => {
  const list = doubleElimination(teams(8));
  const lbFinal = list.find((m) => m.bracket === 'losers' && m.round === 4) as PlannedMatch;
  assert.deepStrictEqual(lbFinal.winnerTo, { bracket: 'grand', round: 1, slot: 0, side: 1 });
  assert.strictEqual(lbFinal.loserTo, null, 'losing in the losers bracket is elimination');
});

test('nobody appears twice in the same round of either bracket', () => {
  SIZES.forEach((n) => {
    const { board } = playOut(doubleElimination(teams(n)));
    const seen = new Map<string, Set<string>>();
    board.forEach((m) => {
      const k = `${m.bracket}#${m.round}`;
      if (!seen.has(k)) seen.set(k, new Set());
      const round = seen.get(k) as Set<string>;
      [m.teamAId, m.teamBId].forEach((id) => {
        if (!id) return;
        assert.ok(!round.has(id), `n=${n}: ${id} twice in ${k}`);
        round.add(id);
      });
    });
  });
});

test('the format is reachable through the normal entry point', () => {
  const result = generateMatches({ format: 'double_elim', teamIds: teams(8) });
  assert.ok(result.matches, result.error ?? 'double elim should generate');
  assert.ok((result.matches as PlannedMatch[]).some((m) => m.bracket === 'losers'));
});
