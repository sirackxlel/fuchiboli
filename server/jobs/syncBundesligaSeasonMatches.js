import {
  BUNDESLIGA_COMPETITION_ID,
  BUNDESLIGA_SEASON_ID,
  fetchBundesligaSeasonMatches,
  normalizeBundesligaDate,
  slugifyBundesligaTeam,
} from '../clients/bundesligaClient.js';
import {
  finishScrapeRun,
  getOrCreateCompetition,
  insertMatchSource,
  startScrapeRun,
  upsertMatch,
} from '../repositories/matchesRepository.js';
import { getOrCreateTeam } from '../repositories/teamsRepository.js';

const COMPETITION_SLUG = 'bundesliga-2025-2026';
const SOURCE_NAME = 'BUNDESLIGA';

function normalizeStatus(status) {
  const normalized = String(status ?? '').toLowerCase();

  if (['final_whistle', 'after_extra_time', 'after_penalties', 'finished'].includes(normalized)) {
    return 'finished';
  }

  if (['pre_match', 'scheduled', 'fixture'].includes(normalized)) {
    return 'scheduled';
  }

  if (
    ['live', 'first_half', 'half_time', 'second_half', 'extra_time'].includes(normalized)
  ) {
    return 'live';
  }

  if (normalized.includes('postpon')) {
    return 'postponed';
  }

  if (normalized.includes('cancel')) {
    return 'cancelled';
  }

  return 'scheduled';
}

function buildCanonicalKey(homeTeamSlug, awayTeamSlug, kickoff) {
  return `${homeTeamSlug}_vs_${awayTeamSlug}_${kickoff}`;
}

const competition = getOrCreateCompetition({
  slug: COMPETITION_SLUG,
  name: 'Bundesliga',
  country: 'Alemania',
  seasonLabel: '2025/2026',
  competitionType: 'league',
});

const run = startScrapeRun({
  sourceName: SOURCE_NAME,
  target: 'bundesliga-season-matches',
});

try {
  const payload = await fetchBundesligaSeasonMatches();
  const matches = Object.values(payload ?? {});

  let itemsFound = 0;
  let itemsSaved = 0;

  for (const rawMatch of matches) {
    itemsFound += 1;

    const homeTeamSlug = slugifyBundesligaTeam(rawMatch.teams?.home?.nameFull);
    const awayTeamSlug = slugifyBundesligaTeam(rawMatch.teams?.away?.nameFull);
    const kickoff = normalizeBundesligaDate(rawMatch.kickOff ?? rawMatch.plannedKickOff);
    const plannedKickoff = normalizeBundesligaDate(rawMatch.plannedKickOff);

    const homeTeam = getOrCreateTeam({
      slug: homeTeamSlug,
      name: rawMatch.teams?.home?.nameFull ?? rawMatch.teams?.home?.nameShort,
      country: 'Alemania',
    });
    const awayTeam = getOrCreateTeam({
      slug: awayTeamSlug,
      name: rawMatch.teams?.away?.nameFull ?? rawMatch.teams?.away?.nameShort,
      country: 'Alemania',
    });

    const savedMatch = upsertMatch({
      canonicalKey: buildCanonicalKey(homeTeam.slug, awayTeam.slug, plannedKickoff ?? kickoff),
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      competitionId: competition.id,
      matchDateUtc: kickoff ?? plannedKickoff,
      status: normalizeStatus(rawMatch.matchStatus),
      statusDetail: rawMatch.matchStatus ?? null,
      stage: null,
      roundName: rawMatch.matchday ? `Jornada ${rawMatch.matchday}` : null,
      venueName: null,
      venueCity: null,
      homeScore: rawMatch.score?.home?.fulltime ?? rawMatch.score?.home?.live ?? null,
      awayScore: rawMatch.score?.away?.fulltime ?? rawMatch.score?.away?.live ?? null,
      matchWeek: rawMatch.matchday ?? null,
      seasonSlug: rawMatch.dflDatalibrarySeasonId ?? BUNDESLIGA_SEASON_ID,
      sourcePriority: 4,
    });

    insertMatchSource({
      matchId: savedMatch.id,
      sourceName: SOURCE_NAME,
      sourceMatchId: rawMatch.matchId ?? rawMatch.dflDatalibraryMatchId ?? null,
      sourceUrl: `${rawMatch.matchId ?? rawMatch.dflDatalibraryMatchId ?? ''}`.startsWith('DFL-MAT-')
        ? `https://wapp.bapi.bundesliga.com/all/${BUNDESLIGA_COMPETITION_ID}/seasons/${BUNDESLIGA_SEASON_ID}/matches.json`
        : null,
      rawPayload: JSON.stringify(rawMatch),
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
