import {
  SERIE_A_SEASON_LABEL,
  fetchSerieASeasonMatches,
} from '../clients/serieAClient.js';
import {
  findMatchByCanonicalKey,
  finishScrapeRun,
  getOrCreateCompetition,
  insertMatchSource,
  startScrapeRun,
  upsertMatch,
} from '../repositories/matchesRepository.js';
import { getOrCreateTeam } from '../repositories/teamsRepository.js';

const COMPETITION_SLUG = 'serie-a-2025-2026';
const SOURCE_NAME = 'SERIEA';

function buildCanonicalKey(match) {
  return `${match.homeTeamSlug}_vs_${match.awayTeamSlug}_${match.matchDateUtc}`;
}

const competition = getOrCreateCompetition({
  slug: COMPETITION_SLUG,
  name: 'Serie A',
  country: 'Italia',
  seasonLabel: SERIE_A_SEASON_LABEL,
  competitionType: 'league',
});

const run = startScrapeRun({
  sourceName: SOURCE_NAME,
  target: 'serie-a-season-matches',
});

try {
  const matches = await fetchSerieASeasonMatches();
  let itemsFound = 0;
  let itemsSaved = 0;

  for (const match of matches) {
    itemsFound += 1;
    const canonicalKey = buildCanonicalKey(match);
    const existing = findMatchByCanonicalKey(canonicalKey);

    const homeTeam = getOrCreateTeam({
      slug: match.homeTeamSlug,
      name: match.homeTeamName,
      country: 'Italia',
    });
    const awayTeam = getOrCreateTeam({
      slug: match.awayTeamSlug,
      name: match.awayTeamName,
      country: 'Italia',
    });

    const savedMatch = upsertMatch({
      canonicalKey,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      competitionId: competition.id,
      matchDateUtc: match.matchDateUtc,
      status: match.status,
      statusDetail: match.statusDetail,
      stage: 'Regular Season',
      roundName: match.roundName,
      venueName: match.venueName,
      venueCity: match.venueCity,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      matchWeek: match.matchday,
      seasonSlug: SERIE_A_SEASON_LABEL,
      sourcePriority: 4,
    });

    insertMatchSource({
      matchId: savedMatch.id,
      sourceName: SOURCE_NAME,
      sourceMatchId: match.matchId,
      sourceUrl: match.sourceUrl,
      rawPayload: JSON.stringify(match),
    });

    if (!existing) {
      itemsSaved += 1;
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
