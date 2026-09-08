// ทะเบียนทีมกลาง อ่าน/เขียนฐานข้อมูล
//
// เขียนเป็น factory ที่รับ db เข้ามา ไม่ได้ไปเรียก getDatabase() เอง
// เทสต์จะได้ส่งฐานแบบ ':memory:' เข้ามาแทน ไม่ไปแตะไฟล์จริงของผู้ใช้

import type { DatabaseSync } from 'node:sqlite';
import { newId } from '../domain/ids';
import type { Team, TeamPlayer } from '../domain/team';
import { sanitizeTeamInput, sanitizeRoster, ROSTER_SIZE } from '../domain/team';
import type { Logo, ImageExt } from '../domain/media';
import { sanitizeLogo } from '../domain/media';

export type TeamResult = { team: Team; error?: undefined } | { error: string; team?: undefined };
export type RemoveResult = { ok: true; error?: undefined } | { error: string; ok?: undefined };

interface TeamRow {
  id: string;
  name: string;
  tag: string;
  logo_v: number;
  logo_ext: string;
  created_at: number;
  updated_at: number;
}

interface PlayerRow {
  team_id: string;
  slot: number;
  name: string;
  position: string;
  is_captain: number;
}

// node:sqlite ไม่รับ boolean เป็นพารามิเตอร์ ต้องแปลงเป็น 0/1 เอง
const bit = (value: boolean): number => (value ? 1 : 0);

function rowToTeam(row: TeamRow, players: TeamPlayer[]): Team {
  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    logo: { v: row.logo_v, ext: row.logo_ext as ImageExt | '' },
    players,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export interface TeamStore {
  count(): number;
  get(id: string): Team | null;
  list(): Team[];
  create(input: unknown): TeamResult;
  update(id: string, input: unknown): TeamResult;
  setLogo(id: string, logo: unknown): TeamResult;
  remove(id: string): RemoveResult;
}

export function createTeamStore(db: DatabaseSync): TeamStore {
  const q = {
    insert: db.prepare(
      'INSERT INTO teams (id, name, tag, logo_v, logo_ext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ),
    update: db.prepare(
      'UPDATE teams SET name = ?, tag = ?, updated_at = ? WHERE id = ?'
    ),
    updateLogo: db.prepare('UPDATE teams SET logo_v = ?, logo_ext = ?, updated_at = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM teams WHERE id = ?'),
    byId: db.prepare('SELECT * FROM teams WHERE id = ?'),
    all: db.prepare('SELECT * FROM teams ORDER BY name COLLATE NOCASE'),
    insertPlayer: db.prepare(
      'INSERT INTO team_players (team_id, slot, name, position, is_captain) VALUES (?, ?, ?, ?, ?)'
    ),
    clearPlayers: db.prepare('DELETE FROM team_players WHERE team_id = ?'),
    playersFor: db.prepare('SELECT * FROM team_players WHERE team_id = ? ORDER BY slot'),
    countAll: db.prepare('SELECT COUNT(*) AS n FROM teams')
  };

  const findRow = (id: string): TeamRow | undefined => q.byId.get(id) as TeamRow | undefined;

  function readPlayers(teamId: string): TeamPlayer[] {
    const rows = q.playersFor.all(teamId) as unknown as PlayerRow[];
    // ฐานอาจมีไม่ครบ 5 แถวถ้าถูกแก้มาจากข้างนอก เติมให้ครบเสมอ
    return sanitizeRoster(
      Array.from({ length: ROSTER_SIZE }, (_, slot) => {
        const row = rows.find((r) => r.slot === slot);
        return row ? { name: row.name, position: row.position, isCaptain: row.is_captain === 1 } : {};
      })
    );
  }

  function writePlayers(teamId: string, players: TeamPlayer[]): void {
    q.clearPlayers.run(teamId);
    players.forEach((player) => {
      q.insertPlayer.run(teamId, player.slot, player.name, player.position, bit(player.isCaptain));
    });
  }

  const store: TeamStore = {
    count() {
      return (q.countAll.get() as { n: number }).n;
    },

    get(id) {
      const row = findRow(id);
      return row ? rowToTeam(row, readPlayers(id)) : null;
    },

    list() {
      return (q.all.all() as unknown as TeamRow[])
        .map((row) => rowToTeam(row, readPlayers(row.id)));
    },

    // คืน { team } หรือ { error }
    create(input) {
      const checked = sanitizeTeamInput(input);
      if (checked.error !== undefined) return { error: checked.error };

      const id = newId('team');
      const now = Date.now();
      const { name, tag, logo, players } = checked.team;

      db.exec('BEGIN');
      try {
        q.insert.run(id, name, tag, logo.v, logo.ext, now, now);
        writePlayers(id, players);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        return { error: `Could not create team: ${(error as Error).message}` };
      }

      return { team: store.get(id) as Team };
    },

    // แก้ได้เฉพาะชื่อ/แท็ก/ผู้เล่น โลโก้แก้ผ่าน setLogo เพราะผูกกับไฟล์
    update(id, input) {
      if (!findRow(id)) return { error: 'Team not found' };

      const checked = sanitizeTeamInput(input);
      if (checked.error !== undefined) return { error: checked.error };

      const { name, tag, players } = checked.team;
      db.exec('BEGIN');
      try {
        q.update.run(name, tag, Date.now(), id);
        writePlayers(id, players);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        return { error: `Could not update team: ${(error as Error).message}` };
      }

      return { team: store.get(id) as Team };
    },

    setLogo(id, logo) {
      if (!findRow(id)) return { error: 'Team not found' };
      const safe: Logo = sanitizeLogo(logo);
      q.updateLogo.run(safe.v, safe.ext, Date.now(), id);
      return { team: store.get(id) as Team };
    },

    // ลบทีมออกจากทะเบียน ทีมหลุดจากทุกทัวร์นาเมนต์ด้วย (ON DELETE CASCADE)
    remove(id) {
      if (!findRow(id)) return { error: 'Team not found' };
      q.remove.run(id);
      return { ok: true };
    }
  };

  return store;
}
