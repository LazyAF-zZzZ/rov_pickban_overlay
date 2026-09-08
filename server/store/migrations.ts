// สคีมาของฐานข้อมูล เก็บเป็นลำดับขั้น
//
// วิธีใช้: เพิ่มขั้นใหม่ต่อท้าย MIGRATIONS เท่านั้น
// ห้ามแก้ของเดิมที่ปล่อยไปแล้ว เพราะเครื่องผู้ใช้รันขั้นนั้นไปแล้ว
// แก้ของเดิม = เครื่องที่อัปเดตกับเครื่องที่ลงใหม่ได้สคีมาไม่เหมือนกัน
//
// ตัวเลขที่รันไปถึงแล้วเก็บใน PRAGMA user_version ของ SQLite เอง
// ไม่ต้องมีตารางจดเวอร์ชันแยก
//
// ตาราง matches / games จะมาในขั้นถัดไป (Phase 4-5) ตอนทำสายแข่งกับสถิติ
// ยังไม่สร้างตอนนี้ เพราะยังไม่มีอะไรเขียนลงไป

export const MIGRATIONS: readonly string[] = [
  // 1 - ทีมกลาง และทัวร์นาเมนต์
  `
  CREATE TABLE teams (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    tag         TEXT NOT NULL DEFAULT '',
    logo_v      INTEGER NOT NULL DEFAULT 0,
    logo_ext    TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  -- ผู้เล่นของทีม slot 0-4 ตรงกับ 5 ช่องในหน้า control
  CREATE TABLE team_players (
    team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    slot        INTEGER NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    role        TEXT NOT NULL DEFAULT '',
    is_captain  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (team_id, slot)
  );

  CREATE TABLE tournaments (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'active',
    format      TEXT NOT NULL DEFAULT 'single_elim',
    best_of     INTEGER NOT NULL DEFAULT 3,
    note        TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );

  -- ทีมที่ลงแข่งในทัวร์นาเมนต์นี้ (roster)
  -- เพดาน 128 ทีมคุมที่ระดับนี้ ไม่ใช่ที่ตาราง teams
  -- ทะเบียนทีมกลางเก็บได้ไม่จำกัด แต่ทัวร์นาเมนต์เดียวรับได้ 128
  CREATE TABLE tournament_teams (
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    seed          INTEGER NOT NULL DEFAULT 0,
    added_at      INTEGER NOT NULL,
    PRIMARY KEY (tournament_id, team_id)
  );

  CREATE INDEX idx_tournament_teams_tid ON tournament_teams(tournament_id);
  CREATE INDEX idx_tournaments_status ON tournaments(status);
  `,

  // 2 - ตารางแข่ง
  `
  CREATE TABLE matches (
    id            TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    -- 'main' สำหรับสายเดียว หรือชื่อกลุ่ม ('A','B',...) ตอนแบ่งสาย
    bracket       TEXT NOT NULL DEFAULT 'main',
    round         INTEGER NOT NULL,
    slot          INTEGER NOT NULL,

    -- ON DELETE SET NULL ไม่ใช่ CASCADE ตั้งใจ
    -- ลบทีมทิ้งกลางทัวร์นาเมนต์ ตารางแข่งต้องไม่หายตามไปด้วย
    -- ช่องนั้นกลายเป็นว่างแทน ประวัติที่เหลือยังอยู่ครบ
    team_a_id     TEXT REFERENCES teams(id) ON DELETE SET NULL,
    team_b_id     TEXT REFERENCES teams(id) ON DELETE SET NULL,

    best_of       INTEGER NOT NULL DEFAULT 3,
    status        TEXT NOT NULL DEFAULT 'pending',
    score_a       INTEGER NOT NULL DEFAULT 0,
    score_b       INTEGER NOT NULL DEFAULT 0,
    winner_id     TEXT,
    is_bye        INTEGER NOT NULL DEFAULT 0,

    -- ผู้ชนะไปคู่ไหนต่อ เก็บเป็นตำแหน่ง ไม่ใช่ id ของคู่ถัดไป
    -- สร้างสายใหม่แล้ว id เปลี่ยนหมด แต่ตำแหน่งยังเหมือนเดิม
    next_round    INTEGER,
    next_slot     INTEGER,
    next_side     INTEGER,

    created_at    INTEGER NOT NULL
  );

  CREATE INDEX idx_matches_tid ON matches(tournament_id);
  -- หนึ่งตำแหน่งมีได้คู่เดียว กันการสร้างสายซ้อนกันสองรอบ
  CREATE UNIQUE INDEX idx_matches_pos ON matches(tournament_id, bracket, round, slot);
  `,

  // 3 - เกมแต่ละเกมในซีรีส์ พร้อมดราฟต์ และตัวชี้แมตช์ที่กำลังออกอากาศ
  `
  CREATE TABLE games (
    id           TEXT PRIMARY KEY,
    match_id     TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    game_no      INTEGER NOT NULL,

    -- สำเนาแช่แข็งของทีม ณ ตอนที่เล่นเกมนี้ ไม่ใช่แค่ id
    -- ทะเบียนทีมแก้ได้ตลอด ถ้าเก็บแค่ id แล้วปีหน้าเปลี่ยนตัวผู้เล่น
    -- ประวัติเกมเก่าจะเปลี่ยนตาม และสถิติ pick/ban ที่อ้างอิงมันก็เพี้ยนด้วย
    blue_team_id TEXT,
    red_team_id  TEXT,
    blue_name    TEXT NOT NULL DEFAULT '',
    red_name     TEXT NOT NULL DEFAULT '',

    -- 1 = ดราฟต์ครบแล้ว นับเข้าสถิติได้
    -- สถิติต้องนับเฉพาะเกมที่ล็อกแล้ว ไม่งั้นตอนดราฟต์ค้างกลางคัน
    -- อัตราการเลือกของฮีโร่ทุกตัวจะร่วงพร้อมกันเพราะตัวหารโตขึ้นก่อน
    draft_locked INTEGER NOT NULL DEFAULT 0,
    winner       TEXT,
    started_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX idx_games_match_no ON games(match_id, game_no);

  -- ดราฟต์เก็บเป็นแถวละช่อง ไม่ใช่ JSON ก้อนเดียว
  -- สถิติจะได้เป็น GROUP BY ธรรมดา ไม่ต้องอ่านทุกเกมมาแกะในหน่วยความจำ
  CREATE TABLE game_slots (
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    side    TEXT NOT NULL,          -- 'blue' | 'red'
    kind    TEXT NOT NULL,          -- 'pick' | 'ban'
    idx     INTEGER NOT NULL,
    -- ชื่อฮีโร่เก็บเป็นข้อความดิบ ห้ามเอาไปกรองผ่าน sanitizeHero ซ้ำภายหลัง
    -- ชื่อฮีโร่ผูกกับชื่อไฟล์ภาพ วันหลังเปลี่ยนชื่อไฟล์ ประวัติจะกลายเป็น null หมด
    hero    TEXT NOT NULL,
    PRIMARY KEY (game_id, side, kind, idx)
  );

  CREATE INDEX idx_game_slots_hero ON game_slots(hero);

  -- แมตช์ที่กำลังออกอากาศ มีได้ทีละหนึ่งเท่านั้น (id = 1 เสมอ)
  -- ไม่เก็บใน state.json เพราะ sanitizeState ตัดคีย์ที่ไม่รู้จักทิ้ง
  CREATE TABLE live_match (
    id       INTEGER PRIMARY KEY CHECK (id = 1),
    match_id TEXT REFERENCES matches(id) ON DELETE SET NULL,
    game_id  TEXT REFERENCES games(id) ON DELETE SET NULL,
    since    INTEGER NOT NULL
  );
  `,

  // 4 - เส้นทางของผู้แพ้ สำหรับแบบแพ้สองครั้งคัดออก
  //
  // ขั้นที่ 2 ปล่อยไปแล้ว แก้ของเดิมไม่ได้ จึงต้องเพิ่มคอลัมน์ด้วย ALTER TABLE
  // เครื่องที่อัปเดตกับเครื่องที่ลงใหม่จะได้สคีมาเหมือนกัน
  //
  // next_bracket จำเป็นเพราะผู้ชนะข้ามสายได้แล้ว
  // (แชมป์สายชนะและแชมป์สายแพ้ไปเจอกันที่สาย 'grand')
  // ของเดิมเดาว่าปลายทางอยู่สายเดียวกับต้นทางเสมอ ซึ่งใช้ไม่ได้อีกต่อไป
  `
  ALTER TABLE matches ADD COLUMN next_bracket  TEXT;
  ALTER TABLE matches ADD COLUMN loser_bracket TEXT;
  ALTER TABLE matches ADD COLUMN loser_round   INTEGER;
  ALTER TABLE matches ADD COLUMN loser_slot    INTEGER;
  ALTER TABLE matches ADD COLUMN loser_side    INTEGER;

  -- สายที่วาดไว้ก่อนหน้านี้เป็นแบบแพ้ครั้งเดียวคัดออกทั้งหมด
  -- ผู้ชนะอยู่สายเดิมเสมอ เติมค่าย้อนหลังให้ตรงกับพฤติกรรมเดิม
  UPDATE matches SET next_bracket = bracket WHERE next_round IS NOT NULL;
  `,

  // 5 - ตำแหน่งของผู้เล่น (เลน) แทนช่อง role ที่เป็นข้อความอิสระ
  //
  // เดิมคอลัมน์นี้ชื่อ role และรับข้อความอะไรก็ได้ ซึ่งเป็นแค่ช่องให้กรอกเล่นๆ
  // ไม่มีใครเอาไปใช้ต่อเลยสักที่ พอกราฟิกออกอากาศต้องเลือกไอคอนตามตำแหน่ง
  // ค่าอิสระใช้ไม่ได้แล้ว มันต้องเป็นชุดปิดห้าค่า (ดู domain/position.ts)
  //
  // เปลี่ยนชื่อคอลัมน์แทนการเพิ่มใหม่ เพราะเป็นความหมายเดียวกัน
  // ไม่งั้นจะเหลือคอลัมน์ role ตายๆ ไว้ให้คนรุ่นหลังเดาว่าอันไหนของจริง
  // RENAME COLUMN เก็บข้อมูลเดิมไว้ครบ ส่วนค่าที่ไม่ตรงกับห้าตำแหน่ง
  // จะถูกปัดเป็นค่าว่างตอนอ่าน (sanitizePosition) ไม่ได้ถูกลบทิ้งจากฐาน
  `
  ALTER TABLE team_players RENAME COLUMN role TO position;
  `
];
