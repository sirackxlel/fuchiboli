import db from '../db.js';
import { fetchLaLigaMatchPageData } from '../clients/laligaClient.js';
import {
  finishScrapeRun,
  startScrapeRun,
} from '../repositories/matchesRepository.js';
import {
  getOrCreatePlayer,
  replaceLineupPlayers,
  upsertLineup,
} from '../repositories/lineupsRepository.js';
import { replaceMatchTeamStats } from '../repositories/matchStatsRepository.js';

function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeLineupPlayers(entries, role) {
  return (entries ?? [])
    .map((entry) => ({
      role,
      name:
        entry.person?.nickname ||
        entry.person?.name ||
        entry.nickname ||
        entry.name ||
        null,
      shirtNumber: entry.shirt_number ?? null,
      positionLabel:
        entry.position_name ??
        entry.position_label ??
        (typeof entry.position === 'number' ? String(entry.position) : entry.position) ??
        null,
    }))
    .filter((entry) => entry.name);
}

const matches = db
  .prepare(
    `
      SELECT DISTINCT
        m.id,
        m.home_team_id,
        m.away_team_id,
        ms.source_url,
        (
          SELECT COUNT(*)
          FROM lineups l
          WHERE l.match_id = m.id
        ) AS lineup_count,
        (
          SELECT COUNT(*)
          FROM match_team_stats mts
          WHERE mts.match_id = m.id
        ) AS stats_count
      FROM matches m
      JOIN competitions c ON c.id = m.competition_id
      JOIN match_sources ms ON ms.match_id = m.id
      WHERE c.slug = 'laliga-ea-sports-2025-2026'
        AND m.season_slug = 'temporada-2025-2026'
        AND ms.source_name = 'LALIGA'
        AND ms.source_url LIKE 'https://www.laliga.com/partido/temporada-2025-2026%'
      ORDER BY datetime(m.match_date_utc) ASC
    `,
  )
  .all();

const run = startScrapeRun({
  sourceName: 'LALIGA',
  target: 'laliga-match-details',
});

try {
  let itemsSaved = 0;
  let itemsFound = 0;

  for (const match of matches) {
    const alreadyHasLineups = Number(match.lineup_count) >= 2;
    const alreadyHasStats = Number(match.stats_count) > 0;

    if (alreadyHasLineups && alreadyHasStats) {
      continue;
    }

    itemsFound += 1;
    const { lineups, stats, matchUrl } = await fetchLaLigaMatchPageData(match.source_url);

    const lineupPairs = [
      {
        data: lineups?.home ?? null,
        teamId: match.home_team_id,
        stats: stats?.home ?? null,
      },
      {
        data: lineups?.away ?? null,
        teamId: match.away_team_id,
        stats: stats?.away ?? null,
      },
    ];

    for (const teamData of lineupPairs) {
      if (teamData.data) {
        const lineup = upsertLineup({
          matchId: match.id,
          teamId: teamData.teamId,
          formation:
            teamData.stats?.formation_used ??
            teamData.data?.formation ??
            null,
          isConfirmed: 1,
          sourceName: 'LALIGA',
          sourceUrl: matchUrl,
        });

        const players = [
          ...normalizeLineupPlayers(teamData.data.starts, 'starter'),
          ...normalizeLineupPlayers(teamData.data.subs, 'bench'),
        ].map((player) => {
          const savedPlayer = getOrCreatePlayer({
            slug: slugify(player.name),
            name: player.name,
            teamId: teamData.teamId,
            position: player.positionLabel,
          });

          return {
            playerId: savedPlayer.id,
            role: player.role,
            shirtNumber: player.shirtNumber,
            positionLabel: player.positionLabel,
          };
        });

        replaceLineupPlayers(lineup.id, players);
        itemsSaved += 1;
      }

      if (teamData.stats) {
        itemsSaved += replaceMatchTeamStats({
          matchId: match.id,
          teamId: teamData.teamId,
          sourceName: 'LALIGA',
          sourceUrl: matchUrl,
          stats: teamData.stats,
        });
      }
    }
  }

  const result = finishScrapeRun(run.id, {
    status: 'success',
    itemsFound,
    itemsSaved,
  });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const result = finishScrapeRun(run.id, {
    status: 'error',
    errorMessage: error.message,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
}
