const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
const LALIGA_STANDINGS_URL = 'https://www.laliga.com/laliga-easports/clasificacion';
const LALIGA_CALENDAR_URL = 'https://www.laliga.com/laliga-easports/calendario';
const STANDINGS_CACHE_TTL_MS = 10 * 60 * 1000;
export const LALIGA_SHIELD_SPRITE_STYLESHEET =
  'https://assets.laliga.com/assets/sprites/shield-sprite.css?20251002124452881729';

let standingsCache = {
  expiresAt: 0,
  data: null,
};
let runtimeConfigCache = null;

function getHeaders() {
  return {
    'user-agent': USER_AGENT,
    'accept-language': 'es-AR,es;q=0.9,en;q=0.8',
  };
}

export async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error(`LaLiga respondio con ${response.status}.`);
  }

  return response.text();
}

export function extractRuntimeConfig(html) {
  const match = html.match(/"runtimeConfig":(\{[\s\S]*?\}),"isFallback":/);

  if (!match) {
    throw new Error('No se encontro runtimeConfig en la pagina de LaLiga.');
  }

  return JSON.parse(match[1]);
}

export async function getLaLigaRuntimeConfig() {
  if (runtimeConfigCache) {
    return runtimeConfigCache;
  }

  const html = await fetchHtml(LALIGA_CALENDAR_URL);
  runtimeConfigCache = extractRuntimeConfig(html);
  return runtimeConfigCache;
}

export function extractNextData(html) {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );

  if (!match) {
    throw new Error('No se encontro __NEXT_DATA__ en la pagina de LaLiga.');
  }

  return JSON.parse(match[1]);
}

export function extractLaLigaWebviewSubscription(html) {
  const runtimeConfig = extractRuntimeConfig(html);
  const key = runtimeConfig.webviewSubscription;

  if (!key) {
    throw new Error('No se encontro la webviewSubscription de LaLiga.');
  }

  return key;
}

export function extractLaLigaMatchId(html) {
  const match = html.match(/"id":(\d+),"name":"Temporada .*?","slug":"temporada-/);

  if (!match) {
    throw new Error('No se encontro el id numerico del partido de LaLiga.');
  }

  return match[1];
}

export async function fetchLaLigaLineups(matchUrl) {
  const html = await fetchHtml(matchUrl);
  const subscriptionKey = extractLaLigaWebviewSubscription(html);
  const matchId = extractLaLigaMatchId(html);

  const endpoint = new URL(`https://apim.laliga.com/webview/api/web/matches/${matchId}/lineups`);
  endpoint.searchParams.set('contentLanguage', 'es');
  endpoint.searchParams.set('subscription-key', subscriptionKey);

  const response = await fetch(endpoint, {
    headers: {
      ...getHeaders(),
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`LaLiga lineups respondio con ${response.status}.`);
  }

  return {
    matchId,
    subscriptionKey,
    payload: await response.json(),
    endpoint: endpoint.toString(),
  };
}

export async function fetchLaLigaMatchPageData(matchUrl) {
  const html = await fetchHtml(matchUrl);
  const nextData = extractNextData(html);
  const pageProps = nextData?.props?.pageProps ?? {};

  return {
    matchUrl,
    pageProps,
    lineups: pageProps?.data?.lineups ?? null,
    stats: pageProps?.data?.stats ?? null,
  };
}

export async function fetchLaLigaMatchesByWeek({
  subscriptionSlug = 'laliga-easports-2025',
  week,
  limit = 100,
} = {}) {
  if (!week) {
    throw new Error('La jornada es obligatoria para consultar partidos de LaLiga.');
  }

  const runtimeConfig = await getLaLigaRuntimeConfig();
  const subscriptionKey = runtimeConfig.backendSubscription;

  if (!subscriptionKey) {
    throw new Error('No se encontro la backendSubscription de LaLiga.');
  }

  const endpoint = new URL('https://apim.laliga.com/public-service/api/v1/matches');
  endpoint.searchParams.set('subscriptionSlug', subscriptionSlug);
  endpoint.searchParams.set('week', String(week));
  endpoint.searchParams.set('limit', String(limit));
  endpoint.searchParams.set('orderField', 'date');
  endpoint.searchParams.set('orderType', 'asc');
  endpoint.searchParams.set('contentLanguage', 'es');
  endpoint.searchParams.set('countryCode', 'ES');
  endpoint.searchParams.set('subscription-key', subscriptionKey);

  const response = await fetch(endpoint, {
    headers: {
      ...getHeaders(),
      accept: 'application/json, text/plain, */*',
      'content-language': 'es',
      'country-code': 'ES',
      'ocp-apim-subscription-key': subscriptionKey,
      origin: 'https://www.laliga.com',
      referer: 'https://www.laliga.com/',
    },
  });

  if (!response.ok) {
    throw new Error(`LaLiga matches respondio con ${response.status}.`);
  }

  const payload = await response.json();

  return {
    endpoint: endpoint.toString(),
    payload,
  };
}

function mapStanding(entry) {
  return {
    position: entry.position,
    points: entry.points,
    played: entry.played,
    won: entry.won,
    drawn: entry.drawn,
    lost: entry.lost,
    goalsFor: entry.goals_for,
    goalsAgainst: entry.goals_against,
    goalDifference: entry.goal_difference,
    previousPosition: entry.previous_position,
    movement: entry.difference_position,
    qualification: entry.qualify?.shortname ?? entry.qualify?.name ?? null,
    team: {
      id: entry.team?.id ?? null,
      slug: entry.team?.slug ?? null,
      name: entry.team?.nickname ?? entry.team?.name ?? null,
      shortName: entry.team?.shortname ?? null,
      logoClass: entry.team?.slug ? `shield-sprite xs ${entry.team.slug}` : null,
    },
  };
}

export async function fetchLaLigaStandings({ forceRefresh = false } = {}) {
  if (!forceRefresh && standingsCache.data && standingsCache.expiresAt > Date.now()) {
    return standingsCache.data;
  }

  const html = await fetchHtml(LALIGA_STANDINGS_URL);
  const nextData = extractNextData(html);
  const standings =
    nextData?.props?.pageProps?.standings?.filter(
      (entry) => entry?.team?.slug && typeof entry.position === 'number',
    ) ?? [];

  if (standings.length === 0) {
    throw new Error('No se encontro la tabla de posiciones dentro de LaLiga.');
  }

  const data = {
    competition:
      nextData?.props?.pageProps?.subscription?.slug === 'laliga-easports-2025'
        ? 'LALIGA EA SPORTS'
        : 'LaLiga',
    competitionSlug:
      nextData?.props?.pageProps?.subscription?.slug ?? 'laliga-easports',
    season: nextData?.props?.pageProps?.season ?? null,
    updatedAt: new Date().toISOString(),
    sourceUrl: LALIGA_STANDINGS_URL,
    table: standings.map(mapStanding),
  };

  standingsCache = {
    expiresAt: Date.now() + STANDINGS_CACHE_TTL_MS,
    data,
  };

  return data;
}
