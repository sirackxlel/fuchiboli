import db from './db.js';

function tableExists(name) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name),
  );
}

function getCreateTableSql(name) {
  return db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name)?.sql;
}

const transaction = db.transaction(() => {
  db.pragma('foreign_keys = OFF');

  if (tableExists('matches')) {
    db.exec(`
      ALTER TABLE matches RENAME TO matches_old;

      CREATE TABLE matches (
        id INTEGER PRIMARY KEY,
        canonical_key TEXT NOT NULL UNIQUE,
        home_team_id INTEGER NOT NULL,
        away_team_id INTEGER NOT NULL,
        competition_id INTEGER,
        match_date_utc TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT,
        round_name TEXT,
        venue_name TEXT,
        venue_city TEXT,
        source_priority INTEGER DEFAULT 0,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (home_team_id) REFERENCES teams(id),
        FOREIGN KEY (away_team_id) REFERENCES teams(id),
        FOREIGN KEY (competition_id) REFERENCES competitions(id)
      );

      INSERT INTO matches (
        id,
        canonical_key,
        home_team_id,
        away_team_id,
        competition_id,
        match_date_utc,
        status,
        stage,
        round_name,
        venue_name,
        venue_city,
        source_priority,
        last_seen_at,
        created_at,
        updated_at
      )
      SELECT
        id,
        CAST(canonical_key AS TEXT),
        home_team_id,
        away_team_id,
        competition_id,
        match_date_utc,
        status,
        stage,
        round_name,
        venue_name,
        venue_city,
        source_priority,
        last_seen_at,
        created_at,
        updated_at
      FROM matches_old;

      DROP TABLE matches_old;
    `);
  }

  if (tableExists('match_sources')) {
    db.exec(`
      ALTER TABLE match_sources RENAME TO match_sources_old;

      CREATE TABLE match_sources (
        id INTEGER PRIMARY KEY,
        match_id INTEGER NOT NULL,
        source_name TEXT NOT NULL,
        source_match_id TEXT,
        source_url TEXT,
        raw_payload TEXT,
        fetched_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (match_id) REFERENCES matches(id)
      );

      INSERT INTO match_sources (
        id,
        match_id,
        source_name,
        source_match_id,
        source_url,
        raw_payload,
        fetched_at,
        created_at
      )
      SELECT
        id,
        match_id,
        source_name,
        source_match_id,
        source_url,
        raw_payload,
        fetched_at,
        created_at
      FROM match_sources_old;

      DROP TABLE match_sources_old;
    `);
  }

  db.pragma('foreign_keys = ON');
});

transaction();

console.log('Schema repaired.');
console.log(getCreateTableSql('matches'));
console.log(getCreateTableSql('match_sources'));
