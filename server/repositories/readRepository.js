import db from '../db.js';
import { fetchLaLigaStandings } from '../clients/laligaClient.js';
import {
  getLatestStandingsTable,
  saveStandingsSnapshot,
} from './standingsRepository.js';
import { getTeamSquadProfiles } from './squadProfilesRepository.js';

const TEAM_ROUTE_TO_SLUG = {
  boca: 'boca-juniors',
  betis: 'real-betis',
  'boca-juniors': 'boca-juniors',
  'real-betis': 'real-betis',
};

const COMPETITION_TEAM_CONFIG = {
  laliga: {
    competitionSlug: 'laliga-ea-sports-2025-2026',
    seasonSlug: 'temporada-2025-2026',
  },
  premier: {
    competitionSlug: 'premier-league-2025-2026',
    seasonSlug: '2025',
  },
  bundesliga: {
    competitionSlug: 'bundesliga-2025-2026',
    seasonSlug: 'DFL-SEA-0001K9',
  },
  argentina: {
    competitionSlug: 'liga-profesional-apertura-2026',
    seasonSlug: '2026',
  },
  seriea: {
    competitionSlug: 'serie-a-2025-2026',
    seasonSlug: '2025/2026',
  },
};

function normalizePlayerName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSquadPositionLabel(value) {
  const label = String(value ?? '').trim();

  if (!label) {
    return null;
  }

  const normalized = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    return null;
  }

  if (/^\d+$/.test(normalized)) {
    return null;
  }

  if (
    normalized === 'minuto' ||
    normalized === 'minute' ||
    normalized === 'suplente' ||
    normalized === 'starter' ||
    normalized === 'bench'
  ) {
    return null;
  }

  return label;
}

export function resolveTeamSlug(teamKey) {
  return TEAM_ROUTE_TO_SLUG[teamKey] ?? null;
}

export function getTeamsForCompetitionKey(competitionKey) {
  const config = COMPETITION_TEAM_CONFIG[competitionKey];

  if (!config) {
    throw new Error('Competencia no soportada.');
  }

  const competitionLogos = getCompetitionLogoMap(config.competitionSlug);

  return db
    .prepare(
      `
        SELECT DISTINCT
          t.slug AS team_slug,
          t.name AS team_name
        FROM matches m
        JOIN competitions c ON c.id = m.competition_id
        JOIN teams t
          ON t.id = m.home_team_id
          OR t.id = m.away_team_id
        WHERE c.slug = ?
          AND m.season_slug = ?
        ORDER BY t.name ASC
      `,
    )
    .all(config.competitionSlug, config.seasonSlug)
    .map((team) => ({
      teamSlug: team.team_slug,
      teamName: team.team_name,
      logoUrl: competitionLogos.get(team.team_slug) ?? null,
    }));
}

export function getSquadForTeam(teamSlug, competitionKey = null) {
  const team = db
    .prepare(
      `
        SELECT id, slug, name
        FROM teams
        WHERE slug = ?
      `,
    )
    .get(teamSlug);

  if (!team) {
    return null;
  }

  const competitionSlug = competitionKey
    ? (COMPETITION_TEAM_CONFIG[competitionKey]?.competitionSlug ?? null)
    : null;
  const squadProfiles = getTeamSquadProfiles(team.id, competitionSlug);

  if (squadProfiles.length > 0) {
    const players = squadProfiles
      .map((row) => ({
        playerName: row.player_name,
        shirtNumber: Number.isFinite(row.shirt_number) ? row.shirt_number : null,
        positionLabel: normalizeSquadPositionLabel(row.position_label),
        photoUrl: row.photo_url ?? null,
      }))
      .sort((left, right) => {
        if (left.shirtNumber == null && right.shirtNumber == null) {
          return left.playerName.localeCompare(right.playerName);
        }

        if (left.shirtNumber == null) {
          return 1;
        }

        if (right.shirtNumber == null) {
          return -1;
        }

        if (left.shirtNumber !== right.shirtNumber) {
          return left.shirtNumber - right.shirtNumber;
        }

        return left.playerName.localeCompare(right.playerName);
      });

    return {
      teamSlug: team.slug,
      teamName: team.name,
      players,
    };
  }

  const rows = db
    .prepare(
      `
        SELECT
          p.id AS player_id,
          p.name AS player_name,
          p.position AS default_position,
          lp.shirt_number,
          lp.position_label,
          l.id AS lineup_id
        FROM players p
        JOIN lineup_players lp ON lp.player_id = p.id
        JOIN lineups l ON l.id = lp.lineup_id
        WHERE p.team_id = ?
        ORDER BY l.id DESC, lp.sort_order ASC, p.id DESC
      `,
    )
    .all(team.id);

  const seen = new Map();

  for (const row of rows) {
    const key = normalizePlayerName(row.player_name);

    if (!key) {
      continue;
    }

    const nextPlayer = {
      playerName: row.player_name,
      shirtNumber: Number.isFinite(row.shirt_number) ? row.shirt_number : null,
      positionLabel:
        normalizeSquadPositionLabel(row.position_label) ??
        normalizeSquadPositionLabel(row.default_position),
      photoUrl: null,
    };

    if (!seen.has(key)) {
      seen.set(key, nextPlayer);
      continue;
    }

    const currentPlayer = seen.get(key);

    if (currentPlayer.shirtNumber == null && nextPlayer.shirtNumber != null) {
      seen.set(key, {
        ...currentPlayer,
        shirtNumber: nextPlayer.shirtNumber,
        positionLabel: currentPlayer.positionLabel ?? nextPlayer.positionLabel,
      });
    } else if (!currentPlayer.positionLabel && nextPlayer.positionLabel) {
      seen.set(key, {
        ...currentPlayer,
        positionLabel: nextPlayer.positionLabel,
      });
    }
  }

  const players = [...seen.values()].sort((left, right) => {
    if (left.shirtNumber == null && right.shirtNumber == null) {
      return left.playerName.localeCompare(right.playerName);
    }

    if (left.shirtNumber == null) {
      return 1;
    }

    if (right.shirtNumber == null) {
      return -1;
    }

    if (left.shirtNumber !== right.shirtNumber) {
      return left.shirtNumber - right.shirtNumber;
    }

    return left.playerName.localeCompare(right.playerName);
  });

  return {
    teamSlug: team.slug,
    teamName: team.name,
    players,
  };
}

export function getUpcomingMatchesForTeam(teamSlug) {
  return db
    .prepare(
      `
        SELECT
          m.id,
          m.match_date_utc AS date,
          m.status,
          m.status_detail,
          m.stage,
          m.round_name,
          m.match_week,
          m.venue_name,
          m.venue_city,
          m.home_score,
          m.away_score,
          home.slug AS home_slug,
          home.name AS home_team,
          away.slug AS away_slug,
          away.name AS away_team,
          c.name AS competition_name,
          ms.source_name,
          ms.source_url
        FROM matches m
        JOIN teams home ON home.id = m.home_team_id
        JOIN teams away ON away.id = m.away_team_id
        LEFT JOIN competitions c ON c.id = m.competition_id
        LEFT JOIN match_sources ms
          ON ms.id = (
            SELECT inner_ms.id
            FROM match_sources inner_ms
            WHERE inner_ms.match_id = m.id
            ORDER BY inner_ms.id DESC
            LIMIT 1
          )
        WHERE home.slug = ? OR away.slug = ?
        ORDER BY datetime(m.match_date_utc) ASC
      `,
    )
    .all(teamSlug, teamSlug)
    .map((match) => ({
      id: `db-${match.id}`,
      date: match.date,
      status: match.status,
      statusDetail: match.status_detail,
      stage: match.stage,
      competition: match.competition_name ?? match.round_name ?? 'Partido',
      roundName: match.round_name,
      week: match.match_week,
      venue: match.venue_name,
      city: match.venue_city,
      homeSlug: match.home_slug,
      homeTeam: match.home_team,
      awaySlug: match.away_slug,
      awayTeam: match.away_team,
      homeScore: match.home_score,
      awayScore: match.away_score,
      source: match.source_name ?? 'DB',
      sourceUrl: match.source_url ?? null,
    }));
}

export function getUpcomingMatchesGrouped() {
  return {
    boca: getUpcomingMatchesForTeam('boca-juniors'),
    betis: getUpcomingMatchesForTeam('real-betis'),
  };
}

function normalizeStandingsTable(table) {
  return {
    competition: table.snapshot.competition_name,
    competitionSlug: table.snapshot.competition_slug,
    season: table.snapshot.season,
    updatedAt: table.snapshot.fetched_at,
    source: table.snapshot.source_name,
    sourceUrl: table.snapshot.source_url,
    entries: table.entries.map((entry) => ({
      teamSlug: entry.team_slug,
      teamName: entry.team_name,
      teamShortName: entry.team_short_name,
      position: entry.position,
      points: entry.points,
      played: entry.played,
      won: entry.won,
      drawn: entry.drawn,
      lost: entry.lost,
      goalsFor: entry.goals_for,
      goalsAgainst: entry.goals_against,
      goalDifference: entry.goal_difference,
      qualification: entry.qualification,
      logoClass: entry.logo_class,
    })),
  };
}

async function ensureLatestLaLigaStandings() {
  const latest = getLatestStandingsTable('laliga-easports-2025');
  const latestFetchedAt = latest?.snapshot?.fetched_at
    ? Date.parse(latest.snapshot.fetched_at)
    : 0;
  const tenHours = 10 * 60 * 60 * 1000;

  if (latest && Date.now() - latestFetchedAt < tenHours) {
    return latest;
  }

  const standings = await fetchLaLigaStandings({ forceRefresh: true });
  saveStandingsSnapshot({
    sourceName: 'LALIGA',
    competitionSlug: standings.competitionSlug,
    competitionName: standings.competition,
    season: standings.season,
    sourceUrl: standings.sourceUrl,
    entries: standings.table.map((entry) => ({
      teamSlug: entry.team.slug,
      teamName: entry.team.name,
      teamShortName: entry.team.shortName,
      position: entry.position,
      points: entry.points,
      played: entry.played,
      won: entry.won,
      drawn: entry.drawn,
      lost: entry.lost,
      goalsFor: entry.goalsFor,
      goalsAgainst: entry.goalsAgainst,
      goalDifference: entry.goalDifference,
      qualification: entry.qualification,
      logoClass: entry.team.logoClass,
    })),
  });

  return getLatestStandingsTable('laliga-easports-2025');
}

function getLatestStoredStandings(competitionSlug) {
  const latest = getLatestStandingsTable(competitionSlug);
  return latest ? normalizeStandingsTable(latest) : null;
}

function getArgentinaStandingsCollections() {
  return {
    groupA: getLatestStoredStandings('liga-profesional-apertura-2026-grupo-a'),
    groupB: getLatestStoredStandings('liga-profesional-apertura-2026-grupo-b'),
    general: getLatestStoredStandings('liga-profesional-apertura-2026-general'),
  };
}

function getArgentinaLogoMap() {
  const tables = getArgentinaStandingsCollections();
  const entries = [
    ...(tables.groupA?.entries ?? []),
    ...(tables.groupB?.entries ?? []),
    ...(tables.general?.entries ?? []),
  ];

  return new Map(entries.map((entry) => [entry.teamSlug, entry.logoClass ?? null]));
}

function getCompetitionLogoMap(competitionSlug) {
  if (competitionSlug === 'liga-profesional-apertura-2026') {
    return getArgentinaLogoMap();
  }

  const table = getLatestStoredStandings(competitionSlug);
  return new Map((table?.entries ?? []).map((entry) => [entry.teamSlug, entry.logoClass ?? null]));
}

function getLineupsForMatch(matchId) {
  return db
    .prepare(
      `
        SELECT
          l.id,
          l.formation,
          l.is_confirmed,
          l.source_name,
          l.source_url,
          t.name AS team_name
        FROM lineups l
        JOIN teams t ON t.id = l.team_id
        WHERE l.match_id = ?
        ORDER BY l.id ASC
      `,
    )
    .all(matchId)
    .map((lineup) => {
      const players = db
        .prepare(
          `
            SELECT
              lp.role,
              lp.shirt_number,
              lp.position_label,
              lp.sort_order,
              p.name AS player_name
            FROM lineup_players lp
            JOIN players p ON p.id = lp.player_id
            WHERE lp.lineup_id = ?
            ORDER BY lp.sort_order ASC
          `,
        )
        .all(lineup.id);

      return {
        teamName: lineup.team_name,
        formation: lineup.formation,
        isConfirmed: Boolean(lineup.is_confirmed),
        source: lineup.source_name,
        sourceUrl: lineup.source_url,
        starters: players.filter((player) => player.role === 'starter'),
        bench: players.filter((player) => player.role === 'bench'),
      };
    });
}

function getStatsForMatch(matchId) {
  const grouped = db
    .prepare(
      `
        SELECT
          mts.team_id,
          mts.stat_key,
          mts.stat_value,
          mts.source_name,
          mts.source_url,
          t.name AS team_name
        FROM match_team_stats mts
        JOIN teams t ON t.id = mts.team_id
        WHERE mts.match_id = ?
        ORDER BY t.name ASC, mts.stat_key ASC
      `,
    )
    .all(matchId);

  const byTeam = new Map();

  for (const row of grouped) {
    if (!byTeam.has(row.team_id)) {
      byTeam.set(row.team_id, {
        teamName: row.team_name,
        source: row.source_name,
        sourceUrl: row.source_url,
        stats: {},
      });
    }

    byTeam.get(row.team_id).stats[row.stat_key] = row.stat_value;
  }

  return [...byTeam.values()];
}

function parseEventDescription(description) {
  if (!description) {
    return null;
  }

  try {
    return JSON.parse(description);
  } catch {
    return description;
  }
}

function getEventsForMatch(matchId) {
  return db
    .prepare(
      `
        SELECT
          me.event_type,
          me.minute,
          me.extra_minute,
          me.description,
          t.name AS team_name,
          p.name AS player_name
        FROM match_events me
        LEFT JOIN teams t ON t.id = me.team_id
        LEFT JOIN players p ON p.id = me.player_id
        WHERE me.match_id = ?
        ORDER BY me.minute ASC, me.extra_minute ASC, me.id ASC
      `,
    )
    .all(matchId)
    .map((event) => ({
      eventType: event.event_type,
      minute: event.minute,
      extraMinute: event.extra_minute,
      teamName: event.team_name,
      playerName: event.player_name,
      details: parseEventDescription(event.description),
    }));
}

function buildStandingsCard(teamName, teamSlug, standingsEntry, competitionName) {
  return {
    teamName,
    teamSlug,
    available: Boolean(standingsEntry),
    competitionName,
    standing: standingsEntry
      ? {
          position: standingsEntry.position,
          points: standingsEntry.points,
          played: standingsEntry.played,
          won: standingsEntry.won,
          drawn: standingsEntry.drawn,
          lost: standingsEntry.lost,
          goalsFor: standingsEntry.goals_for,
          goalsAgainst: standingsEntry.goals_against,
          goalDifference: standingsEntry.goal_difference,
          qualification: standingsEntry.qualification,
          logoClass: standingsEntry.logo_class,
        }
      : null,
    fullTable: null,
    tableViews: [],
  };
}

function buildStandingsTableView(key, table, teamSlug) {
  const standing = table?.entries?.find((entry) => entry.teamSlug === teamSlug) ?? null;

  if (!standing) {
    return null;
  }

  return {
    key,
    competitionName: table.competition,
    standing,
    fullTable: table.entries,
  };
}

function buildMultiStandingsCard(teamName, teamSlug, tableViews) {
  const availableViews = tableViews.filter(Boolean);
  const primaryView = availableViews[0] ?? null;

  return {
    teamName,
    teamSlug,
    available: availableViews.length > 0,
    competitionName: primaryView?.competitionName ?? null,
    standing: primaryView,
    fullTable: primaryView?.fullTable ?? null,
    tableViews: availableViews,
  };
}

async function getStandingsForMatch(match) {
  try {
    if (match.competition_slug === 'liga-profesional-apertura-2026') {
      const tables = getArgentinaStandingsCollections();
      const teams = [
        buildMultiStandingsCard(match.home_team, match.home_slug, [
          buildStandingsTableView('group-a', tables.groupA, match.home_slug),
          buildStandingsTableView('group-b', tables.groupB, match.home_slug),
          buildStandingsTableView('general', tables.general, match.home_slug),
        ]),
        buildMultiStandingsCard(match.away_team, match.away_slug, [
          buildStandingsTableView('group-a', tables.groupA, match.away_slug),
          buildStandingsTableView('group-b', tables.groupB, match.away_slug),
          buildStandingsTableView('general', tables.general, match.away_slug),
        ]),
      ];

      const availableTeams = teams.filter((team) => team.available);

      return {
        available: availableTeams.length > 0,
        message:
          availableTeams.length > 0
            ? null
            : 'La tabla de posiciones todavia no esta disponible para los equipos de este partido.',
        teams,
        source:
          tables.general?.source ?? tables.groupA?.source ?? tables.groupB?.source ?? match.source_name ?? 'DB',
        updatedAt:
          tables.general?.updatedAt ?? tables.groupA?.updatedAt ?? tables.groupB?.updatedAt ?? null,
      };
    }

    const standingsTable =
      match.competition_slug === 'laliga-ea-sports-2025-2026'
        ? normalizeStandingsTable(await ensureLatestLaLigaStandings())
        : getLatestStoredStandings(match.competition_slug);

    if (!standingsTable) {
      return {
        available: false,
        message: 'La tabla de posiciones todavia no esta disponible para los equipos de este partido.',
        teams: [
          {
            teamName: match.home_team,
            teamSlug: match.home_slug,
            available: false,
            competitionName: null,
            standing: null,
          },
          {
            teamName: match.away_team,
            teamSlug: match.away_slug,
            available: false,
            competitionName: null,
            standing: null,
          },
        ],
        source: match.source_name ?? 'DB',
        updatedAt: null,
      };
    }

    const standingsMap = new Map(
      standingsTable.entries.map((entry) => [entry.teamSlug, entry]),
    );

    const teams = [
      buildStandingsCard(
        match.home_team,
        match.home_slug,
        standingsMap.get(match.home_slug) ?? null,
        standingsMap.get(match.home_slug) ? standingsTable.competition : null,
      ),
      buildStandingsCard(
        match.away_team,
        match.away_slug,
        standingsMap.get(match.away_slug) ?? null,
        standingsMap.get(match.away_slug) ? standingsTable.competition : null,
      ),
    ];

    for (const team of teams) {
      if (team.available) {
        team.fullTable = standingsTable.entries;
      }
    }

    const availableTeams = teams.filter((team) => team.available);

    return {
      available: availableTeams.length > 0,
      message:
        availableTeams.length > 0
          ? null
          : 'La tabla de posiciones todavia no esta disponible para los equipos de este partido.',
      teams,
      source: standingsTable.source,
      updatedAt: standingsTable.updatedAt,
    };
  } catch (error) {
    return {
      available: false,
      message: 'No pudimos cargar la tabla de posiciones en este momento.',
      teams: [
        {
          teamName: match.home_team,
          teamSlug: match.home_slug,
          available: false,
          competitionName: null,
          standing: null,
        },
        {
          teamName: match.away_team,
          teamSlug: match.away_slug,
          available: false,
          competitionName: null,
          standing: null,
        },
      ],
      source: match.source_name ?? 'DB',
      updatedAt: null,
      error: error.message,
    };
  }
}

export async function getLaLigaStandings() {
  return normalizeStandingsTable(await ensureLatestLaLigaStandings());
}

export function getBundesligaStandings() {
  const table = getLatestStoredStandings('bundesliga-2025-2026');

  if (!table) {
    throw new Error('No hay tabla de Bundesliga cargada en la base.');
  }

  return table;
}

export function getArgentinaStandings(tableKey = 'general') {
  const slugByTable = {
    'group-a': 'liga-profesional-apertura-2026-grupo-a',
    'group-b': 'liga-profesional-apertura-2026-grupo-b',
    general: 'liga-profesional-apertura-2026-general',
  };
  const table = getLatestStoredStandings(slugByTable[tableKey] ?? '');

  if (!table) {
    throw new Error('No hay tabla de Liga Profesional cargada para esa vista.');
  }

  return table;
}

export function getSerieAStandings() {
  const table = getLatestStoredStandings('serie-a-2025-2026');

  if (!table) {
    throw new Error('No hay tabla de Serie A cargada en la base.');
  }

  return table;
}

export async function getMatchDetail(matchId) {
  const match = db
    .prepare(
      `
        SELECT
          m.id,
          m.match_date_utc AS date,
          m.status,
          m.status_detail,
          m.stage,
          m.round_name,
          m.match_week,
          m.venue_name,
          m.venue_city,
          m.home_score,
          m.away_score,
          home.slug AS home_slug,
          home.name AS home_team,
          away.slug AS away_slug,
          away.name AS away_team,
          c.name AS competition_name,
          c.slug AS competition_slug,
          ms.source_name,
          ms.source_url
        FROM matches m
        JOIN teams home ON home.id = m.home_team_id
        JOIN teams away ON away.id = m.away_team_id
        LEFT JOIN competitions c ON c.id = m.competition_id
        LEFT JOIN match_sources ms
          ON ms.id = (
            SELECT inner_ms.id
            FROM match_sources inner_ms
            WHERE inner_ms.match_id = m.id
            ORDER BY inner_ms.id DESC
            LIMIT 1
          )
        WHERE m.id = ?
      `,
    )
    .get(matchId);

  if (!match) {
    return null;
  }

  const lineups = getLineupsForMatch(matchId);
  const stats = getStatsForMatch(matchId);
  const events = getEventsForMatch(matchId);
  const standings = await getStandingsForMatch(match);
  const competitionLogos = getCompetitionLogoMap(match.competition_slug);

  return {
    id: `db-${match.id}`,
    numericId: match.id,
    date: match.date,
    status: match.status,
    statusDetail: match.status_detail,
    stage: match.stage,
    competition: match.competition_name ?? match.round_name ?? 'Partido',
    roundName: match.round_name,
    week: match.match_week,
    venue: match.venue_name,
    city: match.venue_city,
    homeTeam: match.home_team,
    awayTeam: match.away_team,
    homeSlug: match.home_slug,
    awaySlug: match.away_slug,
    homeLogoUrl: competitionLogos.get(match.home_slug) ?? null,
    awayLogoUrl: competitionLogos.get(match.away_slug) ?? null,
    homeScore: match.home_score,
    awayScore: match.away_score,
    source: match.source_name ?? 'DB',
      sourceUrl: match.source_url ?? null,
      lineups,
      stats,
      events,
      standings,
    };
}

export function getLaLigaSeasonMatches() {
  return getSeasonMatchesByCompetition({
    competitionSlug: 'laliga-ea-sports-2025-2026',
    seasonSlug: 'temporada-2025-2026',
    sourceName: 'LALIGA',
    fallbackCompetitionName: 'LALIGA EA SPORTS',
  });
}

export function getPremierLeagueSeasonMatches() {
  return getSeasonMatchesByCompetition({
    competitionSlug: 'premier-league-2025-2026',
    seasonSlug: '2025',
    sourceName: 'PREMIER',
    fallbackCompetitionName: 'Premier League',
  });
}

export function getBundesligaSeasonMatches() {
  return getSeasonMatchesByCompetition({
    competitionSlug: 'bundesliga-2025-2026',
    seasonSlug: 'DFL-SEA-0001K9',
    sourceName: 'BUNDESLIGA',
    fallbackCompetitionName: 'Bundesliga',
  });
}

export function getArgentinaSeasonMatches() {
  return getSeasonMatchesByCompetition({
    competitionSlug: 'liga-profesional-apertura-2026',
    seasonSlug: '2026',
    sourceName: 'LPF',
    fallbackCompetitionName: 'Liga Profesional - Torneo Apertura',
  });
}

export function getSerieASeasonMatches() {
  return getSeasonMatchesByCompetition({
    competitionSlug: 'serie-a-2025-2026',
    seasonSlug: '2025/2026',
    sourceName: 'SERIEA',
    fallbackCompetitionName: 'Serie A',
  });
}

function getSeasonMatchesByCompetition({
  competitionSlug,
  seasonSlug,
  sourceName,
  fallbackCompetitionName,
}) {
  const competitionLogos = getCompetitionLogoMap(competitionSlug);

  return db
    .prepare(
      `
        SELECT
          m.id,
          m.match_date_utc AS date,
          m.status,
          m.status_detail,
          m.round_name,
          m.match_week,
          m.venue_name,
          m.venue_city,
          m.home_score,
          m.away_score,
          home.name AS home_team,
          home.slug AS home_slug,
          away.name AS away_team,
          away.slug AS away_slug,
          c.name AS competition_name,
          ms.source_url
        FROM matches m
        JOIN teams home ON home.id = m.home_team_id
        JOIN teams away ON away.id = m.away_team_id
        LEFT JOIN competitions c ON c.id = m.competition_id
        LEFT JOIN match_sources ms
          ON ms.id = (
            SELECT inner_ms.id
            FROM match_sources inner_ms
            WHERE inner_ms.match_id = m.id
              AND inner_ms.source_name = ?
            ORDER BY inner_ms.id DESC
            LIMIT 1
          )
        WHERE c.slug = ?
          AND m.season_slug = ?
        ORDER BY datetime(m.match_date_utc) ASC, m.id ASC
      `,
    )
    .all(sourceName, competitionSlug, seasonSlug)
    .map((match) => ({
      id: `db-${match.id}`,
      date: match.date,
      status: match.status,
      statusDetail: match.status_detail,
      roundName: match.round_name,
      week: match.match_week,
      venue: match.venue_name,
      city: match.venue_city,
      homeTeam: match.home_team,
      homeSlug: match.home_slug,
      homeLogoUrl: competitionLogos.get(match.home_slug) ?? null,
      awayTeam: match.away_team,
      awaySlug: match.away_slug,
      awayLogoUrl: competitionLogos.get(match.away_slug) ?? null,
      homeScore: match.home_score,
      awayScore: match.away_score,
      competition: match.competition_name ?? fallbackCompetitionName,
      sourceUrl: match.source_url ?? null,
    }));
}
