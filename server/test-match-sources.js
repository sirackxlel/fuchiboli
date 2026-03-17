import db from './db.js';

const sources = db
  .prepare(
    `
      SELECT
        ms.*,
        m.canonical_key
      FROM match_sources ms
      JOIN matches m ON m.id = ms.match_id
      ORDER BY ms.id DESC
    `,
  )
  .all();

const runs = db
  .prepare('SELECT * FROM scrape_runs ORDER BY id DESC')
  .all();

console.log('Match Sources:', sources);
console.log('Scrape Runs:', runs);
