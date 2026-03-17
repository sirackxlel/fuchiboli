import express from 'express';
import {
  getBundesligaSeasonMatches,
  getBundesligaStandings,
  getLaLigaStandings,
  getLaLigaSeasonMatches,
  getMatchDetail,
  getPremierLeagueSeasonMatches,
  getUpcomingMatchesForTeam,
  getUpcomingMatchesGrouped,
  resolveTeamSlug,
} from './repositories/readRepository.js';

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.get('/api/health', (_request, response) => {
  response.json({ ok: true });
});

app.get('/api/matches/:teamKey', (request, response) => {
  try {
    const teamSlug = resolveTeamSlug(request.params.teamKey);

    if (!teamSlug) {
      response.status(404).json({
        error: 'Equipo no encontrado.',
      });
      return;
    }

    response.json({
      team: teamSlug,
      matches: getUpcomingMatchesForTeam(teamSlug),
    });
  } catch (error) {
    response.status(500).json({
      error: 'No pudimos obtener los partidos desde la base.',
      detail: error.message,
    });
  }
});

app.get('/api/matches', (_request, response) => {
  try {
    response.json(getUpcomingMatchesGrouped());
  } catch (error) {
    response.status(500).json({
      error: 'No pudimos obtener el calendario desde la base.',
      detail: error.message,
    });
  }
});

app.get('/api/standings/laliga', async (_request, response) => {
  try {
    response.json(await getLaLigaStandings());
  } catch (error) {
    response.status(500).json({
      error: 'No pudimos obtener la tabla de LALIGA.',
      detail: error.message,
    });
  }
});

app.get('/api/standings/bundesliga', (_request, response) => {
  try {
    response.json(getBundesligaStandings());
  } catch (error) {
    response.status(500).json({
      error: 'No pudimos obtener la tabla de Bundesliga.',
      detail: error.message,
    });
  }
});

app.get('/api/season/laliga/matches', (_request, response) => {
  try {
    response.json({
      competition: 'LALIGA EA SPORTS',
      season: '2025/2026',
      matches: getLaLigaSeasonMatches(),
    });
  } catch (error) {
    response.status(500).json({
      error: 'No pudimos obtener el calendario completo de LaLiga.',
      detail: error.message,
    });
  }
});

app.get('/api/season/premier/matches', (_request, response) => {
  try {
    response.json({
      competition: 'Premier League',
      season: '2025/2026',
      matches: getPremierLeagueSeasonMatches(),
    });
  } catch (error) {
    response.status(500).json({
      error: 'No pudimos obtener el calendario completo de Premier League.',
      detail: error.message,
    });
  }
});

app.get('/api/season/bundesliga/matches', (_request, response) => {
  try {
    response.json({
      competition: 'Bundesliga',
      season: '2025/2026',
      matches: getBundesligaSeasonMatches(),
    });
  } catch (error) {
    response.status(500).json({
      error: 'No pudimos obtener el calendario completo de Bundesliga.',
      detail: error.message,
    });
  }
});

app.get('/api/match/:matchId', async (request, response) => {
  try {
    const numericId = Number(String(request.params.matchId).replace(/^db-/, ''));
    const detail = await getMatchDetail(numericId);

    if (!detail) {
      response.status(404).json({
        error: 'Partido no encontrado.',
      });
      return;
    }

    response.json(detail);
  } catch (error) {
    response.status(500).json({
      error: 'No pudimos obtener el detalle del partido.',
      detail: error.message,
    });
  }
});

app.listen(port, () => {
  console.log(`SQLite API running on http://localhost:${port}`);
});
