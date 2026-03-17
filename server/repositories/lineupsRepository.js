import db from '../db.js';

function now() {
  return new Date().toISOString();
}

export function getOrCreatePlayer({ slug, name, teamId = null, position = null }) {
  const bySlug = slug
    ? db.prepare('SELECT * FROM players WHERE slug = ?').get(slug)
    : null;

  if (bySlug) {
    return bySlug;
  }

  const byNameAndTeam = db
    .prepare('SELECT * FROM players WHERE name = ? AND team_id IS ?')
    .get(name, teamId);

  if (byNameAndTeam) {
    return byNameAndTeam;
  }

  const timestamp = now();
  try {
    const result = db
      .prepare(`
        INSERT INTO players (slug, name, team_id, position, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .run(slug ?? null, name, teamId, position, timestamp, timestamp);

    return db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' && slug) {
      return db.prepare('SELECT * FROM players WHERE slug = ?').get(slug);
    }

    throw error;
  }
}

export function upsertLineup({
  matchId,
  teamId,
  formation = null,
  isConfirmed = 0,
  sourceName,
  sourceUrl,
}) {
  const existing = db
    .prepare('SELECT * FROM lineups WHERE match_id = ? AND team_id = ?')
    .get(matchId, teamId);

  const timestamp = now();

  if (existing) {
    db.prepare(`
      UPDATE lineups
      SET formation = ?, is_confirmed = ?, source_name = ?, source_url = ?, updated_at = ?
      WHERE id = ?
    `).run(formation, isConfirmed, sourceName, sourceUrl, timestamp, existing.id);

    return db.prepare('SELECT * FROM lineups WHERE id = ?').get(existing.id);
  }

  const result = db.prepare(`
    INSERT INTO lineups (
      match_id,
      team_id,
      formation,
      is_confirmed,
      source_name,
      source_url,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(matchId, teamId, formation, isConfirmed, sourceName, sourceUrl, timestamp, timestamp);

  return db.prepare('SELECT * FROM lineups WHERE id = ?').get(result.lastInsertRowid);
}

export function replaceLineupPlayers(lineupId, players) {
  const timestamp = now();
  const deleteStatement = db.prepare('DELETE FROM lineup_players WHERE lineup_id = ?');
  const insertStatement = db.prepare(`
    INSERT INTO lineup_players (
      lineup_id,
      player_id,
      role,
      shirt_number,
      position_label,
      sort_order,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    deleteStatement.run(lineupId);
    players.forEach((player, index) => {
      insertStatement.run(
        lineupId,
        player.playerId,
        player.role,
        player.shirtNumber ?? null,
        player.positionLabel ?? null,
        index + 1,
        timestamp,
      );
    });
  });

  transaction();
}
