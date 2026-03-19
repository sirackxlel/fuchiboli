import db from '../db.js';

export function getMatchesForOdds(matchIds) {
  const numericIds = matchIds
    .map((matchId) => Number(String(matchId).replace(/^db-/, '')))
    .filter((matchId) => Number.isInteger(matchId) && matchId > 0);

  if (numericIds.length === 0) {
    return [];
  }

  const placeholders = numericIds.map(() => '?').join(', ');

  return db
    .prepare(
      `
        SELECT
          m.id,
          m.match_date_utc AS date,
          home.name AS home_team,
          away.name AS away_team
        FROM matches m
        JOIN teams home ON home.id = m.home_team_id
        JOIN teams away ON away.id = m.away_team_id
        WHERE m.id IN (${placeholders})
      `,
    )
    .all(...numericIds)
    .map((match) => ({
      id: `db-${match.id}`,
      date: match.date,
      homeTeam: match.home_team,
      awayTeam: match.away_team,
    }));
}
