import db from '../db.js';
import { fetchLaLigaMatchPageData, mapLaLigaEvents } from '../clients/laligaClient.js';
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
import { replaceMatchEvents } from '../repositories/matchEventsRepository.js';

function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizePlayerKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

const matchWindowFromUtc = process.env.MATCH_WINDOW_FROM_UTC?.trim() || null;
const matchWindowToUtc = process.env.MATCH_WINDOW_TO_UTC?.trim() || null;
const detailQueryFilters = [];
const detailQueryParams = [];

if (matchWindowFromUtc) {
  detailQueryFilters.push('AND datetime(m.match_date_utc) >= datetime(?)');
  detailQueryParams.push(matchWindowFromUtc);
}

if (matchWindowToUtc) {
  detailQueryFilters.push('AND datetime(m.match_date_utc) <= datetime(?)');
  detailQueryParams.push(matchWindowToUtc);
}

const matches = db
  .prepare(
    `
      SELECT DISTINCT
        m.id,
        m.home_team_id,
        m.away_team_id,
        home.name AS home_team_name,
        away.name AS away_team_name,
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
      JOIN match_sources ms ON ms.match_id = m.id
      WHERE c.slug = 'laliga-ea-sports-2025-2026'
        AND m.season_slug = 'temporada-2025-2026'
        AND ms.source_name = 'LALIGA'
        AND ms.source_url LIKE 'https://www.laliga.com/partido/temporada-2025-2026%'
        ${detailQueryFilters.join('\n        ')}
      ORDER BY datetime(m.match_date_utc) ASC
    `,
  )
  .all(...detailQueryParams);

const run = startScrapeRun({
  sourceName: 'LALIGA',
  target: 'laliga-match-details',
});

try {
  let itemsSaved = 0;
  let itemsFound = 0;
  const forceEventsRefresh = process.env.FORCE_EVENTS_REFRESH === '1';

  for (const match of matches) {
    const alreadyHasLineups = Number(match.lineup_count) >= 2;
    const alreadyHasStats = Number(match.stats_count) > 0;
    const alreadyHasEvents = Number(match.event_count) > 0;

    if (alreadyHasLineups && alreadyHasStats && alreadyHasEvents && !forceEventsRefresh) {
      continue;
    }

    itemsFound += 1;
    const { lineups, stats, comments, matchUrl } = await fetchLaLigaMatchPageData(match.source_url);

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

    const playersByName = new Map();
    const addPlayersToMap = (players) => {
      for (const player of players) {
        const key = normalizePlayerKey(player.name);

        if (key && !playersByName.has(key)) {
          playersByName.set(key, player);
        }
      }
    };

    for (const teamData of lineupPairs) {
      if (!teamData.data) {
        continue;
      }

      addPlayersToMap(normalizeLineupPlayers(teamData.data.starts, 'starter'));
      addPlayersToMap(normalizeLineupPlayers(teamData.data.subs, 'bench'));
    }

    const events = mapLaLigaEvents(comments, [
      { id: match.home_team_id, name: match.home_team_name },
      { id: match.away_team_id, name: match.away_team_name },
    ]).map((event) => {
      const knownPlayer = event.playerName
        ? playersByName.get(normalizePlayerKey(event.playerName))
        : null;
      const playerId =
        event.playerName && event.teamId
          ? getOrCreatePlayer({
              slug: slugify(knownPlayer?.name ?? event.playerName),
              name: knownPlayer?.name ?? event.playerName,
              teamId: event.teamId,
              position: knownPlayer?.positionLabel ?? null,
            }).id
          : null;

      return {
        ...event,
        playerId,
      };
    });

    itemsSaved += replaceMatchEvents(match.id, events);
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
