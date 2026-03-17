import db from './db.js';
import { fetchLaLigaLineups } from './clients/laligaClient.js';

const match = db
  .prepare(
    `
      SELECT ms.source_url
      FROM match_sources ms
      JOIN matches m ON m.id = ms.match_id
      JOIN teams home ON home.id = m.home_team_id
      JOIN teams away ON away.id = m.away_team_id
      WHERE ms.source_name = 'LALIGA'
        AND (home.slug = 'real-betis' OR away.slug = 'real-betis')
      ORDER BY datetime(m.match_date_utc) ASC
      LIMIT 1
    `,
  )
  .get();

if (!match?.source_url) {
  console.error('No encontre un partido de Betis con source_url en match_sources.');
  process.exit(1);
}

const result = await fetchLaLigaLineups(match.source_url);

console.log('Endpoint:', result.endpoint);
console.log(JSON.stringify(result.payload, null, 2));
