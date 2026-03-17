import {
  PREMIER_LEAGUE_COMPETITION_ID,
  PREMIER_LEAGUE_SEASON_ID,
  buildPremierMatchPageUrl,
  fetchPremierMatchweekMatches,
} from '../clients/premierClient.js';
import {
  findMatchByCanonicalKey,
  finishScrapeRun,
  getOrCreateCompetition,
  insertMatchSource,
  startScrapeRun,
  upsertMatch,
} from '../repositories/matchesRepository.js';
import { getOrCreateTeam } from '../repositories/teamsRepository.js';

const TOTAL_WEEKS = 38;
const COMPETITION_SLUG = 'premier-league-2025-2026';

function slugify(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeKickoff(rawKickoff) {
  if (!rawKickoff) {
    return null;
  }

  return rawKickoff.replace(' ', 'T') + 'Z';
}

function normalizeStatus(period) {
  const normalized = String(period ?? '').toLowerCase();

  if (['prematch', 'scheduled', 'fixture'].includes(normalized)) {
    return 'scheduled';
  }

  if (['firsthalf', 'secondhalf', 'halftime', 'extratime', 'playing'].includes(normalized)) {
    return 'live';
  }

  if (['fulltime', 'afterextratime', 'afterpenalties'].includes(normalized)) {
    return 'finished';
  }

  if (normalized.includes('postpon')) {
    return 'postponed';
  }

  if (normalized.includes('cancel')) {
    return 'cancelled';
  }

  return 'scheduled';
}

function buildCanonicalKey(match, homeTeamSlug, awayTeamSlug, kickoff) {
  return `${homeTeamSlug}_vs_${awayTeamSlug}_${kickoff}`;
}

const competition = getOrCreateCompetition({
  slug: COMPETITION_SLUG,
  name: 'Premier League',
  country: 'Inglaterra',
  seasonLabel: '2025/2026',
  competitionType: 'league',
});

const run = startScrapeRun({
  sourceName: 'PREMIER',
  target: 'premier-league-season-matches',
});

try {
  let itemsFound = 0;
  let itemsSaved = 0;
  const seenMatchIds = new Set();

  for (let matchweek = 1; matchweek <= TOTAL_WEEKS; matchweek += 1) {
    const payload = await fetchPremierMatchweekMatches(matchweek);
    const matches = payload?.data ?? [];

    for (const rawMatch of matches) {
      if (seenMatchIds.has(rawMatch.matchId)) {
        continue;
      }

      seenMatchIds.add(rawMatch.matchId);
      itemsFound += 1;

      const homeTeamSlug = slugify(rawMatch.homeTeam?.name);
      const awayTeamSlug = slugify(rawMatch.awayTeam?.name);
      const kickoff = normalizeKickoff(rawMatch.kickoff);

      const homeTeam = getOrCreateTeam({
        slug: homeTeamSlug,
        name: rawMatch.homeTeam?.name,
        country: 'Inglaterra',
      });
      const awayTeam = getOrCreateTeam({
        slug: awayTeamSlug,
        name: rawMatch.awayTeam?.name,
        country: 'Inglaterra',
      });

      const canonicalKey = buildCanonicalKey(rawMatch, homeTeam.slug, awayTeam.slug, kickoff);
      const existing = findMatchByCanonicalKey(canonicalKey);

      const savedMatch = upsertMatch({
        canonicalKey,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        competitionId: competition.id,
        matchDateUtc: kickoff,
        status: normalizeStatus(rawMatch.period),
        statusDetail: rawMatch.period ?? null,
        stage: null,
        roundName: `Matchweek ${matchweek}`,
        venueName: rawMatch.ground ?? null,
        venueCity: rawMatch.ground?.split(', ').slice(1).join(', ') || null,
        homeScore: rawMatch.homeTeam?.score ?? null,
        awayScore: rawMatch.awayTeam?.score ?? null,
        matchWeek: matchweek,
        seasonSlug: PREMIER_LEAGUE_SEASON_ID,
        sourcePriority: 3,
      });

      insertMatchSource({
        matchId: savedMatch.id,
        sourceName: 'PREMIER',
        sourceMatchId: String(rawMatch.matchId),
        sourceUrl: buildPremierMatchPageUrl({
          ...rawMatch,
          matchId: rawMatch.matchId,
        }),
        rawPayload: JSON.stringify({
          competitionId: PREMIER_LEAGUE_COMPETITION_ID,
          seasonId: PREMIER_LEAGUE_SEASON_ID,
          matchweekId: matchweek,
          match: rawMatch,
        }),
      });

      if (!existing) {
        itemsSaved += 1;
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
