import db from '../db.js';
import {
  SERIE_A_SEASON_ID,
  SERIE_A_SITE_BASE_URL,
  fetchSerieAMatchLineups,
  fetchSerieAMatchSummary,
  fetchSerieAMatchTeamStats,
} from '../clients/serieAClient.js';
import { finishScrapeRun, startScrapeRun } from '../repositories/matchesRepository.js';
import {
  getOrCreatePlayer,
  replaceLineupPlayers,
  upsertLineup,
} from '../repositories/lineupsRepository.js';
import { replaceMatchEvents } from '../repositories/matchEventsRepository.js';
import { replaceMatchTeamStats } from '../repositories/matchStatsRepository.js';

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeMatchApiId(sourceMatchId) {
  const raw = normalizeWhitespace(sourceMatchId);

  if (!raw) {
    return null;
  }

  return raw.startsWith('serie-a::Football_Match::')
    ? raw
    : `serie-a::Football_Match::${raw}`;
}

function resolvePlayerName(player) {
  const fullName = [player?.mediaFirstName, player?.mediaLastName]
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean)
    .join(' ')
    .trim();

  return (
    fullName ||
    normalizeWhitespace(player?.shortName) ||
    normalizeWhitespace(player?.shirtName) ||
    normalizeWhitespace(player?.displayName) ||
    null
  );
}

function getOrCreateSerieAPlayer(player, teamId) {
  const name = resolvePlayerName(player);

  if (!name) {
    return null;
  }

  const sourcePlayerId = normalizeWhitespace(player?.playerId);
  const slugBase = sourcePlayerId
    ? `seriea-${teamId}-${sourcePlayerId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
    : `${slugify(name)}-${teamId}`;

  return getOrCreatePlayer({
    slug: slugBase,
    name,
    teamId,
    position: normalizeWhitespace(player?.roleLabel) || null,
  });
}

function buildLineupPlayers(players, teamId, role) {
  return (players ?? [])
    .map((player) => {
      const savedPlayer = getOrCreateSerieAPlayer(player, teamId);

      if (!savedPlayer) {
        return null;
      }

      return {
        playerId: savedPlayer.id,
        role,
        shirtNumber: player?.bibNumber ?? null,
        positionLabel: normalizeWhitespace(player?.roleLabel) || null,
      };
    })
    .filter(Boolean);
}

function normalizeEventType(event) {
  const rawType = normalizeWhitespace(event?.type).toLowerCase();
  const description = normalizeWhitespace(event?.description).toLowerCase();

  if (!rawType) {
    return null;
  }

  if (rawType.includes('own-goal') || description.includes('autorete')) {
    return 'own_goal';
  }

  if (
    rawType.includes('penalty') ||
    description.includes('rigore') ||
    description.includes('dischetto')
  ) {
    return 'penalty_goal';
  }

  if (rawType === 'goal') {
    return 'goal';
  }

  if (rawType.includes('second') && rawType.includes('yellow')) {
    return 'second_yellow_red';
  }

  if (rawType.includes('red-card')) {
    return 'red_card';
  }

  if (rawType.includes('yellow-card')) {
    return 'yellow_card';
  }

  return null;
}

function buildStatsObject(statsPayload, side) {
  const result = {};

  for (const stat of statsPayload?.stats ?? []) {
    const rawValue = side === 'home' ? stat?.statsValueHome : stat?.statsValueAway;

    if (rawValue == null) {
      continue;
    }

    const statId = normalizeWhitespace(stat?.statsId);
    if (!statId) {
      continue;
    }

    result[statId] = rawValue;
  }

  return result;
}

function buildEventRows(summaryPayload, match) {
  const rows = [];

  for (const event of summaryPayload?.events ?? []) {
    const eventType = normalizeEventType(event);

    if (!eventType) {
      continue;
    }

    const side = event?.home ? 'home' : event?.away ? 'away' : null;
    const sidePayload = event?.home ?? event?.away ?? null;
    const teamId = side === 'home' ? match.home_team_id : side === 'away' ? match.away_team_id : null;
    const savedPlayer = sidePayload?.player ? getOrCreateSerieAPlayer(sidePayload.player, teamId) : null;
    const assistPlayer = sidePayload?.player?.assistPlayerId
      ? getOrCreatePlayer({
          slug: `seriea-${teamId}-${String(sidePayload.player.assistPlayerId).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
          name:
            normalizeWhitespace(
              [
                sidePayload.player.assistMediaFirstName,
                sidePayload.player.assistMediaLastName,
              ]
                .filter(Boolean)
                .join(' '),
            ) ||
            normalizeWhitespace(sidePayload.player.assistShortName) ||
            normalizeWhitespace(sidePayload.player.assistDisplayName) ||
            'Asistente',
          teamId,
          position: normalizeWhitespace(sidePayload.player.assistRoleLabel) || null,
        })
      : null;

    rows.push({
      teamId,
      playerId: savedPlayer?.id ?? null,
      eventType,
      minute: Number.isFinite(Number(sidePayload?.time ?? event?.time))
        ? Number(sidePayload?.time ?? event?.time)
        : null,
      extraMinute: Number.isFinite(Number(sidePayload?.additionalTime ?? event?.additionalTime))
        ? Number(sidePayload?.additionalTime ?? event?.additionalTime)
        : null,
      description: JSON.stringify({
        rawType: event?.type ?? null,
        label: event?.label ?? null,
        text: event?.description ?? null,
        assistPlayerId: assistPlayer?.id ?? null,
        isPenalty: eventType === 'penalty_goal',
      }),
    });
  }

  return rows.sort((left, right) => {
    const leftMinute = left.minute ?? 999;
    const rightMinute = right.minute ?? 999;
    const leftExtra = left.extraMinute ?? 0;
    const rightExtra = right.extraMinute ?? 0;

    if (leftMinute !== rightMinute) {
      return leftMinute - rightMinute;
    }

    if (leftExtra !== rightExtra) {
      return leftExtra - rightExtra;
    }

    return left.eventType.localeCompare(right.eventType);
  });
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
            AND mts.source_name = 'SERIEA'
        ) AS stats_count,
        (
          SELECT COUNT(*)
          FROM match_events me
          WHERE me.match_id = m.id
        ) AS event_count
      FROM matches m
      JOIN competitions c ON c.id = m.competition_id
      JOIN match_sources ms ON ms.match_id = m.id
      WHERE c.slug = 'serie-a-2025-2026'
        AND m.season_slug = '2025/2026'
        AND ms.source_name = 'SERIEA'
        ${matchFilters.join('\n        ')}
      ORDER BY m.match_week ASC, datetime(m.match_date_utc) ASC
    `,
  )
  .all(...matchFilterParams);

const run = startScrapeRun({
  sourceName: 'SERIEA',
  target: 'serie-a-match-details',
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
    const sourceMatchId = normalizeMatchApiId(match.source_match_id);

    if (!sourceMatchId) {
      warnings.push(`Match sin source_match_id: ${match.id}`);
      continue;
    }

    try {
      const [lineupsPayload, summaryPayload, statsPayload] = await Promise.all([
        fetchSerieAMatchLineups(sourceMatchId),
        fetchSerieAMatchSummary(sourceMatchId),
        fetchSerieAMatchTeamStats(sourceMatchId),
      ]);

      const lineupPairs = [
        {
          data: lineupsPayload?.home,
          teamId: match.home_team_id,
        },
        {
          data: lineupsPayload?.away,
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
          formation: normalizeWhitespace(lineupPair.data?.tacticalFormation) || null,
          isConfirmed: 1,
          sourceName: 'SERIEA',
          sourceUrl: match.source_url ?? `${SERIE_A_SITE_BASE_URL}/serie-a/match/${match.source_match_id}`,
        });

        const players = [
          ...buildLineupPlayers(lineupPair.data?.fielded, lineupPair.teamId, 'starter'),
          ...buildLineupPlayers(lineupPair.data?.benched, lineupPair.teamId, 'bench'),
        ];

        replaceLineupPlayers(lineup.id, players);
        itemsSaved += 1;
      }

      itemsSaved += replaceMatchTeamStats({
        matchId: match.id,
        teamId: match.home_team_id,
        sourceName: 'SERIEA',
        sourceUrl: `${match.source_url ?? `${SERIE_A_SITE_BASE_URL}/serie-a/match/${match.source_match_id}`}/stats`,
        stats: buildStatsObject(statsPayload, 'home'),
      });

      itemsSaved += replaceMatchTeamStats({
        matchId: match.id,
        teamId: match.away_team_id,
        sourceName: 'SERIEA',
        sourceUrl: `${match.source_url ?? `${SERIE_A_SITE_BASE_URL}/serie-a/match/${match.source_match_id}`}/stats`,
        stats: buildStatsObject(statsPayload, 'away'),
      });

      itemsSaved += replaceMatchEvents(match.id, buildEventRows(summaryPayload, match));
    } catch (error) {
      warnings.push(`Error en partido ${match.id}: ${error.message}`);
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
