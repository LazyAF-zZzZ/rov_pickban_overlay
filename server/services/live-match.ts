// เชื่อมแมตช์ในตารางแข่งเข้ากับ overlay ที่กำลังออกอากาศ
//
// "เปิดแมตช์" = เอาทีมของแมตช์นั้นขึ้น overlay + จำว่ากำลังออกอากาศคู่ไหน
// ใช้ทางเดียวกับการโหลดพรีเซ็ต (carryOverSettings) ตั้งใจ:
// ธีม คีย์ลัด ภาพพื้นหลัง และขนาดจอ ต้องไม่เปลี่ยนตอนสลับแมตช์กลางงาน
//
// ตัวบันทึกดราฟต์เกาะอยู่กับ subscribe() ของ live-state
// ทุกครั้งที่ pick/ban เปลี่ยน ดราฟต์จะถูกมิเรอร์ลงเกมที่ผูกไว้ทันที
// ไม่ต้องรอให้ใครกดเซฟ และไม่มีขั้นตอน "ปิดงาน" ให้ลืม

import { deepClone } from '../lib/json';
import { defaultState, sanitizeState } from '../domain/match';
import type { GameState } from '../domain/match';
import { carryOverSettings } from '../domain/settings';
import { getState, setState, emitState, subscribe } from '../store/live-state';
import { notifyData } from './sync';
import { stopDraftTimer, syncSecondsFromState } from './draft-engine';
import { getStores } from '../store/index';
import type { GameSlot } from '../store/games';

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

function label(bracket: string, round: number): string {
  return bracket === 'main' ? `Round ${round}` : `Group ${bracket} - round ${round}`;
}

// เกมถัดไปที่ยังไม่ได้เล่นในซีรีส์ = คะแนนรวมปัจจุบัน + 1
function nextGameNo(scoreA: number, scoreB: number): number {
  return scoreA + scoreB + 1;
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

export function goLive(matchId: string): GoLiveResult {
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

  const gameNo = nextGameNo(match.scoreA, match.scoreB);

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
      players: blue.players.map((p, i) => p.name || `Player ${i + 1}`)
    },
    teamRed: {
      ...deepClone(defaultState.teamRed),
      name: red.name,
      logo: { ...red.logo, src: red.id },
      players: red.players.map((p, i) => p.name || `Player ${i + 1}`)
    },
    // คะแนนซีรีส์ ไม่ใช่คะแนนในเกม overlay จะได้โชว์สถานะซีรีส์ถูก
    matchInfo: {
      title: `${blue.name} VS ${red.name} : GAME ${gameNo} [BO${match.bestOf}]`,
      tournament: tournament?.name || ''
    }
  });
  next.teamBlue.score = match.scoreA;
  next.teamRed.score = match.scoreB;

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
