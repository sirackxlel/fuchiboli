import {
  ARGENTINA_SEASON_ID,
  ARGENTINA_TOURNAMENT_URL,
  fetchArgentinaTournamentData,
} from '../clients/argentinaClient.js';
import { finishScrapeRun, startScrapeRun } from '../repositories/matchesRepository.js';
import { saveStandingsSnapshot } from '../repositories/standingsRepository.js';

const SOURCE_NAME = 'LPF';
const STANDINGS_TABLES = [
  {
    key: 'groupA',
    slug: 'liga-profesional-apertura-2026-grupo-a',
    name: 'Liga Profesional - Torneo Apertura 2026 - Grupo A',
    qualification: 'Grupo A',
  },
  {
    key: 'groupB',
    slug: 'liga-profesional-apertura-2026-grupo-b',
    name: 'Liga Profesional - Torneo Apertura 2026 - Grupo B',
    qualification: 'Grupo B',
  },
  {
    key: 'general',
    slug: 'liga-profesional-apertura-2026-general',
    name: 'Liga Profesional - Torneo Apertura 2026 - Tabla General',
    qualification: null,
  },
];

const run = startScrapeRun({
  sourceName: SOURCE_NAME,
  target: 'argentina-standings',
});

try {
  const { standings } = fetchArgentinaTournamentData();
  let itemsFound = 0;
  let itemsSaved = 0;

  for (const table of STANDINGS_TABLES) {
    const entries = standings[table.key] ?? [];
    itemsFound += entries.length;

    saveStandingsSnapshot({
      sourceName: SOURCE_NAME,
      competitionSlug: table.slug,
      competitionName: table.name,
      season: ARGENTINA_SEASON_ID,
      sourceUrl: ARGENTINA_TOURNAMENT_URL,
      entries: entries.map((entry) => ({
        teamSlug: entry.teamSlug,
        teamName: entry.teamName,
        teamShortName: entry.teamName,
        position: entry.position,
        points: entry.points,
        played: entry.played,
        won: entry.won,
        drawn: entry.drawn,
        lost: entry.lost,
        goalsFor: entry.goalsFor,
        goalsAgainst: entry.goalsAgainst,
        goalDifference: entry.goalDifference,
        qualification: table.qualification,
        logoClass: entry.logoUrl ?? null,
      })),
    });

    itemsSaved += entries.length;
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
