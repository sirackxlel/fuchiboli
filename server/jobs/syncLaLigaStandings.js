import { fetchLaLigaStandings } from '../clients/laligaClient.js';
import { finishScrapeRun, startScrapeRun } from '../repositories/matchesRepository.js';
import { saveStandingsSnapshot } from '../repositories/standingsRepository.js';

const run = startScrapeRun({
  sourceName: 'LALIGA',
  target: 'laliga-standings',
});

try {
  const standings = await fetchLaLigaStandings({ forceRefresh: true });

  const snapshot = saveStandingsSnapshot({
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

  const result = finishScrapeRun(run.id, {
    status: 'success',
    itemsFound: standings.table.length,
    itemsSaved: standings.table.length,
  });

  console.log(
    JSON.stringify(
      {
        snapshot,
        run: result,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const result = finishScrapeRun(run.id, {
    status: 'error',
    errorMessage: error.message,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
}
