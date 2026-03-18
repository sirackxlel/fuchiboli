import { fetchPremierLeagueStandings } from '../clients/premierClient.js';
import { saveStandingsSnapshot } from '../repositories/standingsRepository.js';

const standings = await fetchPremierLeagueStandings();

const snapshot = saveStandingsSnapshot({
  sourceName: 'PREMIER',
  competitionSlug: standings.competitionSlug,
  competitionName: standings.competition,
  season: standings.season,
  sourceUrl: standings.sourceUrl,
  entries: standings.entries.map((entry) => ({
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
    qualification: entry.qualification,
    logoClass: entry.logoClass,
  })),
});

console.log(
  JSON.stringify(
    {
      snapshotId: snapshot.id,
      competition: standings.competition,
      entries: standings.entries.length,
    },
    null,
    2,
  ),
);
