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
    comments: pageProps?.data?.comments ?? [],
  };
}

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveCommentTeamId(content, teamsByName) {
  const normalizedContent = normalizeName(content);

  for (const [teamName, teamId] of teamsByName.entries()) {
    const normalizedTeam = normalizeName(teamName);

    if (
      normalizedContent.includes(normalizedTeam) ||
      normalizedTeam.includes(normalizedContent)
    ) {
      return teamId;
    }
  }

  return null;
}

function resolveTeamIdByName(teamName, teamsByName) {
  const normalizedTeamName = normalizeName(teamName);

  if (!normalizedTeamName) {
    return null;
  }

  if (teamsByName.has(normalizedTeamName)) {
    return teamsByName.get(normalizedTeamName);
  }

  for (const [candidateName, teamId] of teamsByName.entries()) {
    if (
      candidateName.includes(normalizedTeamName) ||
      normalizedTeamName.includes(candidateName)
    ) {
      return teamId;
    }
  }

  return null;
}

function extractPlayerAndTeam(content) {
  const matches = [...content.matchAll(/(?:^|[.!?]\s)([^().!?]+?)\s+\(([^)]+)\)/g)];
  const directMatch = matches.at(-1);

  if (directMatch) {
    return {
      playerName: directMatch[1].trim(),
      teamName: directMatch[2].trim(),
    };
  }

  const ownGoalMatch = content.match(/Gol en propia puerta de\s+([^.(]+?)\s+\(([^)]+)\)/i);

  if (ownGoalMatch) {
    return {
      playerName: ownGoalMatch[1].trim(),
      teamName: ownGoalMatch[2].trim(),
    };
  }

  return {
    playerName: null,
    teamName: null,
  };
}

function mapLaLigaCommentToEvent(comment, teamsByName) {
  const content = String(comment?.content ?? '').trim();

  if (!content) {
    return null;
  }

  const normalized = normalizeName(content);
  const { playerName, teamName } = extractPlayerAndTeam(content);
  const resolvedTeamId =
    (teamName ? resolveTeamIdByName(teamName, teamsByName) : null) ??
    resolveCommentTeamId(content, teamsByName);

  let eventType = null;

  const commentKindId = Number(comment?.match_comment_kind?.id ?? 0);

  if (commentKindId === 28 || normalized.includes('gol anulado por el var')) {
    return null;
  }

  if (commentKindId === 8 || commentKindId === 29 || /go+ol/.test(normalized) || normalized.startsWith('gol ')) {
    if (normalized.includes('propia puerta')) {
      eventType = 'own_goal';
    } else if (normalized.includes('penalti')) {
      eventType = 'penalty_goal';
    } else {
      eventType = 'goal';
    }
  } else if (commentKindId === 22 || normalized.includes('segunda tarjeta amarilla')) {
    eventType = 'second_yellow_red';
  } else if (commentKindId === 21 || normalized.includes('tarjeta roja')) {
    eventType = 'red_card';
  } else if (commentKindId === 20 || normalized.includes('tarjeta amarilla')) {
    eventType = 'yellow_card';
  }

  if (!eventType) {
    return null;
  }

  return {
    eventType,
    minute: Number.isFinite(Number(comment?.time)) ? Number(comment.time) : null,
    extraMinute: null,
    teamId: resolvedTeamId,
    playerName,
    description: JSON.stringify({
      period: comment?.period ?? null,
      content,
      matchCommentKindId: comment?.match_comment_kind?.id ?? null,
    }),
  };
}

export function mapLaLigaEvents(comments, teams) {
  const teamsByName = new Map(
    (teams ?? [])
      .filter((team) => team?.name && team?.id != null)
      .map((team) => [normalizeName(team.name), team.id]),
  );

  return (comments ?? [])
    .map((comment) => mapLaLigaCommentToEvent(comment, teamsByName))
    .filter(Boolean)
    .sort((left, right) => {
      const minuteDiff = (left.minute ?? 0) - (right.minute ?? 0);

      if (minuteDiff !== 0) {
        return minuteDiff;
      }

      return (left.extraMinute ?? 0) - (right.extraMinute ?? 0);
    });
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
