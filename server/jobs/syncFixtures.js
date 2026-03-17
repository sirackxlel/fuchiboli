import { getBetisMatches, getBocaMatches } from '../scrapers.js';
import {
  findMatchByCanonicalKey,
  getCompetitionBySlug,
  insertMatchSource,
  startScrapeRun,
  finishScrapeRun,
  upsertMatch,
} from '../repositories/matchesRepository.js';
import { getOrCreateTeam, getTeamBySlug } from '../repositories/teamsRepository.js';

function slugify(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildCanonicalKey(match) {
  return `${slugify(match.homeTeam)}_vs_${slugify(match.awayTeam)}_${match.date}`;
}

function resolveCompetitionSlug(teamSlug, competitionName) {
  const normalized = competitionName.toLowerCase();

  if (teamSlug === 'boca-juniors' && normalized.includes('liga profesional')) {
    return 'liga-profesional-2026';
  }

  if (teamSlug === 'real-betis' && normalized.includes('laliga')) {
    return 'laliga-ea-sports-2025-2026';
  }

  if (normalized.includes('europa league')) {
    return 'uefa-europa-league-2025-2026';
  }

  return null;
}

async function syncTeamFixtures(teamSlug, fetchMatches, sourceName) {
  const team = getTeamBySlug(teamSlug);

  if (!team) {
    throw new Error(`No existe el equipo ${teamSlug} en la base.`);
  }

  const run = startScrapeRun({
    sourceName,
    target: `${teamSlug}-fixtures`,
  });

  try {
    const scrapedMatches = await fetchMatches();
    let itemsSaved = 0;

    for (const scrapedMatch of scrapedMatches) {
      const canonicalKey = buildCanonicalKey(scrapedMatch);
      const competitionSlug = resolveCompetitionSlug(teamSlug, scrapedMatch.competition);
      const competition = competitionSlug
        ? getCompetitionBySlug(competitionSlug)
        : null;
      const existingMatch = findMatchByCanonicalKey(canonicalKey);
      const homeTeam = getOrCreateTeam({
        slug: slugify(scrapedMatch.homeTeam),
        name: scrapedMatch.homeTeam,
      });
      const awayTeam = getOrCreateTeam({
        slug: slugify(scrapedMatch.awayTeam),
        name: scrapedMatch.awayTeam,
      });

      const savedMatch = upsertMatch({
        canonicalKey,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        competitionId: competition?.id ?? null,
        matchDateUtc: scrapedMatch.date,
        status: 'scheduled',
        stage: scrapedMatch.stage ?? null,
        roundName: scrapedMatch.competition,
        venueName: scrapedMatch.venue,
        venueCity: scrapedMatch.city,
        sourcePriority: 1,
      });

      insertMatchSource({
        matchId: savedMatch.id,
        sourceName,
        sourceMatchId: scrapedMatch.id,
        sourceUrl: scrapedMatch.sourceUrl,
        rawPayload: JSON.stringify(scrapedMatch),
      });

      if (!existingMatch) {
        itemsSaved += 1;
      }
    }

    return finishScrapeRun(run.id, {
      status: 'success',
      itemsFound: scrapedMatches.length,
      itemsSaved,
    });
  } catch (error) {
    return finishScrapeRun(run.id, {
      status: 'error',
      errorMessage: error.message,
    });
  }
}

const results = await Promise.all([
  syncTeamFixtures('boca-juniors', getBocaMatches, 'ESPN'),
  syncTeamFixtures('real-betis', getBetisMatches, 'LALIGA'),
]);

console.log(JSON.stringify(results, null, 2));
