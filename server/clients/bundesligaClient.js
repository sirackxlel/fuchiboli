const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

export const BUNDESLIGA_COMPETITION_ID = 'DFL-COM-000001';
export const BUNDESLIGA_SEASON_ID = 'DFL-SEA-0001K9';
export const BUNDESLIGA_API_KEY = '60ETUJ4j5YagIHdu-PROD';
export const BUNDESLIGA_BASE_URL = 'https://wapp.bapi.bundesliga.com';
export const BUNDESLIGA_STANDINGS_URL =
  'https://www.bundesliga.com/es/bundesliga/clasificacion?view=full';
export const BUNDESLIGA_SITE_BASE_URL = 'https://www.bundesliga.com/es/bundesliga/partidos';

function getJsonHeaders(extraHeaders = {}) {
  return {
    'user-agent': USER_AGENT,
    accept: 'application/json',
    'accept-language': 'es-AR,es;q=0.9,en;q=0.8',
    ...extraHeaders,
  };
}

async function fetchBundesligaJson(path, extraHeaders = {}) {
  const response = await fetch(`${BUNDESLIGA_BASE_URL}${path}`, {
    headers: getJsonHeaders(extraHeaders),
  });

  if (!response.ok) {
    throw new Error(`Bundesliga respondio con ${response.status} en ${path}.`);
  }

  return response.json();
}

export function transliterateGerman(value) {
  return String(value ?? '')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

export function slugifyBundesligaTeam(value) {
  return transliterateGerman(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeBundesligaDate(rawValue) {
  if (!rawValue) {
    return null;
  }

  return rawValue.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
}

export async function fetchBundesligaSeasonMatches() {
  return fetchBundesligaJson(
    `/all/${BUNDESLIGA_COMPETITION_ID}/seasons/${BUNDESLIGA_SEASON_ID}/matches.json`,
    {
      'x-api-key': BUNDESLIGA_API_KEY,
    },
  );
}

export async function fetchBundesligaLiveTable() {
  return fetchBundesligaJson(`/es/${BUNDESLIGA_COMPETITION_ID}/liveTable.json?donotcache`);
}

function extractNgState(html) {
  const match = html.match(/<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/);

  if (!match) {
    throw new Error('Bundesliga no incluyo ng-state en la pagina.');
  }

  return JSON.parse(match[1]);
}

function getStateEntries(state) {
  return Object.values(state ?? {});
}

function findMatchPayload(state) {
  for (const entry of getStateEntries(state)) {
    for (const candidate of Object.values(entry?.b ?? {})) {
      if (candidate?.matchId && candidate?.liveBlogEntries) {
        return candidate;
      }
    }
  }

  return null;
}

function findLineupPayload(state) {
  return (
    getStateEntries(state)
      .map((entry) => entry?.b)
      .find((body) => body?.home?.startingEleven?.persons && body?.away?.startingEleven?.persons) ??
    null
  );
}

function findStatsPayload(state) {
  return (
    getStateEntries(state)
      .map((entry) => entry?.b)
      .find((body) => body?.ballPossessionRatio && body?.cornerKicks && body?.fouls) ?? null
  );
}

function countCards(matchPayload, entryType, side) {
  return Object.values(matchPayload?.liveBlogEntries ?? {}).filter(
    (entry) => entry?.entryType === entryType && entry?.side === side,
  ).length;
}

function normalizeLineupPersons(persons, role) {
  return (persons ?? [])
    .map((person) => ({
      role,
      name: person?.name ?? null,
      shirtNumber: person?.shirtNumber ?? null,
      positionLabel: person?.role ?? null,
    }))
    .filter((person) => person.name);
}

function mapBundesligaLineups(lineupPayload) {
  return {
    home: {
      formation: lineupPayload?.home?.startingEleven?.tacticalFormationName ?? null,
      starters: normalizeLineupPersons(lineupPayload?.home?.startingEleven?.persons, 'starter'),
      bench: normalizeLineupPersons(lineupPayload?.home?.bench?.persons, 'bench'),
    },
    away: {
      formation: lineupPayload?.away?.startingEleven?.tacticalFormationName ?? null,
      starters: normalizeLineupPersons(lineupPayload?.away?.startingEleven?.persons, 'starter'),
      bench: normalizeLineupPersons(lineupPayload?.away?.bench?.persons, 'bench'),
    },
  };
}

function mapBundesligaStats(statsPayload, matchPayload) {
  const homeGoals = matchPayload?.score?.home?.fulltime ?? null;
  const awayGoals = matchPayload?.score?.away?.fulltime ?? null;
  const homeYellow = countCards(matchPayload, 'yellowCard', 'home');
  const awayYellow = countCards(matchPayload, 'yellowCard', 'away');
  const homeRed = countCards(matchPayload, 'redCard', 'home');
  const awayRed = countCards(matchPayload, 'redCard', 'away');

  return {
    home: {
      possessionPercentage: statsPayload?.ballPossessionRatio?.homeValue ?? null,
      totalScoringAtt:
        Number(statsPayload?.shotsOnTarget?.homeValue ?? 0) +
        Number(statsPayload?.shotsOffTarget?.homeValue ?? 0),
      fkFoulLost: statsPayload?.fouls?.homeValue ?? null,
      totalOffside: statsPayload?.offsides?.homeValue ?? null,
      cornerTaken: statsPayload?.cornerKicks?.homeValue ?? null,
      totalYelCard: homeYellow,
      totalRedCard: homeRed,
      goals: homeGoals,
      shotsOnTarget: statsPayload?.shotsOnTarget?.homeValue ?? null,
      shotsOffTarget: statsPayload?.shotsOffTarget?.homeValue ?? null,
      passAccuracy: statsPayload?.passAccuracy?.homeValue ?? null,
      passes: statsPayload?.passes?.homeValue ?? null,
      xGoals: statsPayload?.xGoals?.homeValue ?? statsPayload?.xgoals?.homeValue ?? null,
    },
    away: {
      possessionPercentage: statsPayload?.ballPossessionRatio?.awayValue ?? null,
      totalScoringAtt:
        Number(statsPayload?.shotsOnTarget?.awayValue ?? 0) +
        Number(statsPayload?.shotsOffTarget?.awayValue ?? 0),
      fkFoulLost: statsPayload?.fouls?.awayValue ?? null,
      totalOffside: statsPayload?.offsides?.awayValue ?? null,
      cornerTaken: statsPayload?.cornerKicks?.awayValue ?? null,
      totalYelCard: awayYellow,
      totalRedCard: awayRed,
      goals: awayGoals,
      shotsOnTarget: statsPayload?.shotsOnTarget?.awayValue ?? null,
      shotsOffTarget: statsPayload?.shotsOffTarget?.awayValue ?? null,
      passAccuracy: statsPayload?.passAccuracy?.awayValue ?? null,
      passes: statsPayload?.passes?.awayValue ?? null,
      xGoals: statsPayload?.xGoals?.awayValue ?? statsPayload?.xgoals?.awayValue ?? null,
    },
  };
}

async function fetchBundesligaPage(path) {
  const response = await fetch(path, {
    headers: getJsonHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Bundesliga respondio con ${response.status} en ${path}.`);
  }

  return response.text();
}

export function buildBundesligaMatchPageUrl({ matchWeek, slugLong, tab }) {
  return `${BUNDESLIGA_SITE_BASE_URL}/2025-2026/${matchWeek}/${slugLong}/${tab}`;
}

export async function fetchBundesligaMatchPageData({ matchWeek, slugLong }) {
  const lineupUrl = buildBundesligaMatchPageUrl({ matchWeek, slugLong, tab: 'lineup' });
  const statsUrl = buildBundesligaMatchPageUrl({ matchWeek, slugLong, tab: 'stats' });

  const [lineupHtml, statsHtml] = await Promise.all([
    fetchBundesligaPage(lineupUrl),
    fetchBundesligaPage(statsUrl),
  ]);

  const lineupState = extractNgState(lineupHtml);
  const statsState = extractNgState(statsHtml);
  const lineupPayload = findLineupPayload(lineupState);
  const statsPayload = findStatsPayload(statsState);
  const matchPayload = findMatchPayload(statsState) ?? findMatchPayload(lineupState);

  if (!lineupPayload) {
    throw new Error(`No pudimos encontrar las alineaciones para ${slugLong}.`);
  }

  if (!matchPayload) {
    throw new Error(`No pudimos encontrar los datos del partido para ${slugLong}.`);
  }

  return {
    lineups: mapBundesligaLineups(lineupPayload),
    stats: statsPayload ? mapBundesligaStats(statsPayload, matchPayload) : null,
    lineupUrl,
    statsUrl,
  };
}
