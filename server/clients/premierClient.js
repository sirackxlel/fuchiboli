import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

export const PREMIER_LEAGUE_COMPETITION_ID = '8';
export const PREMIER_LEAGUE_SEASON_ID = '2025';
export const PREMIER_LEAGUE_BASE_URL =
  'https://sdp-prem-prod.premier-league-prod.pulselive.com/api';
export const PREMIER_LEAGUE_SITE_BASE_URL = 'https://www.premierleague.com';
export const PREMIER_LEAGUE_TABLES_URL = 'https://www.premierleague.com/tables';

const EDGE_CANDIDATE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

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

function getBrowserPath() {
  const browserPath = EDGE_CANDIDATE_PATHS.find((candidate) => existsSync(candidate));

  if (!browserPath) {
    throw new Error('No encontramos Edge o Chrome para renderizar la tabla de Premier League.');
  }

  return browserPath;
}

function renderUrlWithBrowser(url) {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'fuchiboli-premier-edge-'));

  try {
    return execFileSync(
      getBrowserPath(),
      [
        '--headless=new',
        '--disable-gpu',
        '--disable-logging',
        '--log-level=3',
        '--disable-sync',
        '--disable-background-networking',
        '--disable-component-update',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${userDataDir}`,
        '--virtual-time-budget=6000',
        '--dump-dom',
        url,
      ],
      {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  } finally {
    rmSync(userDataDir, { force: true, recursive: true });
  }
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

export async function fetchPremierMatchEvents(matchId) {
  return fetchPremierJson(`/v1/matches/${matchId}/events`);
}

export async function fetchPremierMatchOfficials(matchId) {
  return fetchPremierJson(`/v1/matches/${matchId}/officials`);
}

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractText(block, pattern) {
  return normalizeWhitespace(block.match(pattern)?.[1] ?? '');
}

function parseQualification(rowClass) {
  if (rowClass.includes('standings-row--relegation')) {
    return 'Relegation';
  }

  return null;
}

function parsePremierStandingsRows(html) {
  const rows = [...html.matchAll(/<tr[^>]*data-testid="standingsRow"[\s\S]*?<\/tr>/g)];

  return rows.map((rowMatch) => {
    const rowHtml = rowMatch[0];
    const rowClass = rowHtml.match(/class="([^"]*standings-row[^"]*)"/)?.[1] ?? '';
    const teamName =
      extractText(rowHtml, /data-testid="standingsTeamName"[^>]*>([\s\S]*?)<\/span>/) ||
      extractText(rowHtml, /standings-row__team-name-long[^>]*>([\s\S]*?)<\/span>/);
    const position = Number(
      extractText(rowHtml, /data-testid="standingsRowPosition"[^>]*>([\s\S]*?)<\/div>/),
    );
    const played = Number(
      extractText(rowHtml, /data-testid="standingsRowStatPlayed"[^>]*>([\s\S]*?)<\/div>/),
    );
    const won = Number(
      extractText(rowHtml, /data-testid="standingsRowStatWon"[^>]*>([\s\S]*?)<\/div>/),
    );
    const drawn = Number(
      extractText(rowHtml, /data-testid="standingsRowStatDrawn"[^>]*>([\s\S]*?)<\/div>/),
    );
    const lost = Number(
      extractText(rowHtml, /data-testid="standingsRowStatLost"[^>]*>([\s\S]*?)<\/div>/),
    );
    const goalsFor = Number(
      extractText(rowHtml, /data-testid="standingsRowStatGoalFor"[^>]*>([\s\S]*?)<\/div>/),
    );
    const goalsAgainst = Number(
      extractText(rowHtml, /data-testid="standingsRowStatGoalAgainst"[^>]*>([\s\S]*?)<\/div>/),
    );
    const goalDifference = extractText(
      rowHtml,
      /data-testid="standingsRowStatGoalDifference"[^>]*>([\s\S]*?)<\/div>/,
    );
    const points = Number(
      extractText(rowHtml, /data-testid="standingsRowPoints"[^>]*>([\s\S]*?)<\/div>/),
    );
    const badgeUrl = rowHtml.match(/<img src="([^"]+premierleague25\/badges\/[^"]+\.svg)"/)?.[1] ?? null;

    return {
      teamName,
      teamSlug: slugify(teamName),
      position,
      points,
      played,
      won,
      drawn,
      lost,
      goalsFor,
      goalsAgainst,
      goalDifference,
      qualification: parseQualification(rowClass),
      logoClass: badgeUrl,
    };
  });
}

export async function fetchPremierLeagueStandings() {
  const html = renderUrlWithBrowser(PREMIER_LEAGUE_TABLES_URL);
  const entries = parsePremierStandingsRows(html);

  if (entries.length === 0) {
    throw new Error('No pudimos extraer la tabla de Premier League.');
  }

  return {
    competition: 'Premier League',
    competitionSlug: 'premier-league-2025-2026',
    season: '2025/2026',
    sourceUrl: PREMIER_LEAGUE_TABLES_URL,
    entries,
  };
}
