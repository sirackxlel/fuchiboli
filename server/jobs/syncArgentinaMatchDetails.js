import db from '../db.js';
import { fetchLpfMatchPageData } from '../clients/argentinaClient.js';
import {
  finishScrapeRun,
  insertMatchSource,
  startScrapeRun,
} from '../repositories/matchesRepository.js';
import {
  getOrCreatePlayer,
  replaceLineupPlayers,
  upsertLineup,
} from '../repositories/lineupsRepository.js';
import { replaceMatchTeamStats } from '../repositories/matchStatsRepository.js';
import { replaceMatchEvents } from '../repositories/matchEventsRepository.js';

const COMPETITION_SLUG = 'liga-profesional-apertura-2026';
const SOURCE_NAME = 'LPF';
const resetRequested = process.env.RESET !== '0';
const onlyMatchId = process.env.MATCH_ID ? Number.parseInt(process.env.MATCH_ID, 10) : null;
const limit = process.env.LIMIT ? Number.parseInt(process.env.LIMIT, 10) : null;
const offset = process.env.OFFSET ? Number.parseInt(process.env.OFFSET, 10) : 0;
const includeUpcoming = process.env.INCLUDE_UPCOMING === '1';
const matchWindowFromUtc = process.env.MATCH_WINDOW_FROM_UTC?.trim() || null;
const matchWindowToUtc = process.env.MATCH_WINDOW_TO_UTC?.trim() || null;

function slugify(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveTeamId(eventTeamName, homeTeamName, awayTeamName, homeTeamId, awayTeamId) {
  const normalizedEventTeamName = normalizeName(eventTeamName);
  const normalizedHome = normalizeName(homeTeamName);
  const normalizedAway = normalizeName(awayTeamName);

  if (
    normalizedEventTeamName === normalizedHome ||
    normalizedHome.includes(normalizedEventTeamName) ||
    normalizedEventTeamName.includes(normalizedHome)
  ) {
    return homeTeamId;
  }

  if (
    normalizedEventTeamName === normalizedAway ||
    normalizedAway.includes(normalizedEventTeamName) ||
    normalizedEventTeamName.includes(normalizedAway)
  ) {
    return awayTeamId;
  }

  return null;
}

const matchFilters = [];
const matchFilterParams = [COMPETITION_SLUG];

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

let matches = db
  .prepare(
    `
      SELECT DISTINCT
        m.id,
        m.match_date_utc,
        m.home_team_id,
        m.away_team_id,
        home.slug AS home_slug,
        away.slug AS away_slug,
        (
          SELECT ms.source_url
          FROM match_sources ms
          WHERE ms.match_id = m.id
            AND ms.source_name = 'LPF'
            AND ms.source_url LIKE '%ficha-partido%'
          ORDER BY ms.id DESC
          LIMIT 1
        ) AS lpf_source_url
      FROM matches m
      JOIN competitions c ON c.id = m.competition_id
      JOIN teams home ON home.id = m.home_team_id
      JOIN teams away ON away.id = m.away_team_id
      WHERE c.slug = ?
        AND m.season_slug = '2026'
        ${matchFilters.join('\n        ')}
      ORDER BY datetime(m.match_date_utc) ASC, m.id ASC
    `,
  )
  .all(...matchFilterParams);

if (Number.isFinite(onlyMatchId)) {
  matches = matches.filter((match) => match.id === onlyMatchId);
}

if (Number.isFinite(limit) && limit > 0) {
  matches = matches.slice(offset, offset + limit);
} else if (offset > 0) {
  matches = matches.slice(offset);
}

const argentinaMatchIds = matches.map((match) => match.id);

const clearArgentinaDetails = db.transaction(() => {
  if (argentinaMatchIds.length === 0) {
    return;
  }

  const placeholders = argentinaMatchIds.map(() => '?').join(', ');

  db.prepare(
    `
      DELETE FROM lineup_players
      WHERE lineup_id IN (
        SELECT id
        FROM lineups
        WHERE match_id IN (${placeholders})
      )
    `,
  ).run(...argentinaMatchIds);

  db.prepare(`DELETE FROM lineups WHERE match_id IN (${placeholders})`).run(...argentinaMatchIds);
  db.prepare(`DELETE FROM match_team_stats WHERE match_id IN (${placeholders})`).run(...argentinaMatchIds);
  db.prepare(`DELETE FROM match_events WHERE match_id IN (${placeholders})`).run(...argentinaMatchIds);
  db.prepare(
    `
      DELETE FROM match_sources
      WHERE match_id IN (${placeholders})
        AND source_name = 'AFA'
    `,
  ).run(...argentinaMatchIds);
});

const run = startScrapeRun({
  sourceName: SOURCE_NAME,
  target: 'argentina-match-details',
});

try {
  if (resetRequested) {
    clearArgentinaDetails();
  }

  let itemsFound = 0;
  let itemsSaved = 0;
  const warnings = [];

  for (const match of matches) {
    itemsFound += 1;

    if (!match.lpf_source_url) {
      warnings.push(
        `Sin ficha LPF para ${match.match_date_utc} ${match.home_slug} vs ${match.away_slug}`,
      );
      continue;
    }

    try {
      const detail = await fetchLpfMatchPageData(match.lpf_source_url);

      insertMatchSource({
        matchId: match.id,
        sourceName: SOURCE_NAME,
        sourceUrl: match.lpf_source_url,
        rawPayload: JSON.stringify({
          detailType: 'match-details',
          syncedAt: new Date().toISOString(),
        }),
      });
      itemsSaved += 1;

      const lineupPairs = [
        {
          data: detail.lineups.home,
          teamId: match.home_team_id,
        },
        {
          data: detail.lineups.away,
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
          sourceName: SOURCE_NAME,
          sourceUrl: match.lpf_source_url,
        });

        const players = [
          ...(lineupPair.data?.starters ?? []),
          ...(lineupPair.data?.bench ?? []),
        ].map((player) => {
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

      itemsSaved += replaceMatchTeamStats({
        matchId: match.id,
        teamId: match.home_team_id,
        sourceName: SOURCE_NAME,
        sourceUrl: match.lpf_source_url,
        stats: detail.stats.home,
      });

      itemsSaved += replaceMatchTeamStats({
        matchId: match.id,
        teamId: match.away_team_id,
        sourceName: SOURCE_NAME,
        sourceUrl: match.lpf_source_url,
        stats: detail.stats.away,
      });

      const events = (detail.events ?? []).map((event) => {
        const teamId = resolveTeamId(
          event.teamName,
          detail.lineups.home?.teamName,
          detail.lineups.away?.teamName,
          match.home_team_id,
          match.away_team_id,
        );
        const playerId =
          event.playerName && teamId
            ? getOrCreatePlayer({
                slug: `${slugify(event.playerName)}-${teamId}`,
                name: event.playerName,
                teamId,
                position: null,
              }).id
            : null;

        return {
          eventType: event.eventType,
          minute: event.minute,
          extraMinute: event.extraMinute,
          teamId,
          playerId,
          description: JSON.stringify({
            source: SOURCE_NAME,
            playerName: event.playerName,
            teamName: event.teamName,
          }),
        };
      });

      itemsSaved += replaceMatchEvents(match.id, events);
    } catch (error) {
      warnings.push(
        `Error en ${match.match_date_utc} ${match.home_slug} vs ${match.away_slug}: ${error.message}`,
      );
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
