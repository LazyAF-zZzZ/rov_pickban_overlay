// สำรองข้อมูลทั้งเครื่อง และกู้คืนกลับมา
//
// ทำไมเก็บเป็น "แถว" ไม่ใช่ก๊อปไฟล์ .db ไปทั้งไฟล์
//
// ไฟล์ .db ผูกกับสคีมา ณ วันที่ก๊อป เอากลับมาลงเครื่องที่รันขั้นย้ายข้อมูลไปไกลกว่า
// แล้วจะพังหรือได้ตารางที่ขาดคอลัมน์ ส่วนการอ่านเป็นแถวแล้วเขียนกลับผ่าน SQL
// ของเวอร์ชันปัจจุบัน ทำให้ไฟล์เก่ายังกู้ลงเครื่องใหม่ได้เสมอ
//
// และมันเปิดอ่านได้ด้วยตาเปล่า ซึ่งสำคัญกว่าที่คิดสำหรับเครื่องมือที่คนใช้ต้อง
// เชื่อใจว่ามันเก็บงานทั้งฤดูกาลไว้จริง
//
// กฎความปลอดภัยของไฟล์นำเข้าอยู่ที่ domain/backup.ts ทั้งหมด
// ไฟล์นี้รับเฉพาะของที่ผ่านตัวกรองนั้นมาแล้ว และเพิ่มอีกสองด่านที่ต้องมีตรงนี้:
// เขียนไฟล์ภาพผ่าน teamLogoFilePath/skinFilePath เท่านั้น แล้วตรวจซ้ำว่าเส้นทาง
// ที่ได้อยู่ใต้โฟลเดอร์สื่อจริง และทำทั้งหมดในทรานแซกชันเดียว

import fs from 'fs';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import type {
  BackupFile, BackupData, BackupImage, BackupTeam, BackupTournament, BackupMatch, BackupGame
} from '../domain/backup';
import { BACKUP_FORMAT, BACKUP_VERSION } from '../domain/backup';
import type { ImageExt, SkinSlot } from '../domain/media';
import {
  SKIN_DIR, LOGO_DIR, SKIN_SLOTS, isSkinSlot, isTeamLogoId,
  teamLogoFilePath, skinFilePath, removeTeamLogoFiles, removeSkinFiles
} from '../domain/media';
import { USER_MEDIA_DIR } from '../config';

const IMAGE_EXTS: ImageExt[] = ['png', 'jpg', 'webp'];

export type RestoreMode = 'merge' | 'replace';

export interface RestoreReport {
  teamsAdded: number;
  teamsSkipped: number;
  tournamentsAdded: number;
  tournamentsSkipped: number;
  matchesAdded: number;
  gamesAdded: number;
  logosWritten: number;
  skinsWritten: number;
  mode: RestoreMode;
}

export interface BackupStore {
  exportAll(appVersion: string): BackupFile;
  restore(file: BackupFile, mode: RestoreMode): RestoreReport;
  /** อะไรอยู่ในเครื่องตอนนี้บ้าง ใช้เทียบกับไฟล์ก่อนถามยืนยัน */
  existing(): { teamIds: Set<string>; tournamentIds: Set<string> };
}

// ด่านสุดท้ายก่อนเขียนไฟล์
//
// ไม่ได้ไว้แทนตัวกรองข้างบน แต่ไว้ให้ตัวกรองข้างบนพังแล้วยังไม่มีอะไรหลุด
// วันหนึ่งมีคนผ่อน isSafeMediaId ให้รับจุดหรือ slash ด่านนี้ยังยืนอยู่
function assertInsideMediaDir(target: string): string {
  const root = path.resolve(USER_MEDIA_DIR);
  const full = path.resolve(target);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`Refused to write outside the media folder: ${target}`);
  }
  return full;
}

function readImageFile(file: string): BackupImage | null {
  try {
    const bytes = fs.readFileSync(file);
    const ext = path.extname(file).slice(1) as ImageExt;
    return { ext, bytes: bytes.toString('base64') };
  } catch {
    return null;
  }
}

function findImage(dir: string, base: string): BackupImage | null {
  for (const ext of IMAGE_EXTS) {
    const file = path.join(dir, `${base}.${ext}`);
    if (fs.existsSync(file)) return readImageFile(file);
  }
  return null;
}

interface Row { [key: string]: unknown }

export function createBackupStore(db: DatabaseSync): BackupStore {
  const all = (sql: string): Row[] => db.prepare(sql).all() as unknown as Row[];

  const q = {
    insertTeam: db.prepare(
      `INSERT INTO teams (id, name, tag, logo_v, logo_ext, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ),
    insertPlayer: db.prepare(
      `INSERT INTO team_players (team_id, slot, name, position, is_captain)
       VALUES (?, ?, ?, ?, ?)`
    ),
    insertTournament: db.prepare(
      `INSERT INTO tournaments (id, name, status, format, best_of, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    insertTournamentTeam: db.prepare(
      `INSERT INTO tournament_teams (tournament_id, team_id, seed, added_at) VALUES (?, ?, ?, ?)`
    ),
    insertMatch: db.prepare(
      `INSERT INTO matches
        (id, tournament_id, bracket, round, slot, team_a_id, team_b_id, best_of,
         status, score_a, score_b, winner_id, is_bye,
         next_round, next_slot, next_side, next_bracket,
         loser_round, loser_slot, loser_side, loser_bracket, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    insertGame: db.prepare(
      `INSERT INTO games
        (id, match_id, game_no, blue_team_id, red_team_id, blue_name, red_name,
         draft_locked, winner, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    insertSlot: db.prepare(
      `INSERT INTO game_slots (game_id, side, kind, idx, hero) VALUES (?, ?, ?, ?, ?)`
    ),
    teamIds: db.prepare('SELECT id FROM teams'),
    tournamentIds: db.prepare('SELECT id FROM tournaments'),
    hasTeam: db.prepare('SELECT 1 AS n FROM teams WHERE id = ?'),
    hasTournament: db.prepare('SELECT 1 AS n FROM tournaments WHERE id = ?'),
    hasMatch: db.prepare('SELECT 1 AS n FROM matches WHERE id = ?'),
    hasGame: db.prepare('SELECT 1 AS n FROM games WHERE id = ?'),
    wipe: [
      'DELETE FROM game_slots',
      'DELETE FROM games',
      'DELETE FROM matches',
      'DELETE FROM tournament_teams',
      'DELETE FROM tournaments',
      'DELETE FROM team_players',
      'DELETE FROM teams',
      'DELETE FROM live_match'
    ]
  };

  function collect(): BackupData {
    const playersByTeam = new Map<string, BackupTeam['players']>();
    all('SELECT * FROM team_players ORDER BY team_id, slot').forEach((r) => {
      const list = playersByTeam.get(String(r.team_id)) || [];
      list.push({
        slot: Number(r.slot),
        name: String(r.name ?? ''),
        position: String(r.position ?? ''),
        isCaptain: Number(r.is_captain) === 1
      });
      playersByTeam.set(String(r.team_id), list);
    });

    const teams: BackupTeam[] = all('SELECT * FROM teams ORDER BY created_at').map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      tag: String(r.tag ?? ''),
      logoV: Number(r.logo_v ?? 0),
      logoExt: String(r.logo_ext ?? ''),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
      players: playersByTeam.get(String(r.id)) || []
    }));

    const seedsByTournament = new Map<string, BackupTournament['teams']>();
    all('SELECT * FROM tournament_teams ORDER BY tournament_id, seed').forEach((r) => {
      const list = seedsByTournament.get(String(r.tournament_id)) || [];
      list.push({
        teamId: String(r.team_id),
        seed: Number(r.seed ?? 0),
        addedAt: Number(r.added_at)
      });
      seedsByTournament.set(String(r.tournament_id), list);
    });

    const tournaments: BackupTournament[] = all('SELECT * FROM tournaments ORDER BY created_at')
      .map((r) => ({
        id: String(r.id),
        name: String(r.name ?? ''),
        status: String(r.status ?? 'active'),
        format: String(r.format ?? 'single_elim'),
        bestOf: Number(r.best_of ?? 3),
        note: String(r.note ?? ''),
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        teams: seedsByTournament.get(String(r.id)) || []
      }));

    const matches: BackupMatch[] = all('SELECT * FROM matches ORDER BY created_at').map((r) => ({
      id: String(r.id),
      tournamentId: String(r.tournament_id),
      bracket: String(r.bracket ?? 'main'),
      round: Number(r.round),
      slot: Number(r.slot),
      teamAId: r.team_a_id === null ? null : String(r.team_a_id),
      teamBId: r.team_b_id === null ? null : String(r.team_b_id),
      bestOf: Number(r.best_of ?? 3),
      status: String(r.status ?? 'pending'),
      scoreA: Number(r.score_a ?? 0),
      scoreB: Number(r.score_b ?? 0),
      winnerId: r.winner_id === null ? null : String(r.winner_id),
      isBye: Number(r.is_bye) === 1,
      nextRound: r.next_round === null ? null : Number(r.next_round),
      nextSlot: r.next_slot === null ? null : Number(r.next_slot),
      nextSide: r.next_side === null ? null : Number(r.next_side),
      nextBracket: r.next_bracket === null ? null : String(r.next_bracket),
      loserRound: r.loser_round === null ? null : Number(r.loser_round),
      loserSlot: r.loser_slot === null ? null : Number(r.loser_slot),
      loserSide: r.loser_side === null ? null : Number(r.loser_side),
      loserBracket: r.loser_bracket === null ? null : String(r.loser_bracket),
      createdAt: Number(r.created_at)
    }));

    const slotsByGame = new Map<string, BackupGame['slots']>();
    all('SELECT * FROM game_slots').forEach((r) => {
      const list = slotsByGame.get(String(r.game_id)) || [];
      list.push({
        side: String(r.side),
        kind: String(r.kind),
        idx: Number(r.idx),
        hero: String(r.hero)
      });
      slotsByGame.set(String(r.game_id), list);
    });

    const games: BackupGame[] = all('SELECT * FROM games ORDER BY started_at').map((r) => ({
      id: String(r.id),
      matchId: String(r.match_id),
      gameNo: Number(r.game_no),
      blueTeamId: r.blue_team_id === null ? null : String(r.blue_team_id),
      redTeamId: r.red_team_id === null ? null : String(r.red_team_id),
      blueName: String(r.blue_name ?? ''),
      redName: String(r.red_name ?? ''),
      draftLocked: Number(r.draft_locked) === 1,
      winner: r.winner === null ? null : String(r.winner),
      startedAt: Number(r.started_at),
      updatedAt: Number(r.updated_at),
      slots: slotsByGame.get(String(r.id)) || []
    }));

    // ภาพ: อ่านเฉพาะของทีมที่มีอยู่จริง ไม่ได้กวาดทั้งโฟลเดอร์
    // ไฟล์ที่ไม่มีทีมเป็นเจ้าของคือเศษที่ค้างอยู่ ไม่ควรพาไปด้วย
    const logos: Record<string, BackupImage> = {};
    teams.forEach((team) => {
      if (!team.logoV || !isTeamLogoId(team.id)) return;
      const image = findImage(LOGO_DIR, team.id);
      if (image) logos[team.id] = image;
    });

    const skins: Record<string, BackupImage> = {};
    (Object.keys(SKIN_SLOTS) as SkinSlot[]).forEach((slot) => {
      const image = findImage(SKIN_DIR, SKIN_SLOTS[slot]);
      if (image) skins[slot] = image;
    });

    return { teams, tournaments, matches, games, logos, skins, state: null };
  }

  function writeImages(data: BackupData): { logos: number; skins: number } {
    let logosWritten = 0;
    let skinsWritten = 0;

    fs.mkdirSync(LOGO_DIR, { recursive: true });
    fs.mkdirSync(SKIN_DIR, { recursive: true });

    Object.entries(data.logos).forEach(([teamId, image]) => {
      if (!isTeamLogoId(teamId)) return;
      // ลบของเดิมทุกนามสกุลก่อน ไม่งั้นทีมที่เคยเป็น .jpg แล้วไฟล์สำรองเป็น .png
      // จะเหลือสองไฟล์ แล้วตัวเลือกภาพจะหยิบอันเก่าตามลำดับที่ค้นหา
      removeTeamLogoFiles(teamId);
      const target = assertInsideMediaDir(teamLogoFilePath(teamId, image.ext));
      fs.writeFileSync(target, Buffer.from(image.bytes, 'base64'));
      logosWritten += 1;
    });

    Object.entries(data.skins).forEach(([slot, image]) => {
      if (!isSkinSlot(slot)) return;
      removeSkinFiles(slot);
      const target = assertInsideMediaDir(skinFilePath(slot, image.ext));
      fs.writeFileSync(target, Buffer.from(image.bytes, 'base64'));
      skinsWritten += 1;
    });

    return { logos: logosWritten, skins: skinsWritten };
  }

  const store: BackupStore = {
    exportAll(appVersion) {
      return {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        kind: 'full',
        app: appVersion,
        exportedAt: new Date().toISOString(),
        data: collect()
      };
    },

    existing() {
      return {
        teamIds: new Set((q.teamIds.all() as unknown as Row[]).map((r) => String(r.id))),
        tournamentIds: new Set(
          (q.tournamentIds.all() as unknown as Row[]).map((r) => String(r.id))
        )
      };
    },

    // กู้คืนทั้งก้อนในทรานแซกชันเดียว
    //
    // ถ้าล้มกลางทาง ต้องไม่เหลืออะไรค้าง การกู้ที่สำเร็จครึ่งเดียวคือสิ่งที่ต้องมานั่ง
    // แกะตอนงานกำลังจะเริ่ม ซึ่งแย่กว่าการกู้ไม่สำเร็จเลยแล้วรู้ตัวทันที
    //
    // ภาพเขียนหลังฐานผ่านแล้ว ไฟล์ภาพย้อนกลับไม่ได้เหมือนแถวในฐาน
    // เขียนทีหลังจึงแปลว่าถ้าฐานพัง จะยังไม่มีไฟล์ไหนถูกแตะเลย
    restore(file, mode) {
      const data = file.data;
      const report: RestoreReport = {
        teamsAdded: 0, teamsSkipped: 0,
        tournamentsAdded: 0, tournamentsSkipped: 0,
        matchesAdded: 0, gamesAdded: 0,
        logosWritten: 0, skinsWritten: 0,
        mode
      };

      const has = (stmt: typeof q.hasTeam, id: string) => Boolean(stmt.get(id));

      db.exec('BEGIN');
      try {
        if (mode === 'replace') q.wipe.forEach((sql) => db.exec(sql));

        data.teams.forEach((team) => {
          if (mode === 'merge' && has(q.hasTeam, team.id)) { report.teamsSkipped += 1; return; }
          q.insertTeam.run(
            team.id, team.name, team.tag, team.logoV, team.logoExt,
            team.createdAt, team.updatedAt
          );
          team.players.forEach((p) => {
            q.insertPlayer.run(team.id, p.slot, p.name, p.position, p.isCaptain ? 1 : 0);
          });
          report.teamsAdded += 1;
        });

        // ทีมที่มีอยู่ในเครื่องแล้ว ยังใช้เป็นปลายทางของ foreign key ได้
        const teamPresent = (id: string | null): string | null => (
          id && has(q.hasTeam, id) ? id : null
        );

        data.tournaments.forEach((t) => {
          if (mode === 'merge' && has(q.hasTournament, t.id)) {
            report.tournamentsSkipped += 1;
            return;
          }
          q.insertTournament.run(
            t.id, t.name, t.status, t.format, t.bestOf, t.note, t.createdAt, t.updatedAt
          );
          t.teams.forEach((entry) => {
            // ทีมที่หายไปจากไฟล์ (หรือถูกข้ามเพราะซ้ำ) ต้องไม่ทำให้ทั้งการกู้ล้ม
            if (!teamPresent(entry.teamId)) return;
            q.insertTournamentTeam.run(t.id, entry.teamId, entry.seed, entry.addedAt);
          });
          report.tournamentsAdded += 1;
        });

        data.matches.forEach((m) => {
          if (!has(q.hasTournament, m.tournamentId)) return;
          if (has(q.hasMatch, m.id)) return;
          q.insertMatch.run(
            m.id, m.tournamentId, m.bracket, m.round, m.slot,
            teamPresent(m.teamAId), teamPresent(m.teamBId), m.bestOf,
            m.status, m.scoreA, m.scoreB, m.winnerId, m.isBye ? 1 : 0,
            m.nextRound, m.nextSlot, m.nextSide, m.nextBracket,
            m.loserRound, m.loserSlot, m.loserSide, m.loserBracket, m.createdAt
          );
          report.matchesAdded += 1;
        });

        data.games.forEach((g) => {
          if (!has(q.hasMatch, g.matchId)) return;
          if (has(q.hasGame, g.id)) return;
          q.insertGame.run(
            g.id, g.matchId, g.gameNo, g.blueTeamId, g.redTeamId,
            g.blueName, g.redName, g.draftLocked ? 1 : 0, g.winner,
            g.startedAt, g.updatedAt
          );
          // ช่องซ้ำกันในไฟล์จะชน PRIMARY KEY ข้ามไปทีละช่อง ไม่ล้มทั้งการกู้
          g.slots.forEach((s) => {
            try {
              q.insertSlot.run(g.id, s.side, s.kind, s.idx, s.hero);
            } catch { /* ช่องซ้ำในไฟล์ อันแรกชนะ */ }
          });
          report.gamesAdded += 1;
        });

        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      const written = writeImages(data);
      report.logosWritten = written.logos;
      report.skinsWritten = written.skins;
      return report;
    }
  };

  return store;
}
