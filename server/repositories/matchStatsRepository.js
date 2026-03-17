import db from '../db.js';

function now() {
  return new Date().toISOString();
}

export function replaceMatchTeamStats({
  matchId,
  teamId,
  sourceName,
  sourceUrl = null,
  stats,
}) {
  const timestamp = now();
  const deleteStatement = db.prepare(`
    DELETE FROM match_team_stats
    WHERE match_id = ? AND team_id = ? AND source_name = ?
  `);
  const insertStatement = db.prepare(`
    INSERT INTO match_team_stats (
      match_id,
      team_id,
      stat_key,
      stat_value,
      source_name,
      source_url,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const entries = Object.entries(stats ?? {}).filter(
    ([key, value]) => key && value !== null && value !== undefined,
  );

  const transaction = db.transaction(() => {
    deleteStatement.run(matchId, teamId, sourceName);

    for (const [key, value] of entries) {
      insertStatement.run(
        matchId,
        teamId,
        key,
        typeof value === 'object' ? JSON.stringify(value) : String(value),
        sourceName,
        sourceUrl,
        timestamp,
      );
    }
  });

  transaction();
  return entries.length;
}
