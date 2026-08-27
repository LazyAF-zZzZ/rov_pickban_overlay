// ผลของซีรีส์ และการเดาว่าใครชนะ "เกมไหน" จากคะแนนที่กรอก
//
// เดิมผู้ชนะรายเกมต้องกดเองที่แถบ ON AIR ของหน้า control
// ซึ่งแปลว่าข้อเท็จจริงเดียวกันต้องบันทึกสองที่: คะแนนซีรีส์ที่หน้าจัดการแข่ง
// กับปุ่มผู้ชนะที่หน้า control ลืมที่ใดที่หนึ่งแล้วอัตราชนะรายฮีโร่ก็หายไปเงียบๆ
//
// ตอนนี้คะแนนซีรีส์เป็นแหล่งความจริง: กรอก 1-0 แปลว่าเกมที่ 1 ฝั่งน้ำเงินชนะ
//
// กติกาที่ยอมเดา: มีฝั่งเดียวที่แต้มเพิ่ม
//   1-1 -> 2-1  แต้มน้ำเงิน +1  = เกมที่ 3 น้ำเงินชนะ
//   0-0 -> 2-0  แต้มน้ำเงิน +2  = เกมที่ 1 และ 2 น้ำเงินชนะทั้งคู่ (ไม่กำกวม)
//
// กติกาที่ไม่เดา: สองฝั่งแต้มเพิ่มพร้อมกัน (เช่น 0-0 -> 2-1)
// รู้ว่าเล่นไปสามเกม แต่ไม่รู้ว่าเกมไหนใครชนะ การเดาตรงนี้คือการแต่งข้อมูล
// ปล่อยว่างไว้แล้วให้คนกดเลือกเองดีกว่าใส่ค่าที่อาจผิด
//
// คะแนนลดลง = ถอยผลกลับ เกมที่เกินคะแนนใหม่ถือว่ายังไม่ได้เล่น
// ต้องล้างผู้ชนะทิ้ง ไม่งั้นพอเปิดเกมนั้นใหม่ ดราฟต์จะถูกเขียนทับ
// แต่ผู้ชนะยังเป็นของเก่าค้างอยู่ กลายเป็นดราฟต์ชุดใหม่ผูกกับผลของชุดเดิม

import { getStores } from '../store/index';
import type { Match, MatchResult } from '../store/matches';
import { getState, emitState } from '../store/live-state';
import { notifyData } from './sync';

// ฝั่ง A ของแมตช์ขึ้นจอเป็นสีน้ำเงินเสมอ (ดู goLive) คะแนน A จึงคู่กับ blue
function sideForScore(gainedA: number): 'blue' | 'red' {
  return gainedA > 0 ? 'blue' : 'red';
}

function syncGameWinners(before: Match, after: Match): boolean {
  const { games } = getStores();
  const playedBefore = before.scoreA + before.scoreB;
  const playedNow = after.scoreA + after.scoreB;

  if (playedNow < playedBefore) {
    const undone = games.forMatch(after.id).filter((g) => g.gameNo > playedNow && g.winner);
    undone.forEach((g) => games.setWinner(g.id, null));
    return undone.length > 0;
  }

  if (playedNow === playedBefore) return false;

  const gainedA = after.scoreA - before.scoreA;
  const gainedB = after.scoreB - before.scoreB;
  if (gainedA > 0 && gainedB > 0) return false;   // กำกวม ไม่เดา

  const winner = sideForScore(gainedA);
  const byNumber = new Map(games.forMatch(after.id).map((g) => [g.gameNo, g]));

  let touched = false;
  for (let gameNo = playedBefore + 1; gameNo <= playedNow; gameNo += 1) {
    const game = byNumber.get(gameNo);
    // ไม่มีเกมนี้ = แมตช์นี้ไม่เคยถูกเอาขึ้นจอ จึงไม่มีดราฟต์ให้ผูกผลด้วย
    // ไม่สร้างแถวเปล่าขึ้นมา เพราะเกมที่ไม่มีดราฟต์ไม่มีผลต่อสถิติอยู่แล้ว
    if (!game) continue;
    games.setWinner(game.id, winner);
    touched = true;
  }
  return touched;
}

// บันทึกคะแนนซีรีส์ แล้วเติมผู้ชนะรายเกมให้เท่าที่บอกได้แน่นอน
export function recordSeriesResult(
  matchId: string,
  scoreA: unknown,
  scoreB: unknown
): MatchResult {
  const { matches } = getStores();

  // ต้องอ่านคะแนนเดิมก่อน setResult ไม่งั้นเทียบไม่ได้ว่าฝั่งไหนเพิ่งได้แต้ม
  const before = matches.get(matchId);
  if (!before) return { error: 'Match not found' };

  const result = matches.setResult(matchId, scoreA, scoreB);
  if (result.error !== undefined) return result;

  if (syncGameWinners(before, result.match)) {
    notifyData({ topic: 'games', tournamentId: result.match.tournamentId });
  }
  // กรอกคะแนนจากในสาย ก็ต้องเห็นบนจอทันทีเหมือนกัน
  pushMatchScoreToOverlay(result.match);
  return result;
}

// คะแนนมีสองที่ที่กรอกได้: ช่องบนหน้า control และกล่องคะแนนในสาย
//
// ทั้งสองที่เขียนลงที่เดียวกันคือ matches.score_a/score_b แล้วสะท้อนกลับหากัน
// เดิมช่องบนหน้า control เขียนลง state ของ overlay อย่างเดียว ไม่แตะตารางแข่งเลย
// ผลคือกรอกที่หน้า control แล้วสายยังเป็นคะแนนเก่า ไม่มีการบันทึกผู้ชนะรายเกม
// และที่แย่กว่านั้นคือ nextGameNo อ่านจากตารางแข่ง เกมถัดไปจึงได้เลขเดิม
// แล้วดราฟต์เกมใหม่จะไปเขียนทับดราฟต์ของเกมก่อนหน้า

// ฝั่งน้ำเงินบนจอ คือทีมไหนของแมตช์
//
// ปกติ goLive วางฝั่ง A เป็นน้ำเงินเสมอ แต่ switchTeams สลับทั้งสองฝั่งบนจอได้
// จึงเทียบกับสำเนาแช่แข็งของเกมแทนที่จะเชื่อว่าน้ำเงินคือ A ตลอด
// เทียบด้วยชื่อ เพราะ state ของ overlay ไม่ได้เก็บ id ของทีมไว้
function bluePlaysSideB(gameBlueName: string, gameRedName: string): boolean {
  const state = getState();
  return state.teamBlue.name === gameRedName && state.teamRed.name === gameBlueName;
}

function sidesOf(matchId: string): { swapped: boolean } {
  const { liveMatch, games } = getStores();
  const pointer = liveMatch.get();
  if (pointer.matchId !== matchId || !pointer.gameId) return { swapped: false };
  const game = games.get(pointer.gameId);
  if (!game) return { swapped: false };
  return { swapped: bluePlaysSideB(game.blueName, game.redName) };
}

// คะแนนของแมตช์เปลี่ยน ถ้าแมตช์นั้นกำลังออกอากาศ ให้ overlay ตามทันที
// ไม่ต้องรอเอาแมตช์ขึ้นจอใหม่ ซึ่งเป็นทางเดียวที่เคยทำให้ตัวเลขตรงกัน
function pushMatchScoreToOverlay(match: Match): void {
  const { liveMatch } = getStores();
  if (liveMatch.get().matchId !== match.id) return;

  const { swapped } = sidesOf(match.id);
  const blue = swapped ? match.scoreB : match.scoreA;
  const red = swapped ? match.scoreA : match.scoreB;

  const state = getState();
  if (state.teamBlue.score === blue && state.teamRed.score === red) return;
  state.teamBlue.score = blue;
  state.teamRed.score = red;
  emitState();
}

// เรียกหลังช่องคะแนนบนหน้า control ถูกแก้
//
// หน้า control เป็นตัวตั้ง: ค่าที่พิมพ์ตรงนั้นถูกเขียนลงตารางแข่ง
// แล้วผู้ชนะรายเกมก็ถูกเดาจากค่านั้นด้วยกติกาเดียวกับการกรอกในสาย
export function pushOverlayScoreToMatch(): void {
  const { liveMatch, matches } = getStores();
  const pointer = liveMatch.get();
  if (!pointer.matchId) return;   // แมตช์เดี่ยว ไม่ได้ผูกกับทัวร์นาเมนต์ อย่าไปแตะอะไร

  const match = matches.get(pointer.matchId);
  if (!match) return;

  const state = getState();
  const { swapped } = sidesOf(match.id);
  const scoreA = swapped ? state.teamRed.score : state.teamBlue.score;
  const scoreB = swapped ? state.teamBlue.score : state.teamRed.score;
  if (scoreA === match.scoreA && scoreB === match.scoreB) return;

  const result = recordSeriesResult(pointer.matchId, scoreA, scoreB);
  if (result.error !== undefined) return;

  // ตารางแข่งตัดคะแนนตามจำนวนเกมที่ชนะได้จริงของ BoN
  // พิมพ์ 5 ใน Bo3 จะเหลือ 2 ถ้าไม่สะท้อนกลับ จอจะโชว์ 5 ส่วนสายโชว์ 2
  pushMatchScoreToOverlay(result.match);
  notifyData({ topic: 'matches', tournamentId: result.match.tournamentId });
}
