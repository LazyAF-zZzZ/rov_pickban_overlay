// สำรองข้อมูลแล้วกู้คืน ต้องได้ของเดิมกลับมาครบ
//
// เทสต์ที่สำคัญที่สุดคือการวนกลับ: เก็บ -> ล้างทิ้ง -> กู้ -> เทียบกับของเดิม
// ฟีเจอร์สำรองข้อมูลที่กู้ได้ไม่ครบ แย่กว่าไม่มีเลย เพราะคนจะเชื่อมันแล้วไม่สำรองทางอื่น

import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rov-backup-'));
process.env.ROV_USER_DATA_DIR = path.join(TMP, 'data');
process.env.ROV_USER_MEDIA_DIR = path.join(TMP, 'media');
process.env.CONTROL_TOKEN = '';

const { LOGO_DIR, teamLogoFilePath } = require('../server/domain/media') as
  typeof import('../server/domain/media');

import { openDatabase } from '../server/store/db';
import { createTeamStore } from '../server/store/teams';
import { createTournamentStore } from '../server/store/tournaments';
import { createMatchStore } from '../server/store/matches';
import { createGameStore } from '../server/store/games';
import { createBackupStore } from '../server/store/backup';
import { readBackup } from '../server/domain/backup';
import { defaultState } from '../server/domain/match';
import { heroesData } from '../server/domain/heroes';
import { must } from './helpers';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 7)
]);

test.after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ระบบเก็บเอง */ }
});

function build() {
  const db = openDatabase(':memory:');
  const teams = createTeamStore(db);
  const tournaments = createTournamentStore(db, teams);
  const games = createGameStore(db);
  const matches = createMatchStore(db, tournaments, games);
  const backup = createBackupStore(db);
  return { db, teams, tournaments, games, matches, backup };
}

// สร้างงานหนึ่งชุดที่มีของครบทุกชนิดที่ต้องรอด
function populate(s: ReturnType<typeof build>) {
  const tournament = must(s.tournaments.create({
    name: 'Season Cup', format: 'single_elim', bestOf: 3, note: 'the big one'
  }).tournament);

  const ids: string[] = [];
  ['FW', 'EA', 'BAC', 'TAL'].forEach((name, i) => {
    const team = must(s.teams.create({
      name,
      tag: name.slice(0, 3),
      players: [
        { name: `${name}-P1`, position: 'jungle', isCaptain: true },
        { name: `${name}-P2`, position: 'midlane' }
      ]
    }).team);
    ids.push(team.id);
    s.tournaments.addTeam(tournament.id, team.id, i);
  });

  must(s.matches.generate(tournament.id).matches);
  const first = must(s.matches.list(tournament.id).filter((m) => m.round === 1)[0]);
  must(s.matches.setResult(first.id, 2, 1).match);

  // ดราฟต์จริงหนึ่งเกม
  const game = s.games.ensure(first.id, 1, {
    blueTeamId: first.teamAId, redTeamId: first.teamBId, blueName: 'FW', redName: 'EA'
  });
  s.games.captureDraft(game.id, {
    ...defaultState,
    teamBlue: {
      ...defaultState.teamBlue,
      name: 'FW',
      picks: heroesData.heroes.slice(0, 5),
      bans: heroesData.heroes.slice(20, 24)
    },
    teamRed: {
      ...defaultState.teamRed,
      name: 'EA',
      picks: heroesData.heroes.slice(5, 10),
      bans: heroesData.heroes.slice(24, 28)
    }
  });

  // โลโก้จริงหนึ่งไฟล์
  fs.mkdirSync(LOGO_DIR, { recursive: true });
  const withLogo = must(ids[0]);
  fs.writeFileSync(teamLogoFilePath(withLogo, 'png'), PNG);
  // setLogo ไม่ใช่ update: update เป็นการเขียนทับทั้งทีมแบบ PUT
  // ส่งไปแค่โลโก้ รายชื่อผู้เล่นจะถูกล้างไปด้วย (ตั้งใจ มีผู้เรียกที่เดียวคือฟอร์มทั้งใบ)
  s.teams.setLogo(withLogo, { v: 3, ext: 'png' });

  return { tournament, ids, matchId: first.id, gameId: game.id, logoTeam: withLogo };
}

test('a backup carries every kind of record the app keeps', () => {
  const s = build();
  const made = populate(s);

  const file = s.backup.exportAll('2.0.0-beta');

  assert.strictEqual(file.kind, 'full');
  assert.strictEqual(file.data.teams.length, 4);
  assert.strictEqual(file.data.tournaments.length, 1);
  assert.ok(file.data.matches.length >= 3, 'the bracket is in there');
  assert.ok(file.data.games.length >= 1);

  const team = must(file.data.teams.find((t) => t.id === made.logoTeam));
  assert.strictEqual(team.players.length, 5, 'roster slots are padded to five, as stored');
  assert.strictEqual(must(team.players[0]).name, 'FW-P1');
  assert.strictEqual(must(team.players[0]).position, 'jungle');
  assert.strictEqual(must(team.players[0]).isCaptain, true);

  const tournament = must(file.data.tournaments[0]);
  assert.strictEqual(tournament.teams.length, 4, 'seeding survives');

  const drafted = must(file.data.games.find((g) => g.slots.length > 0));
  assert.strictEqual(drafted.slots.length, 18, 'a full draft is 18 slots');
  assert.ok(drafted.draftLocked, 'and it is marked locked');

  // รูปเดินทางไปกับไฟล์ ไม่ใช่ชี้ไปที่ path บนเครื่องเดิม
  const logo = must(file.data.logos[made.logoTeam]);
  assert.strictEqual(logo.ext, 'png');
  assert.strictEqual(Buffer.from(logo.bytes, 'base64').toString('hex'), PNG.toString('hex'));

  s.db.close();
});

// วนกลับให้ครบวง: นี่คือคำถามเดียวที่ผู้ใช้สนใจจริงๆ
test('a backup restores onto an empty machine and nothing is missing', () => {
  const source = build();
  const made = populate(source);
  const file = source.backup.exportAll('2.0.0-beta');
  const before = {
    teams: source.teams.list().map((t) => `${t.id}:${t.name}:${t.tag}`).sort(),
    matches: source.matches.list(made.tournament.id)
      .map((m) => `${m.bracket}/${m.round}/${m.slot}:${m.scoreA}-${m.scoreB}:${m.status}`).sort(),
    slots: source.games.forMatch(made.matchId)
      .flatMap((g) => g.slots.map((sl) => `${g.gameNo}:${sl.side}:${sl.kind}:${sl.idx}:${sl.hero}`)).sort()
  };
  source.db.close();

  // เครื่องใหม่ ว่างเปล่า และผ่านตัวอ่านไฟล์เหมือนที่ผู้ใช้นำเข้าจริง
  const target = build();
  const parsed = must(readBackup(JSON.parse(JSON.stringify(file))).file);
  const report = target.backup.restore(parsed, 'merge');

  assert.strictEqual(report.teamsAdded, 4);
  assert.strictEqual(report.tournamentsAdded, 1);
  assert.ok(report.matchesAdded >= 3);
  assert.ok(report.gamesAdded >= 1);
  assert.strictEqual(report.logosWritten, 1);

  const after = {
    teams: target.teams.list().map((t) => `${t.id}:${t.name}:${t.tag}`).sort(),
    matches: target.matches.list(made.tournament.id)
      .map((m) => `${m.bracket}/${m.round}/${m.slot}:${m.scoreA}-${m.scoreB}:${m.status}`).sort(),
    slots: target.games.forMatch(made.matchId)
      .flatMap((g) => g.slots.map((sl) => `${g.gameNo}:${sl.side}:${sl.kind}:${sl.idx}:${sl.hero}`)).sort()
  };

  assert.deepStrictEqual(after.teams, before.teams, 'every team came back, ids and all');
  assert.deepStrictEqual(after.matches, before.matches, 'the bracket and its results came back');
  assert.deepStrictEqual(after.slots, before.slots, 'and every recorded draft slot');

  // ไฟล์โลโก้ถูกเขียนลงที่ที่หน้าเว็บจะไปหาจริง
  const written = fs.readFileSync(teamLogoFilePath(made.logoTeam, 'png'));
  assert.strictEqual(written.toString('hex'), PNG.toString('hex'));

  target.db.close();
});

// นำเข้าไฟล์เดิมซ้ำ ต้องไม่ได้ทุกอย่างสองชุด
test('restoring the same backup twice does not duplicate anything', () => {
  const s = build();
  populate(s);
  const file = must(readBackup(JSON.parse(JSON.stringify(s.backup.exportAll('x')))).file);

  const fresh = build();
  fresh.backup.restore(file, 'merge');
  const second = fresh.backup.restore(file, 'merge');

  assert.strictEqual(second.teamsAdded, 0);
  assert.strictEqual(second.teamsSkipped, 4, 'the second pass recognised them all');
  assert.strictEqual(second.tournamentsAdded, 0);
  assert.strictEqual(fresh.teams.list().length, 4, 'still four teams, not eight');

  s.db.close();
  fresh.db.close();
});

// กู้แบบรวม ต้องไม่ทับงานที่ทำอยู่
test('merge keeps what is already here', () => {
  const s = build();
  populate(s);
  const file = must(readBackup(JSON.parse(JSON.stringify(s.backup.exportAll('x')))).file);
  s.db.close();

  const target = build();
  const mine = must(target.teams.create({ name: 'MY OWN TEAM' }).team);
  target.backup.restore(file, 'merge');

  assert.ok(target.teams.get(mine.id), 'my team is still here');
  assert.strictEqual(target.teams.list().length, 5, 'four imported plus mine');
  target.db.close();
});

// กู้แบบแทนที่ คือทางของ "เครื่องเก่าพัง" ต้องได้ของในไฟล์เป๊ะๆ ไม่มีของเก่าปน
test('replace leaves exactly what the file held', () => {
  const s = build();
  populate(s);
  const file = must(readBackup(JSON.parse(JSON.stringify(s.backup.exportAll('x')))).file);
  s.db.close();

  const target = build();
  must(target.teams.create({ name: 'STALE TEAM' }).team);
  must(target.tournaments.create({ name: 'Stale Cup', format: 'single_elim', bestOf: 1 }).tournament);

  const report = target.backup.restore(file, 'replace');

  assert.strictEqual(report.mode, 'replace');
  assert.strictEqual(target.teams.list().length, 4, 'the stale team is gone');
  assert.ok(!target.teams.list().some((t) => t.name === 'STALE TEAM'));
  assert.strictEqual(target.tournaments.list().length, 1);
  assert.strictEqual(must(target.tournaments.list()[0]).name, 'Season Cup');
  target.db.close();
});

// ถ้าเขียนฐานล้มกลางทาง ต้องไม่เหลืออะไรค้าง
//
// การกู้ที่สำเร็จครึ่งเดียวคือสิ่งที่ต้องมานั่งแกะตอนงานกำลังจะเริ่ม
// ซึ่งแย่กว่าการกู้ไม่สำเร็จเลยแล้วรู้ตัวทันที
test('a restore that fails partway leaves the database untouched', () => {
  const s = build();
  populate(s);
  const file = must(readBackup(JSON.parse(JSON.stringify(s.backup.exportAll('x')))).file);
  s.db.close();

  const target = build();
  const mine = must(target.teams.create({ name: 'KEEP ME' }).team);

  // ทีมสองใบที่ id เดียวกันในไฟล์เดียว ใบที่สองจะชน PRIMARY KEY
  const broken = {
    ...file,
    data: { ...file.data, teams: [...file.data.teams, must(file.data.teams[0])] }
  };

  assert.throws(() => target.backup.restore(broken, 'replace'), /UNIQUE|constraint/i);

  // replace ล้างของเก่าไปแล้วก่อนจะล้ม ทรานแซกชันต้องย้อนกลับมาให้ครบ
  assert.ok(target.teams.get(mine.id), 'the rollback put my data back');
  assert.strictEqual(target.teams.list().length, 1);
  target.db.close();
});
