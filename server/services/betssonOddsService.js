const BETSSON_CATEGORIES_URL = 'https://pba.betsson.bet.ar/api/sb/v1/widgets/categories/v2';
const BETSSON_EVENT_MARKET_URL = 'https://pba.betsson.bet.ar/api/sb/v1/widgets/event-market/v1';
const BETSSON_REFERER_BASE =
  'https://pba.betsson.bet.ar/apuestas-deportivas/futbol/espana/espana-la-liga';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
const CACHE_TTL_MS = 5 * 60 * 1000;
const ODDS_CACHE_TTL_MS = 2 * 60 * 1000;
const EVENT_ID_PREFIX = 'm-';
const MATCH_WINNER_TEMPLATE_ID = 'MW3W';

const BASE_HEADERS = {
  'x-obg-channel': 'Web',
  'x-sb-device-type': 'Desktop',
  'x-sb-type': 'b2b',
  brandid: '238cb63a-3dcc-4fdf-b241-23a12cb71aa7',
  'x-sb-jurisdiction': 'Lotba',
  'x-sb-content-id': '238cb63a-3dcc-4fdf-b241-23a12cb71aa7',
  accept: 'application/json, text/plain, */*',
  'x-sb-segment-id': '21237cd3-1f5c-4820-978b-1e08abd6a79e',
  'content-type': 'application/json',
  'x-sb-currency-code': 'ARS',
  'x-sb-static-context-id': 'stc-481840707',
  'x-sb-user-context-id': 'stc-481840707',
  'x-sb-language-code': 'ag',
  'x-sb-channel': 'Web',
  'x-sb-app-version': '7.33.21.1587-rf75460b',
  marketcode: 'ag',
  sessiontoken:
    'ew0KICAiYWxnIjogIkhTMjU2IiwNCiAgInR5cCI6ICJKV1QiDQp9.ew0KICAianVyaXNkaWN0aW9uIjogIlVua25vd24iLA0KICAidXNlcklkIjogIjExMTExMTExLTExMTEtMTExMS0xMTExLTExMTExMTExMTExMSIsDQogICJsb2dpblNlc3Npb25JZCI6ICIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiDQp9.yuBO_qNKJHtbCWK3z04cEqU59EKU8pZb2kXHhZ7IeuI',
  'x-obg-device': 'Desktop',
  'x-sb-country-code': 'AR',
  'user-agent': USER_AGENT,
};

const eventsCache = {
  expiresAt: 0,
  events: [],
};

const oddsCache = new Map();

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTeamName(value) {
  const stopWords = new Set([
    'ac',
    'afc',
    'atletico',
    'ca',
    'cd',
    'cf',
    'club',
    'de',
    'del',
    'fc',
    'rc',
    'sc',
    'sd',
    'ud',
  ]);

  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .filter((token) => !stopWords.has(token))
    .join(' ');
}

function getNameTokenSet(value) {
  return new Set(normalizeTeamName(value).split(' ').filter(Boolean));
}

function scoreTeamNameMatch(left, right) {
  const normalizedLeft = normalizeTeamName(left);
  const normalizedRight = normalizeTeamName(right);

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 100;
  }

  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    return 75;
  }

  const leftTokens = getNameTokenSet(left);
  const rightTokens = getNameTokenSet(right);
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;

  if (shared === 0) {
    return 0;
  }

  return Math.round((shared / Math.max(leftTokens.size, rightTokens.size)) * 60);
}

function parseOddsNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function buildCategoriesHeaders() {
  return {
    ...BASE_HEADERS,
    'x-sb-identifier': 'A_TO_Z_MENU_REQUEST',
    referer: `${BETSSON_REFERER_BASE}?tab=liveAndUpcoming`,
  };
}

function buildEventHeaders(event) {
  return {
    ...BASE_HEADERS,
    referer: `https://pba.betsson.bet.ar/apuestas-deportivas/${event.slug}?eventId=${event.eventId}&eti=0`,
  };
}

function parseEventLabel(label) {
  const [homeTeam = '', awayTeam = ''] = String(label ?? '').split(' - ');

  return {
    homeTeam: normalizeWhitespace(homeTeam),
    awayTeam: normalizeWhitespace(awayTeam),
  };
}

function flattenFootballEvents(payload) {
  const football = payload?.data?.items?.categories?.['1'];
  const regions = football?.regions ?? {};
  const events = [];

  for (const region of Object.values(regions)) {
    const competitions = region?.competitions ?? {};

    for (const competition of Object.values(competitions)) {
      const competitionEvents = competition?.events ?? {};

      for (const [eventId, event] of Object.entries(competitionEvents)) {
        if (event?.eventType !== 'Fixture' || event?.phase !== 'Prematch') {
          continue;
        }

        const teams = parseEventLabel(event.label);

        if (!teams.homeTeam || !teams.awayTeam || !event.startDate || !event.slug) {
          continue;
        }

        events.push({
          eventId,
          slug: event.slug,
          label: event.label,
          startDate: event.startDate,
          homeTeam: teams.homeTeam,
          awayTeam: teams.awayTeam,
        });
      }
    }
  }

  return events;
}

async function fetchBetssonFootballEvents() {
  if (eventsCache.events.length > 0 && eventsCache.expiresAt > Date.now()) {
    return eventsCache.events;
  }

  const response = await fetch(BETSSON_CATEGORIES_URL, {
    headers: buildCategoriesHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Betsson respondio con ${response.status}.`);
  }

  const payload = await response.json();
  const events = flattenFootballEvents(payload);

  eventsCache.events = events;
  eventsCache.expiresAt = Date.now() + CACHE_TTL_MS;
  return events;
}

function scoreCandidateMatch(targetMatch, candidateEvent) {
  const homeScore = scoreTeamNameMatch(targetMatch.homeTeam, candidateEvent.homeTeam);
  const awayScore = scoreTeamNameMatch(targetMatch.awayTeam, candidateEvent.awayTeam);

  if (homeScore === 0 || awayScore === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const targetDate = Date.parse(targetMatch.date);
  const candidateDate = Date.parse(candidateEvent.startDate);
  const dateDiffMinutes = Math.abs(targetDate - candidateDate) / (60 * 1000);

  if (!Number.isFinite(dateDiffMinutes) || dateDiffMinutes > 24 * 60) {
    return Number.NEGATIVE_INFINITY;
  }

  return homeScore + awayScore - dateDiffMinutes / 30;
}

function findBestCandidate(targetMatch, events) {
  let bestEvent = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const event of events) {
    const score = scoreCandidateMatch(targetMatch, event);

    if (score > bestScore) {
      bestScore = score;
      bestEvent = event;
    }
  }

  return bestScore >= 100 ? bestEvent : null;
}

function normalizeMarketSelections(payload) {
  const selections = payload?.data?.marketSelections ?? [];

  if (!Array.isArray(selections) || selections.length < 3) {
    return null;
  }

  const bySortOrder = new Map(
    selections
      .filter((selection) => Number.isFinite(Number(selection?.sortOrder)))
      .map((selection) => [Number(selection.sortOrder), selection]),
  );

  const home = parseOddsNumber(bySortOrder.get(1)?.odds);
  const draw = parseOddsNumber(bySortOrder.get(2)?.odds);
  const away = parseOddsNumber(bySortOrder.get(3)?.odds);

  if (home == null || draw == null || away == null) {
    return null;
  }

  return {
    home,
    draw,
    away,
    bookmaker: 'Betsson',
    source: 'Betsson',
    updatedAt: null,
  };
}

async function fetchBetssonMatchWinnerOdds(event) {
  const cached = oddsCache.get(event.eventId);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const marketId = `${EVENT_ID_PREFIX}${event.eventId}-${MATCH_WINNER_TEMPLATE_ID}`;
  const response = await fetch(
    `${BETSSON_EVENT_MARKET_URL}?includescoreboards=true&marketids=${encodeURIComponent(marketId)}`,
    {
      headers: buildEventHeaders(event),
    },
  );

  if (!response.ok) {
    throw new Error(`Betsson respondio con ${response.status} para ${event.label}.`);
  }

  const payload = await response.json();
  const odds = normalizeMarketSelections(payload);

  oddsCache.set(event.eventId, {
    expiresAt: Date.now() + ODDS_CACHE_TTL_MS,
    value: odds,
  });

  return odds;
}

export async function getBetssonOddsForMatches(matches) {
  const events = await fetchBetssonFootballEvents();
  const entries = await Promise.all(
    matches.map(async (match) => {
      const bestEvent = findBestCandidate(match, events);

      if (!bestEvent) {
        return [match.id, null];
      }

      try {
        const odds = await fetchBetssonMatchWinnerOdds(bestEvent);
        return [match.id, odds];
      } catch {
        return [match.id, null];
      }
    }),
  );

  return Object.fromEntries(entries);
}
