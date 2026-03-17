import db from './db.js';

const lineups = db
  .prepare(
    `
      SELECT
        l.id,
        l.match_id,
        l.formation,
        l.is_confirmed,
        t.name AS team_name,
        m.canonical_key
      FROM lineups l
      JOIN teams t ON t.id = l.team_id
      JOIN matches m ON m.id = l.match_id
      ORDER BY l.id DESC
    `,
  )
  .all();

const lineupPlayers = db
  .prepare(
    `
      SELECT
        lp.id,
        lp.role,
        lp.shirt_number,
        lp.position_label,
        p.name AS player_name,
        lp.lineup_id
      FROM lineup_players lp
      JOIN players p ON p.id = lp.player_id
      ORDER BY lp.id DESC
      LIMIT 30
    `,
  )
  .all();

console.log('Lineups:', lineups);
console.log('Lineup Players:', lineupPlayers);
