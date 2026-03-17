import {
  BUNDESLIGA_SEASON_ID,
  BUNDESLIGA_STANDINGS_URL,
  fetchBundesligaLiveTable,
} from '../clients/bundesligaClient.js';
import { finishScrapeRun, startScrapeRun } from '../repositories/matchesRepository.js';
import { saveStandingsSnapshot } from '../repositories/standingsRepository.js';

const SOURCE_NAME = 'BUNDESLIGA';
const COMPETITION_SLUG = 'bundesliga-2025-2026';

const run = startScrapeRun({
  sourceName: SOURCE_NAME,
  target: 'bundesliga-standings',
});

try {
  const standings = await fetchBundesligaLiveTable();

  const snapshot = saveStandingsSnapshot({
    sourceName: SOURCE_NAME,
    competitionSlug: COMPETITION_SLUG,
    competitionName: standings.competition?.name ?? 'Bundesliga',
    season: BUNDESLIGA_SEASON_ID,
    sourceUrl: BUNDESLIGA_STANDINGS_URL,
    entries: (standings.entries ?? []).map((entry) => ({
      teamSlug: entry.club?.slugifiedFull ?? entry.club?.slugifiedSmall,
      teamName: entry.club?.nameFull ?? entry.club?.nameShort,
      teamShortName: entry.club?.nameShort ?? null,
      position: entry.rank,
      points: entry.points,
      played: entry.gamesPlayed,
      won: entry.wins,
      drawn: entry.draws,
      lost: entry.losses,
      goalsFor: entry.goalsScored,
      goalsAgainst: entry.goalsAgainst,
      goalDifference: entry.goalDifference,
      qualification: entry.qualification ?? null,
      logoClass: entry.club?.logoUrl ?? null,
    })),
  });

  const result = finishScrapeRun(run.id, {
    status: 'success',
    itemsFound: standings.entries?.length ?? 0,
    itemsSaved: standings.entries?.length ?? 0,
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
