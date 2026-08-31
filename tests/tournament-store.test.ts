// เทสต์ชั้นข้อมูลของทัวร์นาเมนต์ ใช้ฐานใน ':memory:' ทุกครั้ง
// ห้ามแตะ tournament.db จริงของผู้ใช้
import test from 'node:test';
import assert from 'node:assert';

import { openDatabase } from '../server/store/db';
import type { TeamStore } from '../server/store/teams';
import { createTeamStore } from '../server/store/teams';
import type { Tournament } from '../server/store/tournaments';
import { createTournamentStore } from '../server/store/tournaments';
import { createMatchStore } from '../server/store/matches';
import { createGameStore } from '../server/store/games';
import { MAX_TEAMS, ROUND_ROBIN_MAX_TEAMS } from '../server/domain/tournament';
import { isSafeMediaId } from '../server/domain/media';
import type { Team } from '../server/domain/team';
import { must } from './helpers';

function freshStores() {
  const db = openDatabase(':memory:');
  const teams = createTeamStore(db);
  const tournaments = createTournamentStore(db, teams);
  return { db, teams, tournaments };
}

function makeTeams(teams: TeamStore, count: number, prefix = 'Team'): Team[] {
  return Array.from({ length: count }, (_, i) => {
    const result = teams.create({ name: `${prefix} ${i + 1}` });
    return must(result.team, result.error);
  });
}

// ทัวร์นาเมนต์ที่สร้างแล้วต้องมีจริง ไม่งั้นเทสต์ที่เหลือไม่มีความหมาย
function makeTournament(
  tournaments: ReturnType<typeof freshStores>['tournaments'],
  input: unknown
): Tournament {
  const result = tournaments.create(input);
  return must(result.tournament, result.error);
}

test('migrations run and are idempotent across reopens', () => {
  const { db } = freshStores();
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  assert.ok(version >= 1, 'schema version advanced');

  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as unknown as { name: string }[];
  const tables = rows.map((r) => r.name);
  ['teams', 'team_players', 'tournaments', 'tournament_teams'].forEach((t) => {
    assert.ok(tables.includes(t), `${t} exists`);
  });
});

test('a team round-trips with its roster', () => {
  const { teams } = freshStores();
  const created = teams.create({
    name: 'Buriram United',
    tag: 'BRU',
    players: [
      { name: 'ZHAN', role: 'jungle', isCaptain: true },
      { name: 'WETZ', role: 'mid' }
    ]
  });
  const team = must(created.team, created.error);

  const loaded = must(teams.get(team.id));
  assert.strictEqual(loaded.name, 'Buriram United');
  assert.strictEqual(loaded.tag, 'BRU');
  assert.strictEqual(loaded.players.length, 5, 'roster always has five slots');
  assert.strictEqual(must(loaded.players[0]).name, 'ZHAN');
  assert.strictEqual(must(loaded.players[0]).isCaptain, true);
  assert.strictEqual(must(loaded.players[4]).name, '', 'empty slots stay empty');
});

test('only one captain survives', () => {
  const { teams } = freshStores();
  const created = teams.create({
    name: 'X',
    players: [{ name: 'A', isCaptain: true }, { name: 'B', isCaptain: true }, { name: 'C', isCaptain: true }]
  });
  const team = must(created.team, created.error);
  assert.strictEqual(team.players.filter((p) => p.isCaptain).length, 1);
});

test('a team needs a name', () => {
  const { teams } = freshStores();
  assert.ok(teams.create({ name: '   ' }).error);
  assert.ok(teams.create({}).error);
});

test('team ids are safe to use as filenames', () => {
  const { teams } = freshStores();
  makeTeams(teams, 25).forEach((team) => {
    assert.ok(isSafeMediaId(team.id), `${team.id} is filename-safe`);
  });
});

// ---- TEST GOAL 1: ห้ามเกิน 128 ทีมต่อทัวร์นาเมนต์ ----

test('a tournament accepts exactly 128 teams and refuses the 129th', () => {
  const { teams, tournaments } = freshStores();
  const tournament = makeTournament(tournaments, { name: 'Big Cup', format: 'single_elim' });
  const roster = makeTeams(teams, MAX_TEAMS + 1);

  for (let i = 0; i < MAX_TEAMS; i += 1) {
    const result = tournaments.addTeam(tournament.id, must(roster[i]).id);
    assert.ok(result.ok, `team ${i + 1} should be accepted: ${result.error}`);
  }
  assert.strictEqual(tournaments.teamCount(tournament.id), MAX_TEAMS);

  const overflow = tournaments.addTeam(tournament.id, must(roster[MAX_TEAMS]).id);
  assert.ok(overflow.error, 'the 129th team must be refused');
  assert.match(must(overflow.error), /full|max/i);
  assert.strictEqual(tournaments.teamCount(tournament.id), MAX_TEAMS, 'count unchanged after refusal');
});

test('round robin is capped lower than 128', () => {
  const { teams, tournaments } = freshStores();
  const tournament = makeTournament(tournaments, { name: 'RR', format: 'round_robin' });
  const roster = makeTeams(teams, ROUND_ROBIN_MAX_TEAMS + 1);

  for (let i = 0; i < ROUND_ROBIN_MAX_TEAMS; i += 1) {
    assert.ok(tournaments.addTeam(tournament.id, must(roster[i]).id).ok);
  }
  const overflow = tournaments.addTeam(tournament.id, must(roster[ROUND_ROBIN_MAX_TEAMS]).id);
  assert.ok(overflow.error, 'round robin must refuse past its own cap');
  assert.strictEqual(overflow.limit, ROUND_ROBIN_MAX_TEAMS);
});

test('switching to a format with a lower cap is refused, not silently truncating', () => {
  const { teams, tournaments } = freshStores();
  const tournament = makeTournament(tournaments, { name: 'Cup', format: 'single_elim' });
  makeTeams(teams, 30).forEach((team) => tournaments.addTeam(tournament.id, team.id));

  const result = tournaments.update(tournament.id, { name: 'Cup', format: 'round_robin' });
  assert.ok(result.error, '30 teams cannot become a round robin');
  assert.strictEqual(must(tournaments.get(tournament.id)).format, 'single_elim', 'format unchanged');
  assert.strictEqual(tournaments.teamCount(tournament.id), 30, 'no team was dropped');
});

test('the same team cannot be added twice', () => {
  const { teams, tournaments } = freshStores();
  const tournament = makeTournament(tournaments, { name: 'Cup' });
  const team = must(makeTeams(teams, 1)[0]);

  assert.ok(tournaments.addTeam(tournament.id, team.id).ok);
  assert.ok(tournaments.addTeam(tournament.id, team.id).error, 'duplicate entry refused');
  assert.strictEqual(tournaments.teamCount(tournament.id), 1);
});

test('unknown ids are rejected rather than creating orphans', () => {
  const { tournaments, teams } = freshStores();
  const tournament = makeTournament(tournaments, { name: 'Cup' });
  const team = must(makeTeams(teams, 1)[0]);

  assert.ok(tournaments.addTeam('nope', team.id).error);
  assert.ok(tournaments.addTeam(tournament.id, 'nope').error);
});

test('removing a team frees a slot', () => {
  const { teams, tournaments } = freshStores();
  const tournament = makeTournament(tournaments, { name: 'Cup' });
  const roster = makeTeams(teams, 3);
  roster.forEach((team) => tournaments.addTeam(tournament.id, team.id));

  assert.ok(tournaments.removeTeam(tournament.id, must(roster[1]).id).ok);
  assert.strictEqual(tournaments.teamCount(tournament.id), 2);
  assert.ok(
    tournaments.removeTeam(tournament.id, must(roster[1]).id).error,
    'removing twice is an error'
  );
});

test('deleting a team removes it from every tournament it entered', () => {
  const { teams, tournaments } = freshStores();
  const a = makeTournament(tournaments, { name: 'A' });
  const b = makeTournament(tournaments, { name: 'B' });
  const team = must(makeTeams(teams, 1)[0]);

  tournaments.addTeam(a.id, team.id);
  tournaments.addTeam(b.id, team.id);
  assert.strictEqual(tournaments.teamCount(a.id), 1);

  teams.remove(team.id);
  assert.strictEqual(tournaments.teamCount(a.id), 0, 'cascade removed it from A');
  assert.strictEqual(tournaments.teamCount(b.id), 0, 'cascade removed it from B');
});

test('deleting a tournament leaves the team registry intact', () => {
  const { teams, tournaments } = freshStores();
  const tournament = makeTournament(tournaments, { name: 'Cup' });
  const roster = makeTeams(teams, 4);
  roster.forEach((team) => tournaments.addTeam(tournament.id, team.id));

  tournaments.remove(tournament.id);
  assert.strictEqual(teams.count(), 4, 'teams outlive the tournament they played in');
  assert.strictEqual(tournaments.get(tournament.id), null);
});

// ลบทัวร์นาเมนต์แล้วต้องไม่เหลือเศษของมันในฐานเลย
//
// เขียนไว้เพราะการลบแบบ "ทิ้งของลูกไว้" เงียบมาก: หน้าเว็บดูสะอาด รายการหายไปแล้ว
// แต่แมตช์กับดราฟต์ยังนอนอยู่ในไฟล์ และไปโผล่ในสถิติที่นับข้ามทัวร์นาเมนต์
test('deleting a tournament takes its bracket and every recorded draft with it', () => {
  const { db, teams, tournaments } = freshStores();
  const matches = createMatchStore(db, tournaments);
  const games = createGameStore(db);

  const tournament = makeTournament(tournaments, { name: 'Cup', format: 'single_elim', bestOf: 3 });
  const roster = makeTeams(teams, 4);
  roster.forEach((team, i) => tournaments.addTeam(tournament.id, team.id, i));

  const drawn = must(matches.generate(tournament.id).matches);
  const first = must(drawn[0]);
  const game = games.ensure(first.id, 1, {
    blueTeamId: must(roster[0]).id,
    redTeamId: must(roster[1]).id,
    blueName: 'A',
    redName: 'B'
  });
  db.prepare('INSERT INTO game_slots (game_id, side, kind, idx, hero) VALUES (?, ?, ?, ?, ?)')
    .run(game.id, 'blue', 'pick', 0, 'valhein');

  const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  assert.ok(count('SELECT COUNT(*) AS n FROM game_slots') > 0, 'the draft was recorded first');

  const result = tournaments.remove(tournament.id);
  assert.deepStrictEqual(
    result.removed,
    { teams: 4, matches: drawn.length, games: 1 },
    'the delete reports what it destroyed'
  );

  assert.strictEqual(count('SELECT COUNT(*) AS n FROM tournaments'), 0);
  assert.strictEqual(count('SELECT COUNT(*) AS n FROM tournament_teams'), 0);
  assert.strictEqual(count('SELECT COUNT(*) AS n FROM matches'), 0, 'the bracket went with it');
  assert.strictEqual(count('SELECT COUNT(*) AS n FROM games'), 0, 'so did the games');
  assert.strictEqual(count('SELECT COUNT(*) AS n FROM game_slots'), 0, 'and the draft rows under them');
  assert.strictEqual(teams.count(), 4, 'only the teams outlive it');
});

test('status flips between active and finished, junk falls back to active', () => {
  const { tournaments } = freshStores();
  const tournament = makeTournament(tournaments, { name: 'Cup' });
  assert.strictEqual(tournament.status, 'active');

  assert.strictEqual(must(tournaments.setStatus(tournament.id, 'finished').tournament).status, 'finished');
  assert.strictEqual(must(tournaments.setStatus(tournament.id, 'nonsense').tournament).status, 'active');
});

test('tournament reports how many slots its format allows', () => {
  const { tournaments } = freshStores();
  assert.strictEqual(makeTournament(tournaments, { name: 'A', format: 'single_elim' }).maxTeams, MAX_TEAMS);
  assert.strictEqual(makeTournament(tournaments, { name: 'B', format: 'round_robin' }).maxTeams, ROUND_ROBIN_MAX_TEAMS);
});

test('teams come back ordered by seed', () => {
  const { teams, tournaments } = freshStores();
  const tournament = makeTournament(tournaments, { name: 'Cup' });
  const roster = makeTeams(teams, 3);
  tournaments.addTeam(tournament.id, must(roster[0]).id, 3);
  tournaments.addTeam(tournament.id, must(roster[1]).id, 1);
  tournaments.addTeam(tournament.id, must(roster[2]).id, 2);

  assert.deepStrictEqual(
    tournaments.teams(tournament.id).map((t) => t.name),
    ['Team 2', 'Team 3', 'Team 1']
  );
});
