import {
  ARGENTINA_SEASON_ID,
  ARGENTINA_TOURNAMENT_URL,
  fetchArgentinaTournamentData,
} from '../clients/argentinaClient.js';
import {
  finishScrapeRun,
  getOrCreateCompetition,
  insertMatchSource,
  startScrapeRun,
  upsertMatch,
} from '../repositories/matchesRepository.js';
import { getOrCreateTeam } from '../repositories/teamsRepository.js';

const SOURCE_NAME = 'LPF';
const COMPETITION_SLUG = 'liga-profesional-apertura-2026';

const competition = getOrCreateCompetition({
  slug: COMPETITION_SLUG,
  name: 'Liga Profesional - Torneo Apertura',
  country: 'Argentina',
  seasonLabel: '2026',
  competitionType: 'league',
});

const run = startScrapeRun({
  sourceName: SOURCE_NAME,
  target: 'argentina-season-matches',
});

try {
  const { fixtures } = fetchArgentinaTournamentData();

  let itemsFound = 0;
  let itemsSaved = 0;

  for (const fixture of fixtures) {
    itemsFound += 1;

    const homeTeam = getOrCreateTeam({
      slug: fixture.homeTeam.teamSlug,
      name: fixture.homeTeam.teamName,
      country: 'Argentina',
    });
    const awayTeam = getOrCreateTeam({
      slug: fixture.awayTeam.teamSlug,
      name: fixture.awayTeam.teamName,
      country: 'Argentina',
    });

    const savedMatch = upsertMatch({
      canonicalKey: fixture.canonicalKey,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      competitionId: competition.id,
      matchDateUtc: fixture.matchDateUtc,
      status: fixture.status,
      statusDetail: fixture.statusDetail || null,
      stage: null,
      roundName: fixture.roundName,
      venueName: fixture.venueName || null,
      venueCity: fixture.venueCity || null,
      homeScore: fixture.homeScore,
      awayScore: fixture.awayScore,
      matchWeek: fixture.matchWeek,
      seasonSlug: ARGENTINA_SEASON_ID,
      sourcePriority: 4,
    });

    insertMatchSource({
      matchId: savedMatch.id,
      sourceName: SOURCE_NAME,
      sourceMatchId: fixture.sourceMatchId,
      sourceUrl: fixture.sourceUrl ?? ARGENTINA_TOURNAMENT_URL,
      rawPayload: fixture.rawPayload,
    });

    itemsSaved += 1;
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
