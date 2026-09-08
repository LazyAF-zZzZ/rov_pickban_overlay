// เชื่อมแมตช์ในตารางแข่งเข้ากับ overlay ที่กำลังออกอากาศ
//
// "เปิดแมตช์" = เอาทีมของแมตช์นั้นขึ้น overlay + จำว่ากำลังออกอากาศคู่ไหน
// ผ่าน carryOverSettings ตั้งใจ:
// ธีม คีย์ลัด ภาพพื้นหลัง และขนาดจอ ต้องไม่เปลี่ยนตอนสลับแมตช์กลางงาน
//
// ตัวบันทึกดราฟต์เกาะอยู่กับ subscribe() ของ live-state
// ทุกครั้งที่ pick/ban เปลี่ยน ดราฟต์จะถูกมิเรอร์ลงเกมที่ผูกไว้ทันที
// ไม่ต้องรอให้ใครกดเซฟ และไม่มีขั้นตอน "ปิดงาน" ให้ลืม

import { deepClone } from '../lib/json';
import { defaultState, sanitizeState, sanitizeTeam, isTeamKey, TEAM_KEYS } from '../domain/match';
import type { GameState } from '../domain/match';
import { carryOverSettings } from '../domain/settings';
import { getState, setState, emitState, subscribe, clearUndo } from '../store/live-state';
import { notifyData } from './sync';
import { stopDraftTimer, syncSecondsFromState, resetDraft } from './draft-engine';
import { getStores } from '../store/index';
import { isDatabaseOpen } from '../store/db';
import type { GameSlot } from '../store/games';
import type { Match } from '../store/matches';
import { seriesWinner, PLAYOFF_BRACKET } from '../domain/bracket';
import { FIRST_ROUND, MAX_ROUND_NUMBER } from '../domain/rounds';
import { boardToRound, clearBoard, fileRound, restoreRound, roundsBefore, takeRound } from './rounds';

export interface LiveInfo {
  matchId: string | null;
  gameId: string | null;
  gameNo: number | null;
  tournamentId: string | null;
  tournamentName: string | null;
  matchLabel: string | null;
  // ผู้ชนะของเกมที่กำลังออกอากาศ null = ยังไม่ได้บันทึก
  // หน้า control ใช้บอกว่ากดไปแล้วหรือยัง ผู้ชนะต่อเกมไม่มีทางเดาย้อนหลังได้
  winner: 'blue' | 'red' | null;
  draftLocked: boolean;
}

export type GoLiveResult = { live: LiveInfo; error?: undefined } | { error: string; live?: undefined };

export type LoadTeamResult =
  | { state: GameState; error?: undefined }
  | { error: string; state?: undefined };

// เขียนช่องที่บันทึกไว้กลับลง state
//
// ใส่ชื่อฮีโร่ดิบๆ ไม่ผ่าน sanitizeHero ตั้งใจ
// ถ้าวันหลังมีการเปลี่ยนชื่อไฟล์ภาพฮีโร่ การกรองซ้ำจะทำให้ pick เก่ากลายเป็นว่าง
// ปล่อยชื่อเดิมไว้แล้วภาพหาย ยังดีกว่าดราฟต์ที่เคยมีอยู่หายไปเงียบๆ
function restoreDraft(state: GameState, slots: readonly GameSlot[]): void {
  slots.forEach((slot) => {
    const team = slot.side === 'blue' ? state.teamBlue : state.teamRed;
    const list = slot.kind === 'pick' ? team.picks : team.bans;
    if (slot.idx >= 0 && slot.idx < list.length) list[slot.idx] = slot.hero;
  });
}

// ชื่อคู่ที่คนอ่านรู้เรื่อง ต้องรู้จักสายแพ้กับรอบชิงด้วย
//
// เดิมเหมาว่าอะไรที่ไม่ใช่ 'main' คือชื่อกลุ่ม แบบแพ้สองครั้งคัดออกจึงออกมาเป็น
// "Group losers - round 1" กับ "Group grand - round 1" ซึ่งไม่มีกลุ่มไหนชื่อนั้น
// ตรงกับชื่อที่หน้าโปรไฟล์ทีมใช้อยู่แล้ว (roundLabel ใน public/js/team.js)
function label(bracket: string, round: number): string {
  if (bracket === 'main') return `Round ${round}`;
  if (bracket === 'losers') return `Losers round ${round}`;
  if (bracket === 'grand') return round === 2 ? 'Grand final (reset)' : 'Grand final';
  // สายน็อกเอาต์ที่ต่อจากรอบแบ่งกลุ่ม ไม่ใช่ชื่อกลุ่ม
  //
  // นี่คือความผิดพลาดแบบเดียวกับที่คอมเมนต์ข้างล่างเตือนไว้ และมันเกิดขึ้นอีกจริงๆ
  // ทันทีที่มีชื่อสายใหม่: แถบ ON AIR ขึ้นว่า "Group playoff - round 1"
  // ซึ่งไม่มีกลุ่มไหนชื่อนั้น
  if (bracket === PLAYOFF_BRACKET) return `Playoff round ${round}`;
  return `Group ${bracket} - round ${round}`;
}

// เกมที่ควรขึ้นจอเมื่อกด "ออกอากาศ" โดยไม่ได้ระบุเลขมา
//
// ปกติคือเกมถัดไปที่ยังไม่ได้เล่น = คะแนนรวม + 1
//
// แต่ถ้าซีรีส์จบไปแล้ว เกมถัดไปไม่มีอยู่จริง ให้เปิดเกมสุดท้ายที่เล่นไปแทน
// ซึ่งเป็นสิ่งที่คนกดต้องการอยู่แล้วเวลาย้อนดูคู่ที่จบไปแล้ว (เรื่องปกติมาก)
//
// ของเดิมบวกหนึ่งเสมอ ผลคือทุกครั้งที่เปิดดูคู่ที่จบแล้ว จะมีแถวเกมเปล่างอกในฐาน
// และแบนเนอร์ขึ้น GAME ที่ไม่มีวันถูกเล่น วัดจริงกับ Bo5 ที่จบ 3-0:
// ขึ้นจอเป็น GAME 4 และในฐานเหลือแถวเกมเลข 1 กับ 4 โดยไม่มี 2 กับ 3
//
// การตัดที่ bestOf อย่างเดียวไม่พอ เพราะ 3-0 ใน Bo5 ได้เลข 4 ซึ่งยังไม่เกิน 5
// ต้องถามว่า "ซีรีส์จบหรือยัง" ไม่ใช่แค่ "เลขเกินกติกาไหม"
function airingGameNo(match: Match): number {
  const played = match.scoreA + match.scoreB;
  const decided = seriesWinner(match.bestOf, match.scoreA, match.scoreB) !== null;
  return decided ? Math.max(played, FIRST_ROUND) : played + 1;
}

export function describeLive(): LiveInfo {
  const { liveMatch, matches, games, tournaments } = getStores();
  const pointer = liveMatch.get();
  if (!pointer.matchId) {
    return {
      matchId: null, gameId: null, gameNo: null, tournamentId: null,
      tournamentName: null, matchLabel: null, winner: null, draftLocked: false
    };
  }

  const match = matches.get(pointer.matchId);
  const game = pointer.gameId ? games.get(pointer.gameId) : null;
  const tournament = match ? tournaments.get(match.tournamentId) : null;

  return {
    matchId: pointer.matchId,
    gameId: pointer.gameId,
    gameNo: game?.gameNo ?? null,
    tournamentId: match?.tournamentId ?? null,
    tournamentName: tournament?.name ?? null,
    matchLabel: match ? label(match.bracket, match.round) : null,
    winner: game?.winner ?? null,
    draftLocked: game?.draftLocked === true
  };
}

// เอาแมตช์ขึ้นจอ
//
// wantedGameNo มีไว้ให้ปุ่มเดินรอบเท่านั้น ไม่ส่งมา = เกมถัดไปตามคะแนนซีรีส์
// ซึ่งเป็นสิ่งที่การกด "ออกอากาศ" จากในสายควรได้เสมอ
export function goLive(matchId: string, wantedGameNo?: number): GoLiveResult {
  const { matches, teams, games, liveMatch, tournaments } = getStores();

  const match = matches.get(matchId);
  if (!match) return { error: 'Match not found' };
  if (match.isBye) return { error: 'A bye is not played, so it cannot go on air' };
  if (!match.teamAId || !match.teamBId) {
    return { error: 'Both teams must be decided before this match can go on air' };
  }

  const tournament = tournaments.get(match.tournamentId);
  const blue = teams.get(match.teamAId);
  const red = teams.get(match.teamBId);
  if (!blue || !red) return { error: 'One of the teams is no longer in the registry' };

  // เลขเกมต้องอยู่ในกติกาของซีรีส์เสมอ ไม่ว่ามาจากทางไหน
  //
  // ตัดที่ bestOf ด้วย ไม่ใช่แค่กันค่าที่อ่านไม่ออก: nextGameNo คือคะแนนรวม + 1
  // ซีรีส์ Bo3 ที่จบไปแล้วด้วย 2-1 จึงได้เลข 4 ซึ่งเป็นเกมที่ไม่มีวันมีอยู่จริง
  // เอาแมตช์ที่เล่นจบแล้วขึ้นจอดูอีกรอบ (ซึ่งเป็นเรื่องปกติ) จะสร้างแถวเกมเปล่า
  // ทิ้งไว้ในฐานทุกครั้ง แทนที่จะเปิดเกมสุดท้ายที่มีดราฟต์อยู่จริงให้ดู
  const requested = wantedGameNo === undefined
    ? airingGameNo(match)
    : Math.trunc(Number(wantedGameNo));
  const highestGame = Math.min(Math.max(match.bestOf, FIRST_ROUND), MAX_ROUND_NUMBER);
  const gameNo = Number.isFinite(requested)
    ? Math.min(Math.max(requested, FIRST_ROUND), highestGame)
    : FIRST_ROUND;

  // สำเนาถูกจองไว้ตั้งแต่ตอนจับคู่แล้ว ตรงนี้แค่ปัดชื่อให้เป็นปัจจุบัน
  // เผื่อทีมถูกเปลี่ยนชื่อหลังจับคู่แต่ก่อนได้ลงเล่น
  // freeze() ไม่แตะเกมที่มีดราฟต์หรือมีผู้ชนะแล้ว ของที่เล่นไปจริงจึงไม่ถูกเขียนทับ
  games.freeze(matchId, match.teamAId, match.teamBId);

  // สำเนาแช่แข็ง เก็บชื่อ ณ ตอนนี้ ไม่ใช่แค่ id
  const game = games.ensure(matchId, gameNo, {
    blueTeamId: blue.id,
    redTeamId: red.id,
    blueName: blue.name,
    redName: red.name
  });

  // เปลี่ยนแมตช์ = เปลี่ยนข้อมูลแมตช์ ไม่ใช่ล้างการตั้งค่าเครื่องมือ
  stopDraftTimer();
  const previous = getState();
  const next = sanitizeState({
    ...deepClone(defaultState),
    teamBlue: {
      ...deepClone(defaultState.teamBlue),
      name: blue.name,
      // โลโก้ของทีมในทะเบียนอยู่ไฟล์ <teamId>.<ext> ไม่ใช่ blue-team.<ext>
      // ต้องบอก src ไปด้วย ไม่งั้น overlay จะไปเปิดไฟล์ของช่องน้ำเงินที่ค้างอยู่
      // ซึ่งเป็นภาพของทีมอื่นที่เคยอัปโหลดไว้ ไม่ใช่ของทีมที่กำลังแข่ง
      logo: { ...blue.logo, src: blue.id },
      players: blue.players.map((p, i) => p.name || `Player ${i + 1}`),
      positions: blue.players.map((p) => p.position)
    },
    teamRed: {
      ...deepClone(defaultState.teamRed),
      name: red.name,
      logo: { ...red.logo, src: red.id },
      players: red.players.map((p, i) => p.name || `Player ${i + 1}`),
      positions: red.players.map((p) => p.position)
    },
    // คะแนนซีรีส์ ไม่ใช่คะแนนในเกม overlay จะได้โชว์สถานะซีรีส์ถูก
    matchInfo: {
      title: `${blue.name} VS ${red.name} : GAME ${gameNo} [BO${match.bestOf}]`,
      tournament: tournament?.name || ''
    },
    // รอบของแมตช์ในทัวร์นาเมนต์ไม่ใช่ตัวนับอิสระ มันคือเลขเกมของซีรีส์ตัวเดียวกัน
    // ที่คะแนนใช้อยู่ ใช้ค่าเดียวกันไปเลยจึงไม่มีทางหลุดจากกันได้
    round: gameNo
  });
  next.teamBlue.score = match.scoreA;
  next.teamRed.score = match.scoreB;

  // ดราฟต์ของรอบก่อนหน้าอ่านจากฐาน ไม่ใช่จาก state ก้อนเดิม
  //
  // จำเป็น เพราะ goLive สร้าง state ใหม่ทั้งก้อนจากค่าเริ่มต้น ของที่เคยกองไว้ใน
  // state.rounds หายไปพร้อมกันเสมอ อ่านจากฐานยังได้เปรียบอีกอย่าง: เปิดเครื่อง
  // ขึ้นมาใหม่แล้วเอาเกมที่ 3 ขึ้นจอ รอบที่ 1 กับ 2 ก็ยังอยู่ครบ
  next.rounds = roundsBefore(matchId, gameNo, next);

  // เอาดราฟต์ที่เคยบันทึกไว้ของเกมนี้กลับขึ้นจอ
  //
  // ห้ามข้ามขั้นตอนนี้เด็ดขาด: ตัวบันทึกเกาะอยู่กับ emitState
  // ถ้าเปิดแมตช์เดิมแล้วขึ้นจอเป็นดราฟต์ว่าง emit ครั้งถัดไปจะเขียนความว่าง
  // ทับดราฟต์ที่เก็บไว้ทันที = เปิดดูเฉยๆ แล้วข้อมูลหาย
  restoreDraft(next, game.slots);

  setState(carryOverSettings(next, previous));
  syncSecondsFromState();
  liveMatch.set(matchId, game.id);
  // เริ่มจากสถานะจริงของเกมที่เพิ่งเปิด ไม่ใช่ false เสมอ
  // เปิดเกมที่ล็อกไปแล้วซ้ำ ต้องไม่ถูกนับว่า "เพิ่งล็อก" อีกรอบ
  liveGameLocked = game.draftLocked;
  emitState();

  // หน้าอื่นที่เปิดค้างอยู่ต้องรู้ว่าตอนนี้คู่ไหนขึ้นจอ
  notifyData({ topic: 'live', tournamentId: match.tournamentId });

  return { live: describeLive() };
}

export interface RoundResult {
  round: number;
  rounds: number;
}

export type StepRoundResult =
  | { result: RoundResult; error?: undefined }
  | { error: string; result?: undefined };

// เดินไปรอบถัดไป / ย้อนกลับรอบก่อนหน้า
//
// สองทางเดินคนละแบบ แต่จบที่ state.round เท่ากัน
//
// ทัวร์นาเมนต์: ย้ายตัวชี้ไปอีกเกมหนึ่งของแมตช์เดิม goLive จัดการที่เหลือให้หมด
// ทั้งอ่านดราฟต์ของเกมนั้นกลับขึ้นจอ ประกอบรอบก่อนหน้าใหม่จากฐาน และรีเซ็ตนาฬิกา
// ห้ามล้างกระดานเองก่อนย้ายเด็ดขาด ตัวบันทึกดราฟต์เกาะอยู่กับ emitState
// ความว่างจะถูกเขียนทับดราฟต์ของเกมที่กำลังจะกลายเป็นรอบก่อนหน้าทันที
//
// แมตช์เดี่ยว: ไม่มีฐานให้ผูก เก็บกระดานปัจจุบันใส่กองไว้เอง แล้วดึงรอบปลายทาง
// ขึ้นมาถ้าเคยเก็บไว้ ไม่งั้นก็เริ่มจากกระดานเปล่า
export function stepRound(delta: number): StepRoundResult {
  const state = getState();
  const current = state.round;
  const target = Math.min(Math.max(current + Math.trunc(delta), FIRST_ROUND), MAX_ROUND_NUMBER);

  if (target === current) {
    return current === FIRST_ROUND && delta < 0
      ? { error: 'Already on round 1' }
      : { error: 'Round is already at the limit' };
  }

  const pointer = isDatabaseOpen() ? getStores().liveMatch.get() : { matchId: null };
  if (pointer.matchId) {
    // ซีรีส์มีเกมได้เท่าที่กติกาบอก กด > ค้างไว้ไม่ควรได้เกมที่ 6 ของ Bo5
    //
    // goLive ตัดให้อยู่แล้ว แต่การตัดเงียบๆ แปลว่าเลขบนหน้าจอไม่ขยับโดยไม่มีคำอธิบาย
    // ซึ่งอ่านเหมือนปุ่มเสีย บอกไปตรงๆ ดีกว่า
    // ข้อความคงที่ ไม่ใส่ตัวเลขลงไป
    //
    // ฝั่งหน้าเว็บแปลข้อความที่เซิร์ฟเวอร์ส่งมาด้วย t() ซึ่งเทียบทั้งประโยคเป็นกุญแจ
    // ประโยคที่มีตัวเลขอยู่ข้างในจึงไม่มีวันตรงกับกุญแจไหน แล้วมันจะเป็นคำเดียว
    // ในสามคำปฏิเสธของตัวเดินรอบที่โผล่มาเป็นภาษาอังกฤษ
    // ความยาวซีรีส์เห็นได้จากชื่อแมตช์บนแบนเนอร์ (BO5) อยู่แล้ว
    const match = getStores().matches.get(pointer.matchId);
    if (match && target > match.bestOf) {
      return { error: 'This series has no more games' };
    }
    const result = goLive(pointer.matchId, target);
    if (result.error !== undefined) return { error: result.error };
    const after = getState();
    return { result: { round: after.round, rounds: after.rounds.length } };
  }

  // เก็บกระดานที่กำลังจะออกจากจอไว้ก่อนเสมอ ไม่ว่าจะเดินหน้าหรือถอยหลัง
  // เดินเลยไปแล้วกดกลับมาคือการแก้ที่กดผิด ไม่ใช่การขอให้ลบงานที่เพิ่งทำ
  state.rounds = fileRound(state.rounds, boardToRound(state, current));

  const saved = takeRound(state.rounds, target);
  if (saved) restoreRound(state, saved);
  else clearBoard(state);

  state.round = target;

  // ประวัติ undo เป็นของดราฟต์ในรอบที่เพิ่งออกจากจอ ต้องทิ้งไปพร้อมกัน
  //
  // เหตุผลเดียวกับที่ setState เรียก clearUndo() และทางฝั่งทัวร์นาเมนต์ก็ได้ของนี้
  // มาฟรีอยู่แล้วเพราะเดินผ่าน goLive -> setState ทางแมตช์เดี่ยวไม่ได้ผ่านตรงนั้น
  //
  // เห็นกับตาแล้ว: ดราฟต์รอบ 1 ครบสี่ตัว เดินไปรอบ 2 เลือกไปหนึ่งตัว แล้วกด Ctrl+Z
  // สามครั้ง กระดานรอบ 2 กลายเป็น airi, aleister ทั้งที่ aleister ไม่เคยถูกเลือก
  // ในรอบนั้นเลย มันคือดราฟต์ของรอบ 1 ที่ไหลข้ามมา และในโหมดทัวร์นาเมนต์
  // emit ครั้งถัดไปจะเขียนกระดานที่แต่งขึ้นนั้นลงเป็นดราฟต์จริงของเกมที่ 2
  clearUndo();

  // ดราฟต์เป็นของรอบ ไม่ใช่ของแมตช์ เปลี่ยนรอบแล้วนาฬิกากับลำดับเฟสต้องเริ่มใหม่
  // resetDraft ยิง emitState ให้เองแล้ว
  resetDraft();

  return { result: { round: state.round, rounds: state.rounds.length } };
}

// เอาทีมจากทะเบียนมาใส่ฝั่งหนึ่งของ overlay โดยไม่ต้องมีทัวร์นาเมนต์
//
// ใช้กับแมตช์เดี่ยวที่ไม่ได้อยู่ในสายการแข่ง เป็นทางที่มาแทนพรีเซ็ตเดิม
// ต่างจาก goLive() ตรงที่แตะแค่ฝั่งเดียว: ชื่อ ผู้เล่น โลโก้
// คะแนน ดราฟต์ที่กรอกไปแล้ว และอีกฝั่งต้องไม่ขยับ
// คนคุมงานเลือกทีมทีละฝั่ง และมักเลือกตอนที่อีกฝั่งกรอกไว้แล้ว
export function loadTeamIntoSide(teamKey: unknown, teamId: string): LoadTeamResult {
  if (!isTeamKey(teamKey)) return { error: 'Unknown side' };

  const team = getStores().teams.get(teamId);
  if (!team) return { error: 'Team not found' };

  const state = getState();
  // โลโก้ของทีมในทะเบียนอยู่ไฟล์ <teamId>.<ext> ไม่ใช่ blue-team.<ext>
  // ต้องบอก src ไปด้วย ไม่งั้น overlay จะไปเปิดภาพที่ค้างอยู่ในช่องของฝั่งนั้น
  // ซึ่งเป็นของทีมอื่น เหตุผลเดียวกับใน goLive()
  state[teamKey] = sanitizeTeam({
    ...state[teamKey],
    name: team.name,
    logo: { ...team.logo, src: team.id },
    players: team.players.map((player, i) => player.name || `Player ${i + 1}`),
    positions: team.players.map((player) => player.position)
  }, defaultState[teamKey]);

  emitState();
  return { state: getState() };
}

// โลโก้ของทีมในทะเบียนเปลี่ยน ฝั่งที่ทีมนั้นอยู่บนจอต้องเปลี่ยนตามทันที
//
// state เก็บ v กับ ext ของโลโก้ไว้เป็นสำเนา ณ ตอนที่เอาทีมขึ้นจอ
// อัปโหลดโลโก้ใหม่ทีหลังจะไปแก้แค่แถวในทะเบียน ส่วน state ยังถือ v เดิม
// overlay เทียบ v/ext/src ก่อนแตะ src ของ <img> (กันภาพกระพริบทุกวินาที)
// เห็นว่าไม่มีอะไรเปลี่ยนจึงไม่โหลดใหม่ ภาพเก่าค้างอยู่บนอากาศ
// และถ้าตอนเอาขึ้นจอทีมยังไม่มีโลโก้เลย (v = 0) ช่องนั้นจะว่างต่อไปทั้งที่อัปโหลดแล้ว
//
// เทียบด้วย logo.src ซึ่งเป็น id ของทีมในทะเบียน ไม่ใช่เดาจากฝั่ง
// สลับฝั่งแล้วค่านี้ติดไปกับทีมด้วย จึงยังหาถูกฝั่ง
export function refreshLiveTeamLogo(teamId: string): void {
  const team = getStores().teams.get(teamId);
  if (!team) return;

  const state = getState();
  let touched = false;

  TEAM_KEYS.forEach((key) => {
    const current = state[key].logo;
    if (current.src !== teamId) return;
    if (current.v === team.logo.v && current.ext === team.logo.ext) return;
    state[key].logo = { ...team.logo, src: teamId };
    touched = true;
  });

  if (touched) emitState();
}

// เลิกผูกดราฟต์กับแมตช์ที่ออกอากาศอยู่ เมื่อ state ถูกแทนที่ทั้งก้อน
//
// RESET MATCH ล้างกระดานให้เป็น BLUE/RED เปล่าๆ ซึ่งไม่ใช่แมตช์ไหนอีกต่อไป
// ถ้าตัวชี้ยังค้างอยู่ แถบ ON AIR จะยังบอกว่ากำลังบันทึกดราฟต์ลงคู่นั้นอยู่
// ทั้งที่ตัวบันทึกปฏิเสธไปแล้ว (ดู captureDraft) = หน้าจอโกหกคนคุมงาน
//
// ไม่เรียก getStores() ตรงๆ ถ้าฐานยังไม่เคยถูกเปิด
// คนที่ใช้แค่ overlay กับหน้า control ไม่ควรมีไฟล์ tournament.db งอกมาเพราะกด RESET
export function releaseLiveMatch(): void {
  if (!isDatabaseOpen()) return;
  const { liveMatch } = getStores();
  if (!liveMatch.get().matchId) return;
  liveMatch.clear();
  notifyData({ topic: 'live' });
}

export function clearLive(): LiveInfo {
  getStores().liveMatch.clear();
  notifyData({ topic: 'live' });
  return describeLive();
}

// ตัวเลขสถิติขยับได้สองจังหวะเท่านั้น: ดราฟต์ล็อก และบันทึกผู้ชนะของเกม
// ทั้งสองอย่างคือหัวข้อ 'games' ในระบบสัญญาณกลาง (services/sync.ts)
export function notifyAnalytics(): void {
  notifyData({ topic: 'games' });
}

// เกาะกับ state กลาง แล้วมิเรอร์ดราฟต์ลงเกมที่ผูกไว้ทุกครั้งที่มีการเปลี่ยน
// เรียกครั้งเดียวตอนเปิดเซิร์ฟเวอร์
let attached = false;

// ดราฟต์ของเกมที่กำลังออกอากาศล็อกไปหรือยัง
//
// เก็บไว้เพื่อจับ "จังหวะที่เพิ่งล็อก" ซึ่งเป็นจังหวะเดียวที่สถิติเปลี่ยน
// ระหว่างที่ดราฟต์ยังไม่ครบ ตัวเลขที่ล็อกแล้วไม่ขยับเลย จึงไม่ต้องกวนหน้าสถิติ
let liveGameLocked = false;

export function attachDraftCapture(): void {
  if (attached) return;
  attached = true;

  subscribe((state: GameState) => {
    const { liveMatch, games } = getStores();
    const pointer = liveMatch.get();
    if (!pointer.gameId) return;   // ไม่ได้ผูกกับแมตช์ไหน = แมตช์เดี่ยว ไม่ต้องบันทึก

    const game = games.captureDraft(pointer.gameId, state);
    const locked = game?.draftLocked === true;
    // ขอบขาขึ้นเท่านั้น ไม่ใช่ทุกครั้งที่ล็อกอยู่
    // ไม่งั้นทุกการแก้ดราฟต์หลังล็อกจะสั่งให้หน้าสถิติดึงข้อมูลใหม่ทั้งชุด
    if (locked && !liveGameLocked) notifyAnalytics();
    liveGameLocked = locked;
  });
}
