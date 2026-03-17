import db from './db.js';

const transaction = db.transaction(() => {
  db.pragma('foreign_keys = OFF');

  db.exec(`
    ALTER TABLE players RENAME TO players_old;

    CREATE TABLE players (
      id INTEGER PRIMARY KEY,
      slug TEXT UNIQUE,
      name TEXT NOT NULL,
      team_id INTEGER,
      position TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );

    INSERT INTO players (id, slug, name, team_id, position, created_at, updated_at)
    SELECT id, "slug ", name, team_id, position, created_at, updated_at
    FROM players_old;

    DROP TABLE players_old;

    ALTER TABLE lineups RENAME TO lineups_old;

    CREATE TABLE lineups (
      id INTEGER PRIMARY KEY,
      match_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      formation TEXT,
      is_confirmed INTEGER NOT NULL DEFAULT 0,
      source_name TEXT,
      source_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (match_id) REFERENCES matches(id),
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );

    INSERT INTO lineups (id, match_id, team_id, formation, is_confirmed, source_name, source_url, created_at, updated_at)
    SELECT id, "match_id ", team_id, "formation ", is_confirmed, source_name, source_url, created_at, updated_at
    FROM lineups_old;

    DROP TABLE lineups_old;

    ALTER TABLE lineup_players RENAME TO lineup_players_old;

    CREATE TABLE lineup_players (
      id INTEGER PRIMARY KEY,
      lineup_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      shirt_number INTEGER,
      position_label TEXT,
      sort_order INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (lineup_id) REFERENCES lineups(id),
      FOREIGN KEY (player_id) REFERENCES players(id)
    );

    INSERT INTO lineup_players (id, lineup_id, player_id, role, shirt_number, position_label, sort_order, created_at)
    SELECT id, lineup_id, player_id, role, shirt_number, position_label, sort_order, created_at
    FROM lineup_players_old;

    DROP TABLE lineup_players_old;
  `);

  db.pragma('foreign_keys = ON');
});

transaction();

console.log('Lineup schema repaired.');
