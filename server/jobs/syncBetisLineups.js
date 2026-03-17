import db from '../db.js';
import { fetchLaLigaLineups } from '../clients/laligaClient.js';
import {
  finishScrapeRun,
  startScrapeRun,
} from '../repositories/matchesRepository.js';
import { replaceLineupPlayers, upsertLineup, getOrCreatePlayer } from '../repositories/lineupsRepository.js';
import { getOrCreateTeam } from '../repositories/teamsRepository.js';

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizePlayer(entry) {
  return {
    name:
      entry.name ||
      entry.player_name ||
      entry.nickname ||
      entry.short_name ||
      null,
    shirtNumber: entry.number ?? entry.shirt_number ?? null,
    positionLabel: entry.position || entry.position_name || null,
  };
}

function pickTeamLineups(payload) {
  const root = payload.response ?? payload.data ?? payload;
  const candidates = [
    root?.home_team_lineups || root?.away_team_lineups
      ? {
          home: root.home_team_lineups,
          away: root.away_team_lineups,
        }
      : null,
    root?.lineups,
    root?.data?.lineups,
    root?.match?.lineups,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }

    if (candidate.home || candidate.away) {
      return [candidate.home, candidate.away].filter(Boolean);
    }
  }

  return [];
}

function extractTeamName(teamLineup) {
  return (
    teamLineup.team?.name ||
    teamLineup.team_name ||
    teamLineup.name ||
    null
  );
}

function extractFormation(teamLineup) {
  return teamLineup.formation || teamLineup.system || null;
}

function extractConfirmedFlag(teamLineup) {
  return teamLineup.confirmed || teamLineup.is_confirmed ? 1 : 0;
}

function extractPlayers(teamLineup) {
  const starters =
    teamLineup.starters ||
    teamLineup.starting_eleven ||
    teamLineup.startingXI ||
    [];
  const bench =
    teamLineup.substitutes ||
    teamLineup.bench ||
    teamLineup.replacements ||
    [];

  return {
    starters: starters.map(normalizePlayer).filter((player) => player.name),
    bench: bench.map(normalizePlayer).filter((player) => player.name),
  };
}

const betisMatches = db
  .prepare(
    `
      SELECT DISTINCT
        m.id,
        ms.source_url
      FROM matches m
      JOIN teams home ON home.id = m.home_team_id
      JOIN teams away ON away.id = m.away_team_id
      JOIN match_sources ms ON ms.match_id = m.id
      WHERE ms.source_name = 'LALIGA'
        AND (home.slug = 'real-betis' OR away.slug = 'real-betis')
      ORDER BY datetime(m.match_date_utc) ASC
    `,
  )
  .all();

const run = startScrapeRun({
  sourceName: 'LALIGA',
  target: 'real-betis-lineups',
});

try {
  let itemsSaved = 0;

  for (const match of betisMatches) {
    const { payload, endpoint } = await fetchLaLigaLineups(match.source_url);
    const teamLineups = pickTeamLineups(payload);

    if (teamLineups.length === 0) {
      continue;
    }

    for (const teamLineup of teamLineups) {
      const teamName = extractTeamName(teamLineup);
      if (!teamName) {
        continue;
      }

      const team = getOrCreateTeam({
        slug: slugify(teamName),
        name: teamName,
      });

      const lineup = upsertLineup({
        matchId: match.id,
        teamId: team.id,
        formation: extractFormation(teamLineup),
        isConfirmed: extractConfirmedFlag(teamLineup),
        sourceName: 'LALIGA',
        sourceUrl: endpoint,
      });

      const players = extractPlayers(teamLineup);
      const lineupPlayers = [
        ...players.starters.map((player) => ({
          ...player,
          role: 'starter',
        })),
        ...players.bench.map((player) => ({
          ...player,
          role: 'bench',
        })),
      ].map((player) => {
        const savedPlayer = getOrCreatePlayer({
          slug: slugify(player.name),
          name: player.name,
          teamId: team.id,
          position: player.positionLabel,
        });

        return {
          playerId: savedPlayer.id,
          role: player.role,
          shirtNumber: player.shirtNumber,
          positionLabel: player.positionLabel,
        };
      });

      replaceLineupPlayers(lineup.id, lineupPlayers);
      itemsSaved += 1;
    }
  }

  const result = finishScrapeRun(run.id, {
    status: 'success',
    itemsFound: betisMatches.length,
    itemsSaved,
  });

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const result = finishScrapeRun(run.id, {
    status: 'error',
    errorMessage: error.message,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
}
