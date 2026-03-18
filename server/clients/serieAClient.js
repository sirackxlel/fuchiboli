const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

export const SERIE_A_CALENDAR_URL = 'https://www.legaseriea.it/serie-a/calendario-risultati';
export const SERIE_A_STANDINGS_URL = 'https://www.legaseriea.it/serie-a/statistiche';
export const SERIE_A_SITE_BASE_URL = 'https://www.legaseriea.it';
export const SERIE_A_SEASON_LABEL = '2025/2026';
export const SERIE_A_SEASON_ID = 'serie-a::Football_Season::5f0e080fc3a44073984b75b3a8e06a8a';
export const SERIE_A_API_BASE_URL = 'https://seriea-api.prd.sdp.deltatre.digital/v1/serie-a/football';

const ITALIAN_MONTHS = {
  gennaio: 1,
  febbraio: 2,
  marzo: 3,
  aprile: 4,
  maggio: 5,
  giugno: 6,
  luglio: 7,
  agosto: 8,
  settembre: 9,
  ottobre: 10,
  novembre: 11,
  dicembre: 12,
};

function getHeaders() {
  return {
    'user-agent': USER_AGENT,
    accept: 'text/plain; x-api-version=1.0',
    origin: SERIE_A_SITE_BASE_URL,
    referer: `${SERIE_A_SITE_BASE_URL}/`,
    'accept-language': 'it-IT,it;q=0.9,en;q=0.8',
  };
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

function normalizeSerieAEntityId(value, prefix) {
  const raw = normalizeWhitespace(value);

  if (!raw) {
    return null;
  }

  return raw.startsWith(prefix) ? raw : `${prefix}${raw}`;
}

function parseOffsetMinutes(offsetLabel) {
  const match = String(offsetLabel ?? '').match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);

  if (!match) {
    return 0;
  }

  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  return sign * (hours * 60 + minutes);
}

function getTimeZoneOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);

  const offsetLabel = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+0';
  return parseOffsetMinutes(offsetLabel);
}

function zonedTimeToUtcIso({ year, month, day, hour, minute, timeZone }) {
  let utcMillis = Date.UTC(year, month - 1, day, hour, minute);

  for (let index = 0; index < 4; index += 1) {
    const offsetMinutes = getTimeZoneOffsetMinutes(new Date(utcMillis), timeZone);
    const nextUtcMillis = Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60 * 1000;

    if (nextUtcMillis === utcMillis) {
      break;
    }

    utcMillis = nextUtcMillis;
  }

  return new Date(utcMillis).toISOString();
}

function parseItalianDateLabel(dateLabel) {
  const normalized = normalizeWhitespace(dateLabel).toLowerCase();
  const match = normalized.match(/(\d{1,2})\s+([a-zà]+)\s+(\d{4})/i);

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = ITALIAN_MONTHS[match[2]];
  const year = Number(match[3]);

  if (!day || !month || !year) {
    return null;
  }

  return { year, month, day };
}

function buildKickoffIso(dateLabel, timeLabel) {
  const dateParts = parseItalianDateLabel(dateLabel);
  const timeMatch = String(timeLabel ?? '').match(/(\d{1,2}):(\d{2})/);

  if (!dateParts || !timeMatch) {
    return null;
  }

  return zonedTimeToUtcIso({
    ...dateParts,
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    timeZone: 'Europe/Rome',
  });
}

function extractDateScopedArticles(html) {
  const tokenPattern =
    /<h3[^>]*aria-label="Data partita:\s*([^"]+)"[^>]*>[\s\S]*?<\/h3>|<article\b[\s\S]*?<\/article>/gi;
  const entries = [];
  let currentDateLabel = null;

  for (const match of html.matchAll(tokenPattern)) {
    if (match[1]) {
      currentDateLabel = normalizeWhitespace(match[1]);
      continue;
    }

    entries.push({
      dateLabel: currentDateLabel,
      articleHtml: match[0],
    });
  }

  return entries;
}

function extractScore(articleHtml) {
  const scoreMatch = articleHtml.match(
    /aria-label="Punteggio"[\s\S]*?<span[^>]*>\s*(\d+)\s*<\/span>[\s\S]*?<span[^>]*>\s*(\d+)\s*<\/span>/i,
  );

  if (!scoreMatch) {
    return {
      homeScore: null,
      awayScore: null,
    };
  }

  return {
    homeScore: Number(scoreMatch[1]),
    awayScore: Number(scoreMatch[2]),
  };
}

function extractTeams(articleHtml) {
  const srOnly = normalizeWhitespace(
    articleHtml.match(/<div class="dfw:sr-only">([\s\S]*?)<\/div>/i)?.[1] ?? '',
  );
  const srOnlyMatch = srOnly.match(
    /Squadra di casa:\s*(.+?)\.\s*Squadra ospite:\s*(.+?)\.\s*Partita/i,
  );

  if (srOnlyMatch) {
    return {
      homeTeamName: normalizeWhitespace(srOnlyMatch[1]),
      awayTeamName: normalizeWhitespace(srOnlyMatch[2]),
    };
  }

  const imageMatches = [...articleHtml.matchAll(/<img alt="([^"]+)"[^>]*src="([^"]*clubLogos\/[^"]+)"/gi)];

  return {
    homeTeamName: normalizeWhitespace(imageMatches[0]?.[1] ?? ''),
    awayTeamName: normalizeWhitespace(imageMatches[1]?.[1] ?? ''),
  };
}

function extractTeamLogoUrls(articleHtml) {
  const imageMatches = [...articleHtml.matchAll(/<img alt="([^"]+)"[^>]*src="([^"]*clubLogos\/[^"]+)"/gi)];
  return {
    homeLogoUrl: imageMatches[0]?.[2] ?? null,
    awayLogoUrl: imageMatches[1]?.[2] ?? null,
  };
}

function normalizeSerieAStatus(articleHtml) {
  const text = normalizeWhitespace(articleHtml);

  if (text.includes('Partita terminata.')) {
    return 'finished';
  }

  if (text.includes('Partita futura.')) {
    return 'scheduled';
  }

  return 'scheduled';
}

export function slugifySerieATeam(value) {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function fetchSerieACalendarPage() {
  const response = await fetch(SERIE_A_CALENDAR_URL, {
    headers: {
      ...getHeaders(),
      accept: 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Serie A respondio con ${response.status} en el calendario.`);
  }

  return response.text();
}

async function fetchSerieAJson(path) {
  const response = await fetch(`${SERIE_A_API_BASE_URL}${path}`, {
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error(`Serie A respondio con ${response.status} en ${path}.`);
  }

  return response.json();
}

function buildSerieASeasonPath(path) {
  return `/seasons/${encodeURIComponent(SERIE_A_SEASON_ID)}${path}`;
}

export async function fetchSerieAMatchdays() {
  return fetchSerieAJson(`${buildSerieASeasonPath('/matchdays')}?locale=it-IT`);
}

export async function fetchSerieAMatchesByMatchday(matchdayId) {
  return fetchSerieAJson(
    `${buildSerieASeasonPath('/matches')}?matchDayId=${encodeURIComponent(matchdayId)}&locale=it-IT`,
  );
}

export async function fetchSerieAMatchSummary(matchId) {
  const normalizedMatchId = normalizeSerieAEntityId(matchId, 'serie-a::Football_Match::');

  if (!normalizedMatchId) {
    throw new Error('Serie A matchId invalido para summary.');
  }

  return fetchSerieAJson(
    `${buildSerieASeasonPath(`/match/${encodeURIComponent(normalizedMatchId)}/summary`)}?locale=it-IT`,
  );
}

export async function fetchSerieAMatchLineups(matchId) {
  const normalizedMatchId = normalizeSerieAEntityId(matchId, 'serie-a::Football_Match::');

  if (!normalizedMatchId) {
    throw new Error('Serie A matchId invalido para lineups.');
  }

  return fetchSerieAJson(
    `${buildSerieASeasonPath(`/matches/${encodeURIComponent(normalizedMatchId)}/lineups`)}?locale=it-IT`,
  );
}

export async function fetchSerieAMatchTeamStats(matchId) {
  const normalizedMatchId = normalizeSerieAEntityId(matchId, 'serie-a::Football_Match::');

  if (!normalizedMatchId) {
    throw new Error('Serie A matchId invalido para teamstats.');
  }

  return fetchSerieAJson(
    `${buildSerieASeasonPath(`/match/${encodeURIComponent(normalizedMatchId)}/teamstats`)}?locale=it-IT`,
  );
}

export async function fetchSerieAOverallStandings() {
  return fetchSerieAJson(`${buildSerieASeasonPath('/standings/overall')}?locale=it-IT`);
}

function normalizeSerieAApiStatus(status) {
  const normalized = String(status ?? '').toLowerCase();

  if (['finished', 'played', 'full_time'].includes(normalized)) {
    return 'finished';
  }

  if (['upcoming', 'fixture', 'pre_match'].includes(normalized)) {
    return 'scheduled';
  }

  if (['live', 'in_progress', 'inplay'].includes(normalized)) {
    return 'live';
  }

  if (normalized.includes('postpon')) {
    return 'postponed';
  }

  if (normalized.includes('cancel')) {
    return 'cancelled';
  }

  return 'scheduled';
}

function mapSerieAMatch(rawMatch) {
  const matchday = Number(rawMatch.matchSet?.providerId?.match(/opta:MatchDay:(\d+)/)?.[1] ?? null);

  return {
    matchId: rawMatch.matchId?.replace(/^serie-a::Football_Match::/, '') ?? null,
    slug:
      rawMatch.matchUrl?.match(/\/serie-a\/match\/[^/]+\/([^/]+)\/?$/i)?.[1] ??
      `${slugifySerieATeam(rawMatch.home?.officialName)}-vs-${slugifySerieATeam(rawMatch.away?.officialName)}`,
    matchday,
    roundName: Number.isFinite(matchday) ? `Jornada ${matchday}` : rawMatch.matchSet?.shortName ?? rawMatch.matchSet?.name ?? null,
    dateLabel: null,
    timeLabel: null,
    matchDateUtc: rawMatch.matchDateUtc ?? null,
    status: normalizeSerieAApiStatus(rawMatch.status ?? rawMatch.providerStatus ?? rawMatch.phase),
    statusDetail: rawMatch.providerStatus ?? rawMatch.status ?? null,
    homeTeamName: rawMatch.home?.officialName ?? rawMatch.home?.shortName ?? null,
    awayTeamName: rawMatch.away?.officialName ?? rawMatch.away?.shortName ?? null,
    homeTeamSlug: slugifySerieATeam(rawMatch.home?.officialName ?? rawMatch.home?.shortName),
    awayTeamSlug: slugifySerieATeam(rawMatch.away?.officialName ?? rawMatch.away?.shortName),
    homeLogoUrl: rawMatch.home?.imagery?.teamLogo
      ? `https://media-sdp.legaseriea.it/${rawMatch.home.imagery.teamLogo}`
      : null,
    awayLogoUrl: rawMatch.away?.imagery?.teamLogo
      ? `https://media-sdp.legaseriea.it/${rawMatch.away.imagery.teamLogo}`
      : null,
    venueName: rawMatch.stadiumName ?? null,
    venueCity: rawMatch.cityName ?? null,
    homeScore: rawMatch.providerHomeScore ?? rawMatch.homeScorePush ?? null,
    awayScore: rawMatch.providerAwayScore ?? rawMatch.awayScorePush ?? null,
    sourceUrl:
      rawMatch.matchUrl && rawMatch.matchUrl !== '/'
        ? `${SERIE_A_SITE_BASE_URL}${rawMatch.matchUrl.startsWith('/') ? '' : '/'}${rawMatch.matchUrl}`
        : `${SERIE_A_SITE_BASE_URL}/serie-a/match/${rawMatch.matchId?.replace(/^serie-a::Football_Match::/, '') ?? ''}/${rawMatch.matchUrl?.match(/\/serie-a\/match\/[^/]+\/([^/]+)\/?$/i)?.[1] ?? `${slugifySerieATeam(rawMatch.home?.officialName)}-vs-${slugifySerieATeam(rawMatch.away?.officialName)}`}`,
  };
}

export function parseSerieACalendarHtml(html) {
  return extractDateScopedArticles(html)
    .map(({ dateLabel, articleHtml }) => {
      const matchLink = articleHtml.match(/href="\/serie-a\/match\/([a-z0-9]+)\/([a-z0-9-]+)"/i);
      const matchday = Number(articleHtml.match(/MATCHDAY\s+(\d+)/i)?.[1] ?? null);
      const timeLabel = normalizeWhitespace(
        articleHtml.match(/aria-label="Orario partita:\s*([^"]+)"/i)?.[1] ?? '',
      );
      const { homeTeamName, awayTeamName } = extractTeams(articleHtml);
      const { homeScore, awayScore } = extractScore(articleHtml);
      const { homeLogoUrl, awayLogoUrl } = extractTeamLogoUrls(articleHtml);

      if (!matchLink || !homeTeamName || !awayTeamName) {
        return null;
      }

      return {
        matchId: matchLink[1],
        slug: matchLink[2],
        matchday,
        roundName: Number.isFinite(matchday) ? `Jornada ${matchday}` : null,
        dateLabel,
        timeLabel,
        matchDateUtc: buildKickoffIso(dateLabel, timeLabel),
        status: normalizeSerieAStatus(articleHtml),
        statusDetail: normalizeWhitespace(
          articleHtml.includes('Partita terminata.') ? 'Partita terminata.' : 'Partita futura.',
        ),
        homeTeamName,
        awayTeamName,
        homeTeamSlug: slugifySerieATeam(homeTeamName),
        awayTeamSlug: slugifySerieATeam(awayTeamName),
        homeLogoUrl,
        awayLogoUrl,
        venueName: null,
        venueCity: null,
        homeScore,
        awayScore,
        sourceUrl: `${SERIE_A_SITE_BASE_URL}/serie-a/match/${matchLink[1]}/${matchLink[2]}`,
      };
    })
    .filter(Boolean);
}

export async function fetchSerieASeasonMatches() {
  const matchdaysPayload = await fetchSerieAMatchdays();
  const matchdays = matchdaysPayload.matchdays ?? [];
  const matches = [];

  for (const matchday of matchdays) {
    const payload = await fetchSerieAMatchesByMatchday(matchday.matchSetId);
    const currentMatches = payload.matches ?? [];
    matches.push(...currentMatches.map(mapSerieAMatch));
  }

  return matches;
}
