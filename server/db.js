import Database from 'better-sqlite3';

const dbPath = process.env.DB_PATH ?? 'C:/Users/Usuario/base_futbol.db';
const db = new Database(dbPath);

db.pragma('busy_timeout = 10000');
db.pragma('foreign_keys = ON');

try {
  db.pragma('journal_mode = WAL');
} catch {
  // If another process is holding the database, keep going with the current mode.
}

function tableExists(name) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

function getCreateTableSql(name) {
  return db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
    ?.sql;
}

function ensureColumn(tableName, columnName, definition) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some((column) => column.name === columnName);

  if (!hasColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

ensureColumn('matches', 'home_score', 'INTEGER');
ensureColumn('matches', 'away_score', 'INTEGER');
ensureColumn('matches', 'status_detail', 'TEXT');
ensureColumn('matches', 'match_week', 'INTEGER');
ensureColumn('matches', 'season_slug', 'TEXT');

db.exec(`
  CREATE TABLE IF NOT EXISTS match_team_stats (
    id INTEGER PRIMARY KEY,
    match_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    stat_key TEXT NOT NULL,
    stat_value TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_url TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (match_id) REFERENCES matches(id),
    FOREIGN KEY (team_id) REFERENCES teams(id)
  );

  CREATE INDEX IF NOT EXISTS idx_match_team_stats_match
    ON match_team_stats (match_id, team_id);

  CREATE TABLE IF NOT EXISTS standings_snapshots (
    id INTEGER PRIMARY KEY,
    source_name TEXT NOT NULL,
    competition_slug TEXT NOT NULL,
    competition_name TEXT NOT NULL,
    season TEXT,
    source_url TEXT,
    fetched_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS standings_entries (
    id INTEGER PRIMARY KEY,
    snapshot_id INTEGER NOT NULL,
    team_slug TEXT NOT NULL,
    team_name TEXT NOT NULL,
    team_short_name TEXT,
    position INTEGER NOT NULL,
    points INTEGER NOT NULL,
    played INTEGER NOT NULL,
    won INTEGER NOT NULL,
    drawn INTEGER NOT NULL,
    lost INTEGER NOT NULL,
    goals_for INTEGER NOT NULL,
    goals_against INTEGER NOT NULL,
    goal_difference TEXT NOT NULL,
    qualification TEXT,
    logo_class TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (snapshot_id) REFERENCES standings_snapshots(id)
  );

  CREATE INDEX IF NOT EXISTS idx_standings_snapshots_competition
    ON standings_snapshots (competition_slug, fetched_at DESC);

  CREATE INDEX IF NOT EXISTS idx_standings_entries_snapshot
    ON standings_entries (snapshot_id, position ASC);

  CREATE INDEX IF NOT EXISTS idx_standings_entries_team_slug
    ON standings_entries (team_slug);

  CREATE TABLE IF NOT EXISTS team_squad_profiles (
    id INTEGER PRIMARY KEY,
    team_id INTEGER NOT NULL,
    competition_slug TEXT NOT NULL,
    player_name TEXT NOT NULL,
    shirt_number INTEGER,
    position_label TEXT,
    photo_url TEXT,
    source_name TEXT NOT NULL,
    source_url TEXT,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id)
  );

  CREATE INDEX IF NOT EXISTS idx_team_squad_profiles_team
    ON team_squad_profiles (team_id, competition_slug, sort_order ASC);
`);

function ensureMatchEventsTable() {
  const createSql = getCreateTableSql('match_events');

  if (!tableExists('match_events')) {
    db.exec(`
      CREATE TABLE match_events (
        id INTEGER PRIMARY KEY,
        match_id INTEGER NOT NULL,
        team_id INTEGER,
        player_id INTEGER,
        event_type TEXT NOT NULL,
        minute INTEGER,
        extra_minute INTEGER,
        description TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (match_id) REFERENCES matches(id),
        FOREIGN KEY (team_id) REFERENCES teams(id),
        FOREIGN KEY (player_id) REFERENCES players(id)
      );

      CREATE INDEX IF NOT EXISTS idx_match_events_match
        ON match_events (match_id, minute ASC, extra_minute ASC, id ASC);
    `);
    return;
  }

  if (!createSql?.includes('matches_old')) {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_match_events_match
        ON match_events (match_id, minute ASC, extra_minute ASC, id ASC);
    `);
    return;
  }

  const rebuild = db.transaction(() => {
    db.pragma('foreign_keys = OFF');

    db.exec(`
      ALTER TABLE match_events RENAME TO match_events_old;

      CREATE TABLE match_events (
        id INTEGER PRIMARY KEY,
        match_id INTEGER NOT NULL,
        team_id INTEGER,
        player_id INTEGER,
        event_type TEXT NOT NULL,
        minute INTEGER,
        extra_minute INTEGER,
        description TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (match_id) REFERENCES matches(id),
        FOREIGN KEY (team_id) REFERENCES teams(id),
        FOREIGN KEY (player_id) REFERENCES players(id)
      );

      INSERT INTO match_events (
        id,
        match_id,
        team_id,
        player_id,
        event_type,
        minute,
        extra_minute,
        description,
        created_at
      )
      SELECT
        id,
        match_id,
        team_id,
        player_id,
        event_type,
        minute,
        extra_minute,
        description,
        created_at
      FROM match_events_old;

      DROP TABLE match_events_old;

      CREATE INDEX IF NOT EXISTS idx_match_events_match
        ON match_events (match_id, minute ASC, extra_minute ASC, id ASC);
    `);

    db.pragma('foreign_keys = ON');
  });

  rebuild();
}

ensureMatchEventsTable();

export default db;
