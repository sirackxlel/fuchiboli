import db from '../db.js';
import {
  fetchPremierMatchEvents,
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

function parseEventTime(rawValue) {
  const value = String(rawValue ?? '').trim();
  const matched = value.match(/^(\d+)(?:\+(\d+))?$/);

  if (!matched) {
    return {
      minute: null,
      extraMinute: null,
    };
  }

  return {
    minute: Number(matched[1]),
    extraMinute: matched[2] ? Number(matched[2]) : null,
  };
}

function mapGoalEventType(goalType) {
  if (goalType === 'Penalty') {
    return 'penalty_goal';
  }

  if (goalType === 'Own') {
    return 'own_goal';
  }

  return 'goal';
}

function mapCardEventType(cardType) {
  if (cardType === 'StraightRed') {
    return 'red_card';
  }

  if (cardType === 'SecondYellow') {
    return 'second_yellow_red';
  }

  return 'yellow_card';
}

function getOrCreatePremierPlayer(teamPayload, teamId, premierPlayerId) {
  const player = (teamPayload?.players ?? []).find(
    (candidate) => String(candidate.id) === String(premierPlayerId),
  );

  if (!player) {
    return null;
  }

  const name = [player.firstName, player.lastName].filter(Boolean).join(' ').trim();

  if (!name) {
    return null;
  }

  return getOrCreatePlayer({
    slug: `premier-${teamId}-${player.id}`,
    name,
    teamId,
    position: player.position ?? null,
  });
}

function resolvePlayerReference({
  premierPlayerId,
  homePayload,
  awayPayload,
  homeTeamId,
  awayTeamId,
}) {
  if (!premierPlayerId) {
    return {
      playerId: null,
      playerTeamId: null,
    };
  }

  const homePlayer = getOrCreatePremierPlayer(homePayload, homeTeamId, premierPlayerId);
  if (homePlayer) {
    return {
      playerId: homePlayer.id,
      playerTeamId: homeTeamId,
    };
  }

  const awayPlayer = getOrCreatePremierPlayer(awayPayload, awayTeamId, premierPlayerId);
  if (awayPlayer) {
    return {
      playerId: awayPlayer.id,
      playerTeamId: awayTeamId,
    };
  }

  return {
    playerId: null,
    playerTeamId: null,
  };
}

function buildEventDescription(details) {
  return JSON.stringify(details);
}

function buildPremierMatchEvents({
  match,
  lineupsPayload,
  eventsPayload,
}) {
  const homePayload = lineupsPayload?.home_team ?? null;
  const awayPayload = lineupsPayload?.away_team ?? null;
  const eventSides = [
    {
      payload: eventsPayload?.homeTeam ?? null,
      teamId: match.home_team_id,
      creditedTeamId: match.home_team_id,
    },
    {
      payload: eventsPayload?.awayTeam ?? null,
      teamId: match.away_team_id,
      creditedTeamId: match.away_team_id,
    },
  ];
  const events = [];

  for (const side of eventSides) {
    for (const goal of side.payload?.goals ?? []) {
      const scorer = resolvePlayerReference({
        premierPlayerId: goal.playerId,
        homePayload,
        awayPayload,
        homeTeamId: match.home_team_id,
        awayTeamId: match.away_team_id,
      });
      const assist = resolvePlayerReference({
        premierPlayerId: goal.assistPlayerId,
        homePayload,
        awayPayload,
        homeTeamId: match.home_team_id,
        awayTeamId: match.away_team_id,
      });
      const { minute, extraMinute } = parseEventTime(goal.time);
      const eventType = mapGoalEventType(goal.goalType);
      const teamId =
        eventType === 'own_goal'
          ? scorer.playerTeamId ?? side.teamId
          : side.teamId;

      events.push({
        teamId,
        playerId: scorer.playerId,
        eventType,
        minute,
        extraMinute,
        description: buildEventDescription({
          goalType: goal.goalType ?? null,
          period: goal.period ?? null,
          creditedTeamId: side.creditedTeamId,
          assistPlayerId: assist.playerId,
          isPenalty: eventType === 'penalty_goal',
        }),
      });
    }

    for (const card of side.payload?.cards ?? []) {
      const bookedPlayer = resolvePlayerReference({
        premierPlayerId: card.playerId,
        homePayload,
        awayPayload,
        homeTeamId: match.home_team_id,
        awayTeamId: match.away_team_id,
      });
      const { minute, extraMinute } = parseEventTime(card.time);

      events.push({
        teamId: side.teamId,
        playerId: bookedPlayer.playerId,
        eventType: mapCardEventType(card.type),
        minute,
        extraMinute,
        description: buildEventDescription({
          cardType: card.type ?? null,
          period: card.period ?? null,
        }),
      });
    }
  }

  return events.sort((left, right) => {
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

const matchWindowFromUtc = process.env.MATCH_WINDOW_FROM_UTC?.trim() || null;
const matchWindowToUtc = process.env.MATCH_WINDOW_TO_UTC?.trim() || null;
const matchFilters = [];
const matchFilterParams = [];

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
          FROM lineup_players lp
          JOIN lineups l ON l.id = lp.lineup_id
          WHERE l.match_id = m.id
        ) AS lineup_player_count,
        (
          SELECT COUNT(*)
          FROM match_team_stats mts
          WHERE mts.match_id = m.id
            AND mts.source_name = 'PREMIER'
        ) AS stats_count,
        (
          SELECT COUNT(*)
          FROM match_events me
          WHERE me.match_id = m.id
        ) AS event_count,
        m.status
      FROM matches m
      JOIN competitions c ON c.id = m.competition_id
      JOIN match_sources ms ON ms.match_id = m.id
      WHERE c.slug = 'premier-league-2025-2026'
        AND m.season_slug = '2025'
        AND ms.source_name = 'PREMIER'
        ${matchFilters.join('\n        ')}
      ORDER BY m.match_week ASC, datetime(m.match_date_utc) ASC
    `,
  )
  .all(...matchFilterParams);

const run = startScrapeRun({
  sourceName: 'PREMIER',
  target: 'premier-league-match-details',
});

try {
  let itemsFound = 0;
  let itemsSaved = 0;

  for (const match of matches) {
    const alreadyHasLineups =
      Number(match.lineup_count) >= 2 && Number(match.lineup_player_count) > 0;
    const alreadyHasStats = Number(match.stats_count) > 0;
    const alreadyHasEvents = Number(match.event_count) > 0;
    const shouldHaveEvents = match.status === 'finished';

    if (alreadyHasLineups && alreadyHasStats && (!shouldHaveEvents || alreadyHasEvents)) {
      continue;
    }

    itemsFound += 1;
    const matchId = String(match.source_match_id);
    const [lineupsPayload, statsPayload, eventsPayload] = await Promise.all([
      fetchPremierMatchLineups(matchId),
      fetchPremierMatchStats(matchId),
      shouldHaveEvents ? fetchPremierMatchEvents(matchId) : Promise.resolve(null),
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

    if (shouldHaveEvents) {
      const events = buildPremierMatchEvents({
        match,
        lineupsPayload,
        eventsPayload,
      });

      itemsSaved += replaceMatchEvents(match.id, events);
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
