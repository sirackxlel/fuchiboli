import {
  SERIE_A_SEASON_LABEL,
  SERIE_A_STANDINGS_URL,
  fetchSerieAOverallStandings,
  slugifySerieATeam,
} from '../clients/serieAClient.js';
import { saveStandingsSnapshot } from '../repositories/standingsRepository.js';

function toStatNumber(team, statIds, fallback = 0) {
  const stats = team?.stats ?? [];

  for (const statId of statIds) {
    const rawValue = stats.find((entry) => entry?.statsId === statId)?.value ?? stats.find((entry) => entry?.statsId === statId)?.statsValue;

    if (rawValue != null && Number.isFinite(Number(rawValue))) {
      return Number(rawValue);
    }
  }

  return fallback;
}

const payload = await fetchSerieAOverallStandings();
const table = payload?.standings?.[0]?.teams ?? [];

const snapshot = saveStandingsSnapshot({
  sourceName: 'SERIEA',
  competitionSlug: 'serie-a-2025-2026',
  competitionName: payload?.competition?.officialName ?? payload?.competition?.name ?? 'Serie A',
  season: SERIE_A_SEASON_LABEL,
  sourceUrl: SERIE_A_STANDINGS_URL,
  entries: table.map((team) => {
    const teamName = team?.officialName ?? team?.shortName ?? '';
    const teamLogo = team?.imagery?.teamLogo
      ? `https://media-sdp.legaseriea.it/${team.imagery.teamLogo}`
      : null;

    return {
      teamSlug: slugifySerieATeam(teamName),
      teamName,
      teamShortName: team?.shortName ?? teamName,
      position: toStatNumber(team, ['rank']),
      points: toStatNumber(team, ['points']),
      played: toStatNumber(team, ['matches-played']),
      won: toStatNumber(team, ['win']),
      drawn: toStatNumber(team, ['draw']),
      lost: toStatNumber(team, ['lose']),
      goalsFor: toStatNumber(team, ['goals-for']),
      goalsAgainst: toStatNumber(team, ['goals-against']),
      goalDifference: toStatNumber(team, ['goal-difference']),
      qualification: null,
      logoClass: teamLogo,
    };
  }),
});

console.log(
  JSON.stringify(
    {
      snapshotId: snapshot.id,
      competition: 'Serie A',
      entries: table.length,
    },
    null,
    2,
  ),
);
