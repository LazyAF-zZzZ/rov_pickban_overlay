// การเดินรอบ และการประกอบ "ดราฟต์ของรอบก่อนหน้า" ให้กราฟิกออกอากาศ
//
// รอบ = เกมที่เท่าไหร่ของซีรีส์ที่กำลังคุมอยู่
//
// มีสองโลกที่ต้องรองรับ และตรงนี้คือที่ที่มันมาบรรจบกัน
//
//   แมตช์ของทัวร์นาเมนต์  รอบผูกกับ games.game_no ของแมตช์นั้น เดินรอบ = ย้ายตัวชี้
//                        ไปเกมถัดไป ดราฟต์เก่าอ่านกลับจากฐาน ตัวเลขจึงไม่มีทาง
//                        หลุดจากคะแนนซีรีส์ เพราะมันเป็นค่าเดียวกันตัวเดียว
//
//   แมตช์เดี่ยว           ไม่มีแถวในฐานให้ผูก รอบเป็นตัวนับใน state ล้วนๆ
//                        เดินรอบ = เก็บกระดานปัจจุบันใส่ state.rounds แล้วล้างกระดาน
//
// ทั้งสองทางจบลงที่ state.round กับ state.rounds เหมือนกัน กราฟิกจึงมีทางอ่านทางเดียว
// และไม่ต้องรู้เลยว่าที่ออกอากาศอยู่เป็นทัวร์นาเมนต์หรือไม่

import type { GameState } from '../domain/match';
import { orientationOf } from '../domain/match';
import type { RoundRecord, RoundSide } from '../domain/rounds';
import { MAX_ROUNDS, hasAnything } from '../domain/rounds';
import { PICK_COUNT, BAN_COUNT } from '../domain/draft';
import type { Game } from '../store/games';
import { getStores } from '../store/index';

// กระดานที่อยู่บนจอตอนนี้ ในรูปของรอบที่เก็บไว้
export function boardToRound(state: GameState, round: number): RoundRecord {
  return {
    round,
    blue: {
      name: state.teamBlue.name,
      picks: [...state.teamBlue.picks],
      bans: [...state.teamBlue.bans]
    },
    red: {
      name: state.teamRed.name,
      picks: [...state.teamRed.picks],
      bans: [...state.teamRed.bans]
    }
  };
}

// ล้างเฉพาะ pick/ban ไม่แตะชื่อทีม คะแนน โลโก้ หรือผู้เล่น
// เกมถัดไปคือทีมคู่เดิม เปลี่ยนแค่ดราฟต์
export function clearBoard(state: GameState): void {
  state.teamBlue.picks = Array.from({ length: PICK_COUNT }, () => null);
  state.teamBlue.bans = Array.from({ length: BAN_COUNT }, () => null);
  state.teamRed.picks = Array.from({ length: PICK_COUNT }, () => null);
  state.teamRed.bans = Array.from({ length: BAN_COUNT }, () => null);
}

function emptySide(name: string): RoundSide {
  return {
    name,
    picks: Array.from({ length: PICK_COUNT }, () => null),
    bans: Array.from({ length: BAN_COUNT }, () => null)
  };
}

// เกมหนึ่งแถวในฐาน -> รอบหนึ่งรอบสำหรับกราฟิก
//
// วางคอลัมน์ให้ตรงกับจอที่ออกอากาศอยู่ ไม่ใช่ตรงกับที่บันทึกไว้ในฐาน
// กดสลับฝั่งกลางซีรีส์แล้วรอบเก่าจะยังอยู่ฝั่งเดิมของมัน ซึ่งอ่านแล้วสับสน
// เพราะคนดูเห็นทีมสองทีมสลับที่กันระหว่างแถบหลักกับกระดานย้อนหลัง
// ชื่อทีมติดไปกับรอบด้วยอยู่แล้ว ต่อให้จับคู่ผิดก็ยังอ่านออกว่าใครเป็นใคร
//
// orientationOf ตอบ 'different' เมื่อบนจอไม่ใช่คู่นี้เลย กรณีนั้นไม่มีอะไรให้เทียบ
// เก็บไว้ตามที่บันทึกไว้ดีกว่าเดา
function gameToRound(game: Game, state: GameState): RoundRecord {
  const swapped = orientationOf(state, game) === 'swapped';

  const blue = emptySide(swapped ? game.redName : game.blueName);
  const red = emptySide(swapped ? game.blueName : game.redName);

  game.slots.forEach((slot) => {
    const recordedBlue = slot.side === 'blue';
    const side = (recordedBlue !== swapped) ? blue : red;
    const list = slot.kind === 'pick' ? side.picks : side.bans;
    if (slot.idx >= 0 && slot.idx < list.length) list[slot.idx] = slot.hero;
  });

  return { round: game.gameNo, blue, red };
}

// รอบก่อนหน้าทั้งหมดของแมตช์นี้ อ่านจากฐาน
//
// เกมที่ยังไม่มีดราฟต์อะไรเลยถูกข้าม games.freeze() จองแถวเกมที่ 1 ไว้ตั้งแต่ตอน
// จับคู่ ก่อนที่จะมีใครเล่น แถวเปล่าพวกนั้นไม่ควรกลายเป็นแถบว่างบนอากาศ
export function roundsBefore(matchId: string, gameNo: number, state: GameState): RoundRecord[] {
  return getStores().games
    .forMatch(matchId)
    .filter((game) => game.gameNo < gameNo)
    .sort((a, b) => a.gameNo - b.gameNo)
    .map((game) => gameToRound(game, state))
    // ทิ้งแถวเปล่าก่อนค่อยตัดตามเพดาน ไม่ใช่ตัดก่อนแล้วค่อยทิ้ง
    // ตัดก่อนแปลว่าแถวเปล่าท้ายๆ กินโควตาของรอบที่มีข้อมูลจริงไปฟรีๆ
    .filter(hasAnything)
    .slice(-MAX_ROUNDS);
}

// เก็บกระดานปัจจุบันเข้ากอง แล้วคืนกองใหม่ (ใช้กับแมตช์เดี่ยว)
//
// รอบเดิมที่เลขซ้ำกันถูกแทนที่ ไม่ใช่ต่อท้าย เดินหน้าถอยหลังไปมาที่รอบเดิม
// ไม่ควรได้ ROUND 2 สองแถวบนจอ
export function fileRound(rounds: RoundRecord[], record: RoundRecord): RoundRecord[] {
  if (!hasAnything(record)) return rounds;
  const kept = rounds.filter((r) => r.round !== record.round);
  kept.push(record);
  kept.sort((a, b) => a.round - b.round);
  return kept.slice(-MAX_ROUNDS);
}

// รอบที่เก็บไว้ตัวหนึ่ง กลับขึ้นกระดาน
export function restoreRound(state: GameState, record: RoundRecord): void {
  state.teamBlue.picks = [...record.blue.picks];
  state.teamBlue.bans = [...record.blue.bans];
  state.teamRed.picks = [...record.red.picks];
  state.teamRed.bans = [...record.red.bans];
}

export function takeRound(rounds: RoundRecord[], round: number): RoundRecord | null {
  return rounds.find((r) => r.round === round) || null;
}
