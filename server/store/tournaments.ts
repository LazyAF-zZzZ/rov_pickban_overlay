// ทัวร์นาเมนต์และรายชื่อทีมที่ลงแข่ง อ่าน/เขียนฐานข้อมูล
//
// เพดาน 128 ทีมถูกบังคับที่นี่ ไม่ใช่ที่หน้าเว็บ
// หน้าเว็บควรกันไว้ด้วยเพื่อ UX ที่ดี แต่ห้ามเชื่อว่าหน้าเว็บกันแล้วพอ

import type { DatabaseSync } from 'node:sqlite';
import { newId } from '../domain/ids';
import type { TournamentFormat, TournamentStatus, BestOf } from '../domain/tournament';
import {
  sanitizeTournamentInput,
  sanitizeStatus,
  canAddTeams,
  canUseFormat,
  maxTeamsFor
} from '../domain/tournament';
import type { Team } from '../domain/team';
import { sanitizeSeed } from '../domain/team';
import type { TeamStore } from './teams';

export interface Tournament {
  id: string;
  name: string;
  status: TournamentStatus;
  format: TournamentFormat;
  bestOf: BestOf;
  note: string;
  teamCount: number;
  maxTeams: number;
  createdAt: number;
  updatedAt: number;
}

// ทีมในทัวร์นาเมนต์ = ทีมจากทะเบียน บวกลำดับวางสาย
export interface SeededTeam extends Team {
  seed: number;
}

export type TournamentResult =
  | { tournament: Tournament; error?: undefined }
  | { error: string; tournament?: undefined };

export type RosterResult =
  | { ok: true; teamCount: number; error?: undefined }
  | { error: string; limit?: number; ok?: undefined };

export type SimpleResult = { ok: true; error?: undefined } | { error: string; ok?: undefined };

// สิ่งที่หายไปพร้อมกับทัวร์นาเมนต์ นับไว้ก่อนลบ เพื่อบอกผู้ใช้ได้ว่าการลบครั้งนี้
// กินอะไรไปบ้าง teams คือที่นั่งในรายชื่อผู้เข้าแข่ง ไม่ใช่ทีมในทะเบียนกลาง
// ทีมในทะเบียนไม่หายไปไหน ทัวร์นาเมนต์อื่นยังใช้ทีมเดิมได้ครบ
export interface RemovedCounts {
  teams: number;
  matches: number;
  games: number;
}

export type RemoveResult =
  | { ok: true; removed: RemovedCounts; error?: undefined }
  | { error: string; ok?: undefined; removed?: undefined };

interface TournamentRow {
  id: string;
  name: string;
  status: string;
  format: string;
  best_of: number;
  note: string;
  created_at: number;
  updated_at: number;
}

function rowToTournament(row: TournamentRow, teamCount: number): Tournament {
  return {
    id: row.id,
    name: row.name,
    status: row.status as TournamentStatus,
    format: row.format as TournamentFormat,
    bestOf: row.best_of as BestOf,
    note: row.note,
    teamCount,
    maxTeams: maxTeamsFor(row.format),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface TournamentStore {
  get(id: string): Tournament | null;
  list(): Tournament[];
  create(input: unknown): TournamentResult;
  update(id: string, input: unknown): TournamentResult;
  setStatus(id: string, status: unknown): TournamentResult;
  remove(id: string): RemoveResult;
  teams(id: string): SeededTeam[];
  teamCount(id: string): number;
  addTeam(id: string, teamId: string, seed?: number): RosterResult;
  removeTeam(id: string, teamId: string): RosterResult;
  setSeed(id: string, teamId: string, seed: unknown): SimpleResult;
}

export function createTournamentStore(db: DatabaseSync, teamStore: TeamStore): TournamentStore {
  const q = {
    insert: db.prepare(
      'INSERT INTO tournaments (id, name, status, format, best_of, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ),
    update: db.prepare(
      'UPDATE tournaments SET name = ?, status = ?, format = ?, best_of = ?, note = ?, updated_at = ? WHERE id = ?'
    ),
    setStatus: db.prepare('UPDATE tournaments SET status = ?, updated_at = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM tournaments WHERE id = ?'),
    countMatches: db.prepare('SELECT COUNT(*) AS n FROM matches WHERE tournament_id = ?'),
    countGames: db.prepare(
      'SELECT COUNT(*) AS n FROM games WHERE match_id IN (SELECT id FROM matches WHERE tournament_id = ?)'
    ),
    byId: db.prepare('SELECT * FROM tournaments WHERE id = ?'),
    all: db.prepare('SELECT * FROM tournaments ORDER BY created_at DESC'),

    addTeam: db.prepare(
      'INSERT INTO tournament_teams (tournament_id, team_id, seed, added_at) VALUES (?, ?, ?, ?)'
    ),
    removeTeam: db.prepare('DELETE FROM tournament_teams WHERE tournament_id = ? AND team_id = ?'),
    hasTeam: db.prepare('SELECT 1 AS x FROM tournament_teams WHERE tournament_id = ? AND team_id = ?'),
    countTeams: db.prepare('SELECT COUNT(*) AS n FROM tournament_teams WHERE tournament_id = ?'),
    teamIds: db.prepare(
      'SELECT team_id, seed FROM tournament_teams WHERE tournament_id = ? ORDER BY seed, added_at'
    ),
    setSeed: db.prepare('UPDATE tournament_teams SET seed = ? WHERE tournament_id = ? AND team_id = ?')
  };

  const findRow = (id: string): TournamentRow | undefined => q.byId.get(id) as TournamentRow | undefined;
  const teamCountOf = (id: string): number => (q.countTeams.get(id) as { n: number }).n;
  const countOf = (stmt: { get(id: string): unknown }, id: string): number =>
    (stmt.get(id) as { n: number }).n;
  const isMember = (id: string, teamId: string): boolean => q.hasTeam.get(id, teamId) !== undefined;

  const store: TournamentStore = {
    get(id) {
      const row = findRow(id);
      return row ? rowToTournament(row, teamCountOf(id)) : null;
    },

    list() {
      return (q.all.all() as unknown as TournamentRow[])
        .map((row) => rowToTournament(row, teamCountOf(row.id)));
    },

    create(input) {
      const checked = sanitizeTournamentInput(input);
      if (checked.error !== undefined) return { error: checked.error };

      const id = newId('tournament');
      const now = Date.now();
      const { name, status, format, bestOf, note } = checked.tournament;
      q.insert.run(id, name, status, format, bestOf, note, now, now);
      return { tournament: store.get(id) as Tournament };
    },

    update(id, input) {
      if (!findRow(id)) return { error: 'Tournament not found' };

      const checked = sanitizeTournamentInput(input);
      if (checked.error !== undefined) return { error: checked.error };

      // เปลี่ยนรูปแบบทั้งที่ทีมเกินเพดานของรูปแบบใหม่ไม่ได้
      // เช่น มี 40 ทีมแล้วจะเปลี่ยนเป็นพบกันหมด (รับได้ 24)
      const { name, status, format, bestOf, note } = checked.tournament;
      const allowed = canUseFormat(format, teamCountOf(id));
      if (!allowed.ok) return { error: allowed.error };

      q.update.run(name, status, format, bestOf, note, Date.now(), id);
      return { tournament: store.get(id) as Tournament };
    },

    // ปิดทัวร์นาเมนต์ / เปิดกลับมาแก้ต่อ
    setStatus(id, status) {
      if (!findRow(id)) return { error: 'Tournament not found' };
      q.setStatus.run(sanitizeStatus(status), Date.now(), id);
      return { tournament: store.get(id) as Tournament };
    },

    // ลบจริง ไม่เหลืออะไรไว้ ไม่มีธง "ซ่อนไว้" ที่ไหนทั้งนั้น
    //
    // แถวที่เหลือถูก FK แบบ CASCADE พาไปเอง (ดู migrations.ts):
    // tournament_teams และ matches -> games -> game_slots หายทั้งสาย
    // ตัวชี้ live_match เป็น ON DELETE SET NULL จึงคลายออก ไม่ค้างชี้ของที่ไม่มีแล้ว
    //
    // ต้องนับก่อนสั่งลบ ถ้าอ่านทีหลังจะได้ศูนย์ทุกครั้ง
    remove(id) {
      if (!findRow(id)) return { error: 'Tournament not found' };
      const removed: RemovedCounts = {
        teams: teamCountOf(id),
        matches: countOf(q.countMatches, id),
        games: countOf(q.countGames, id)
      };
      q.remove.run(id);
      return { ok: true, removed };
    },

    // ทีมที่ลงแข่ง พร้อมข้อมูลทีมเต็มจากทะเบียนกลาง
    teams(id) {
      const rows = q.teamIds.all(id) as unknown as { team_id: string; seed: number }[];
      return rows
        .map((row): SeededTeam | null => {
          const team = teamStore.get(row.team_id);
          return team ? { ...team, seed: row.seed } : null;
        })
        .filter((team): team is SeededTeam => team !== null);
    },

    teamCount(id) {
      return teamCountOf(id);
    },

    addTeam(id, teamId, seed = 0) {
      const tournament = findRow(id);
      if (!tournament) return { error: 'Tournament not found' };
      if (!teamStore.get(teamId)) return { error: 'Team not found' };
      if (isMember(id, teamId)) return { error: 'Team is already in this tournament' };

      const room = canAddTeams(tournament.format, teamCountOf(id), 1);
      if (!room.ok) return { error: room.error, limit: room.limit };

      q.addTeam.run(id, teamId, sanitizeSeed(seed), Date.now());
      return { ok: true, teamCount: teamCountOf(id) };
    },

    removeTeam(id, teamId) {
      if (!findRow(id)) return { error: 'Tournament not found' };
      if (!isMember(id, teamId)) return { error: 'Team is not in this tournament' };
      q.removeTeam.run(id, teamId);
      return { ok: true, teamCount: teamCountOf(id) };
    },

    setSeed(id, teamId, seed) {
      if (!isMember(id, teamId)) return { error: 'Team is not in this tournament' };
      q.setSeed.run(sanitizeSeed(seed), id, teamId);
      return { ok: true };
    }
  };

  return store;
}
