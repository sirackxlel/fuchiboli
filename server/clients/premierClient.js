const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

export const PREMIER_LEAGUE_COMPETITION_ID = '8';
export const PREMIER_LEAGUE_SEASON_ID = '2025';
export const PREMIER_LEAGUE_BASE_URL =
  'https://sdp-prem-prod.premier-league-prod.pulselive.com/api';
export const PREMIER_LEAGUE_SITE_BASE_URL = 'https://www.premierleague.com';

function getHeaders() {
  return {
    'user-agent': USER_AGENT,
    accept: 'application/json',
    'accept-language': 'en-GB,en;q=0.9',
  };
}

function slugify(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fetchPremierJson(path) {
  const response = await fetch(`${PREMIER_LEAGUE_BASE_URL}${path}`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Premier respondio con ${response.status} en ${path}.`);
  }

  return response.json();
}

export function buildPremierMatchSlug(homeTeamName, awayTeamName) {
  return `${slugify(homeTeamName)}-vs-${slugify(awayTeamName)}`;
}

export function buildPremierMatchPageUrl(match) {
  const slug = buildPremierMatchSlug(match.homeTeam?.name, match.awayTeam?.name);
  return `${PREMIER_LEAGUE_SITE_BASE_URL}/en/match/${match.matchId}/${slug}/overview`;
}

export async function fetchPremierMatchweekMatches(matchweekId) {
  return fetchPremierJson(
    `/v1/competitions/${PREMIER_LEAGUE_COMPETITION_ID}/seasons/${PREMIER_LEAGUE_SEASON_ID}/matchweeks/${matchweekId}/matches`,
  );
}

export async function fetchPremierMatch(matchId) {
  return fetchPremierJson(`/v2/matches/${matchId}`);
}

export async function fetchPremierMatchLineups(matchId) {
  return fetchPremierJson(`/v3/matches/${matchId}/lineups`);
}

export async function fetchPremierMatchStats(matchId) {
  return fetchPremierJson(`/v3/matches/${matchId}/stats`);
}

export async function fetchPremierMatchOfficials(matchId) {
  return fetchPremierJson(`/v1/matches/${matchId}/officials`);
}
