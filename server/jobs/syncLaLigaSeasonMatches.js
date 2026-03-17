import { fetchLaLigaMatchesByWeek } from '../clients/laligaClient.js';
import {
  findMatchByCanonicalKey,
  finishScrapeRun,
  getCompetitionBySlug,
  insertMatchSource,
  startScrapeRun,
  upsertMatch,
} from '../repositories/matchesRepository.js';
import { getOrCreateTeam } from '../repositories/teamsRepository.js';

const TOTAL_WEEKS = 38;
const COMPETITION_SLUG = 'laliga-ea-sports-2025-2026';

function normalizeStatus(status) {
  const normalized = String(status ?? '').toLowerCase();

  if (['fulltime', 'afterextratime', 'afterpenalties', 'finished'].includes(normalized)) {
    return 'finished';
  }

  if (['scheduled', 'notstarted', 'fixture'].includes(normalized)) {
    return 'scheduled';
  }

  if (['inplay', 'live', 'halftime', 'secondhalf'].includes(normalized)) {
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

function buildCanonicalKey(match) {
  return `${match.home_team.slug}_vs_${match.away_team.slug}_${match.date}`;
}

function buildSourceUrl(match) {
  return `https://www.laliga.com/partido/${match.slug}`;
}

const competition = getCompetitionBySlug(COMPETITION_SLUG);

if (!competition) {
  throw new Error(`No existe la competencia ${COMPETITION_SLUG} en la base.`);
}

const run = startScrapeRun({
  sourceName: 'LALIGA',
  target: 'laliga-season-matches',
});

try {
  let itemsFound = 0;
  let itemsSaved = 0;
  const seenMatchIds = new Set();

  for (let week = 1; week <= TOTAL_WEEKS; week += 1) {
    const { payload } = await fetchLaLigaMatchesByWeek({ week });
    const matches = payload?.matches ?? [];

    for (const rawMatch of matches) {
      if (seenMatchIds.has(rawMatch.id)) {
        continue;
      }

      seenMatchIds.add(rawMatch.id);
      itemsFound += 1;

      const homeTeam = getOrCreateTeam({
        slug: rawMatch.home_team.slug,
        name: rawMatch.home_team.nickname ?? rawMatch.home_team.name,
        country: 'España',
      });
      const awayTeam = getOrCreateTeam({
        slug: rawMatch.away_team.slug,
        name: rawMatch.away_team.nickname ?? rawMatch.away_team.name,
        country: 'España',
      });
      const canonicalKey = buildCanonicalKey(rawMatch);
      const existing = findMatchByCanonicalKey(canonicalKey);

      const savedMatch = upsertMatch({
        canonicalKey,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        competitionId: competition.id,
        matchDateUtc: rawMatch.date,
        status: normalizeStatus(rawMatch.status),
        statusDetail: rawMatch.status,
        stage: null,
        roundName: rawMatch.gameweek?.name ?? `Jornada ${rawMatch.gameweek?.week ?? ''}`.trim(),
        venueName: rawMatch.venue?.name ?? null,
        venueCity: rawMatch.venue?.city ?? null,
        homeScore: rawMatch.home_score ?? null,
        awayScore: rawMatch.away_score ?? null,
        matchWeek: rawMatch.gameweek?.week ?? null,
        seasonSlug: rawMatch.season?.slug ?? null,
        sourcePriority: 2,
      });

      insertMatchSource({
        matchId: savedMatch.id,
        sourceName: 'LALIGA',
        sourceMatchId: String(rawMatch.id),
        sourceUrl: buildSourceUrl(rawMatch),
        rawPayload: JSON.stringify(rawMatch),
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
