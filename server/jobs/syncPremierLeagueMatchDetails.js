import db from '../db.js';
import {
  fetchPremierMatchLineups,
  fetchPremierMatchStats,
} from '../clients/premierClient.js';
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
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildPlayersForLineup(teamPayload) {
  const starters = new Set(teamPayload?.formation?.lineup?.flat() ?? []);
  const substitutes = new Set(teamPayload?.formation?.subs ?? []);
  const allPlayers = teamPayload?.players ?? [];

  return allPlayers
    .filter((player) => starters.has(player.id) || substitutes.has(player.id))
    .map((player) => ({
      id: player.id,
      name: [player.firstName, player.lastName].filter(Boolean).join(' ').trim(),
      role: starters.has(player.id) ? 'starter' : 'bench',
      shirtNumber: player.shirtNum ?? null,
      positionLabel: player.position ?? null,
      sortOrder: starters.has(player.id)
        ? (teamPayload?.formation?.lineup?.flat() ?? []).indexOf(player.id) + 1
        : (teamPayload?.formation?.subs ?? []).indexOf(player.id) + 100,
    }))
    .filter((player) => player.name);
}

const matches = db
  .prepare(
    `
      SELECT DISTINCT
        m.id,
        m.home_team_id,
        m.away_team_id,
        ms.source_match_id,
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
            AND mts.source_name = 'PREMIER'
        ) AS stats_count
      FROM matches m
      JOIN competitions c ON c.id = m.competition_id
      JOIN match_sources ms ON ms.match_id = m.id
      WHERE c.slug = 'premier-league-2025-2026'
        AND m.season_slug = '2025'
        AND ms.source_name = 'PREMIER'
      ORDER BY m.match_week ASC, datetime(m.match_date_utc) ASC
    `,
  )
  .all();

const run = startScrapeRun({
  sourceName: 'PREMIER',
  target: 'premier-league-match-details',
});

try {
  let itemsFound = 0;
  let itemsSaved = 0;

  for (const match of matches) {
    const alreadyHasLineups = Number(match.lineup_count) >= 2;
    const alreadyHasStats = Number(match.stats_count) > 0;

    if (alreadyHasLineups && alreadyHasStats) {
      continue;
    }

    itemsFound += 1;
    const matchId = String(match.source_match_id);
    const [lineupsPayload, statsPayload] = await Promise.all([
      fetchPremierMatchLineups(matchId),
      fetchPremierMatchStats(matchId),
    ]);

    const lineupPairs = [
      {
        payload: lineupsPayload?.home_team ?? null,
        teamId: match.home_team_id,
      },
      {
        payload: lineupsPayload?.away_team ?? null,
        teamId: match.away_team_id,
      },
    ];

    for (const lineupPair of lineupPairs) {
      if (lineupPair.payload) {
        const lineup = upsertLineup({
          matchId: match.id,
          teamId: lineupPair.teamId,
          formation: lineupPair.payload?.formation?.formation ?? null,
          isConfirmed: 1,
          sourceName: 'PREMIER',
          sourceUrl: match.source_url?.replace('/overview', '/lineups') ?? match.source_url,
        });

        const players = buildPlayersForLineup(lineupPair.payload)
          .sort((left, right) => left.sortOrder - right.sortOrder)
          .map((player) => {
            const savedPlayer = getOrCreatePlayer({
              slug: `${slugify(player.name)}-${lineupPair.teamId}`,
              name: player.name,
              teamId: lineupPair.teamId,
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
    }

    for (const sideStats of statsPayload ?? []) {
      const teamId = sideStats?.side === 'Away' ? match.away_team_id : match.home_team_id;

      if (!sideStats?.stats || !teamId) {
        continue;
      }

      itemsSaved += replaceMatchTeamStats({
        matchId: match.id,
        teamId,
        sourceName: 'PREMIER',
        sourceUrl: match.source_url?.replace('/overview', '/stats') ?? match.source_url,
        stats: sideStats.stats,
      });
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
