import db from '../db.js';
import { fetchBundesligaMatchPageData } from '../clients/bundesligaClient.js';
import { finishScrapeRun, startScrapeRun } from '../repositories/matchesRepository.js';
import {
  getOrCreatePlayer,
  replaceLineupPlayers,
  upsertLineup,
} from '../repositories/lineupsRepository.js';
import { replaceMatchEvents } from '../repositories/matchEventsRepository.js';
import { replaceMatchTeamStats } from '../repositories/matchStatsRepository.js';

function slugify(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const includeUpcoming = process.env.INCLUDE_UPCOMING === '1';
const matchWindowFromUtc = process.env.MATCH_WINDOW_FROM_UTC?.trim() || null;
const matchWindowToUtc = process.env.MATCH_WINDOW_TO_UTC?.trim() || null;
const matchFilters = [];
const matchFilterParams = [];

if (!includeUpcoming) {
  matchFilters.push("AND m.status = 'finished'");
}

if (matchWindowFromUtc) {
  matchFilters.push('AND datetime(m.match_date_utc) >= datetime(?)');
  matchFilterParams.push(matchWindowFromUtc);
}

if (matchWindowToUtc) {
  matchFilters.push('AND datetime(m.match_date_utc) <= datetime(?)');
  matchFilterParams.push(matchWindowToUtc);
}

const matches = db
  .prepare(
    `
      SELECT DISTINCT
        m.id,
        m.match_week,
        m.home_team_id,
        m.away_team_id,
        home.slug AS home_slug,
        away.slug AS away_slug,
        (
          SELECT COUNT(*)
          FROM lineups l
          WHERE l.match_id = m.id
        ) AS lineup_count,
        (
          SELECT COUNT(*)
          FROM match_team_stats mts
          WHERE mts.match_id = m.id
            AND mts.source_name = 'BUNDESLIGA'
        ) AS stats_count,
        (
          SELECT COUNT(*)
          FROM match_events me
          WHERE me.match_id = m.id
        ) AS event_count
      FROM matches m
      JOIN competitions c ON c.id = m.competition_id
      JOIN teams home ON home.id = m.home_team_id
      JOIN teams away ON away.id = m.away_team_id
      WHERE c.slug = 'bundesliga-2025-2026'
        AND m.season_slug = 'DFL-SEA-0001K9'
        ${matchFilters.join('\n        ')}
      ORDER BY m.match_week ASC, datetime(m.match_date_utc) ASC
    `,
  )
  .all(...matchFilterParams);

const run = startScrapeRun({
  sourceName: 'BUNDESLIGA',
  target: 'bundesliga-match-details',
});

try {
  let itemsFound = 0;
  let itemsSaved = 0;
  const warnings = [];

  for (const match of matches) {
    const alreadyHasLineups = Number(match.lineup_count) >= 2;
    const alreadyHasStats = Number(match.stats_count) > 0;
    const alreadyHasEvents = Number(match.event_count) > 0;

    if (alreadyHasLineups && alreadyHasStats && alreadyHasEvents) {
      continue;
    }

    itemsFound += 1;
    const slugLong = `${match.home_slug}-vs-${match.away_slug}`;
    try {
      const { lineups, stats, events, lineupUrl, statsUrl } = await fetchBundesligaMatchPageData({
        matchWeek: match.match_week,
        slugLong,
      });

      const lineupPairs = [
        {
          data: lineups.home,
          teamId: match.home_team_id,
        },
        {
          data: lineups.away,
          teamId: match.away_team_id,
        },
      ];

      for (const lineupPair of lineupPairs) {
        if (!lineupPair.data) {
          continue;
        }

        const lineup = upsertLineup({
          matchId: match.id,
          teamId: lineupPair.teamId,
          formation: lineupPair.data?.formation ?? null,
          isConfirmed: 1,
          sourceName: 'BUNDESLIGA',
          sourceUrl: lineupUrl,
        });

        const players = [...(lineupPair.data?.starters ?? []), ...(lineupPair.data?.bench ?? [])].map(
          (player) => {
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
          },
        );

        replaceLineupPlayers(lineup.id, players);
        itemsSaved += 1;
      }

      if (stats) {
        itemsSaved += replaceMatchTeamStats({
          matchId: match.id,
          teamId: match.home_team_id,
          sourceName: 'BUNDESLIGA',
          sourceUrl: statsUrl,
          stats: stats.home,
        });

        itemsSaved += replaceMatchTeamStats({
          matchId: match.id,
          teamId: match.away_team_id,
          sourceName: 'BUNDESLIGA',
          sourceUrl: statsUrl,
          stats: stats.away,
        });
      } else {
        warnings.push(`Sin estadisticas: ${slugLong}`);
      }

      const eventRows = (events ?? []).map((event) => {
        const teamId =
          event.side === 'home'
            ? match.home_team_id
            : event.side === 'away'
              ? match.away_team_id
              : null;

        const savedPlayer =
          teamId && event.playerName
            ? getOrCreatePlayer({
                slug: `${slugify(event.playerName)}-${teamId}`,
                name: event.playerName,
                teamId,
                position: null,
              })
            : null;

        return {
          teamId,
          playerId: savedPlayer?.id ?? null,
          eventType: event.eventType,
          minute: event.minute,
          extraMinute: event.extraMinute,
          description: event.description,
        };
      });

      itemsSaved += replaceMatchEvents(match.id, eventRows);
    } catch (error) {
      warnings.push(`Error en ${slugLong}: ${error.message}`);
    }
  }

  const result = finishScrapeRun(run.id, {
    status: 'success',
    itemsFound,
    itemsSaved,
  });

  if (warnings.length > 0) {
    console.warn(JSON.stringify({ warnings }, null, 2));
  }

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const result = finishScrapeRun(run.id, {
    status: 'error',
    errorMessage: error.message,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
}
