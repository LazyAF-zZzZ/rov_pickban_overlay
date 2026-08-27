// ที่รวม store ของทัวร์นาเมนต์ เปิดฐานข้อมูลครั้งเดียวใช้ร่วมกันทั้งแอพ
//
// เปิดแบบ lazy ตั้งใจ: ไฟล์ tournament.db จะยังไม่ถูกสร้าง
// จนกว่าจะมีใครเรียกใช้ฟีเจอร์ทัวร์นาเมนต์จริงๆ
// คนที่ใช้แค่ overlay กับ control panel แบบเดิมจึงไม่มีไฟล์งอกขึ้นมาเปล่าๆ
//
// เทสต์ไม่ควรเรียกตัวนี้ ให้สร้าง store เองจาก openDatabase(':memory:')
// ไม่งั้นจะไปแตะไฟล์จริงของผู้ใช้

import type { DatabaseSync } from 'node:sqlite';
import { getDatabase } from './db';
import type { TeamStore } from './teams';
import { createTeamStore } from './teams';
import type { TournamentStore } from './tournaments';
import { createTournamentStore } from './tournaments';
import type { MatchStore } from './matches';
import { createMatchStore } from './matches';
import type { GameStore } from './games';
import { createGameStore } from './games';
import type { LiveMatchStore } from './live-match';
import { createLiveMatchStore } from './live-match';
import type { HistoryStore } from './history';
import { createHistoryStore } from './history';
import type { AnalyticsStore } from './analytics';
import { createAnalyticsStore } from './analytics';

export interface Stores {
  db: DatabaseSync;
  teams: TeamStore;
  tournaments: TournamentStore;
  matches: MatchStore;
  games: GameStore;
  liveMatch: LiveMatchStore;
  history: HistoryStore;
  analytics: AnalyticsStore;
}

let stores: Stores | null = null;

export function getStores(): Stores {
  if (!stores) {
    const db = getDatabase();
    const teams = createTeamStore(db);
    const tournaments = createTournamentStore(db, teams);
    stores = {
      db,
      teams,
      tournaments,
      matches: createMatchStore(db, tournaments),
      games: createGameStore(db),
      liveMatch: createLiveMatchStore(db),
      history: createHistoryStore(db),
      analytics: createAnalyticsStore(db)
    };
  }
  return stores;
}
