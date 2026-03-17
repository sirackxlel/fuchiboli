const BOCA_URL =
  'https://www.espn.com.ar/futbol/equipo/calendario/_/id/5/arg.boca_juniors';
const BETIS_URL = 'https://www.laliga.com/clubes/real-betis/proximos-partidos';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

function findBalancedJsonSlice(source, keyPattern) {
  const keyMatch = keyPattern.exec(source);

  if (!keyMatch) {
    throw new Error('No se encontro el bloque de datos esperado.');
  }

  const startIndex = keyMatch.index + keyMatch[0].length;
  let cursor = startIndex;

  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1;
  }

  const openingChar = source[cursor];
  const closingChar = openingChar === '{' ? '}' : ']';

  if (!['{', '['].includes(openingChar)) {
    throw new Error('El bloque de datos no tiene un JSON valido.');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = cursor; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === openingChar) {
      depth += 1;
    } else if (character === closingChar) {
      depth -= 1;

      if (depth === 0) {
        return source.slice(cursor, index + 1);
      }
    }
  }

  throw new Error('No se pudo cerrar el bloque JSON.');
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      'accept-language': 'es-AR,es;q=0.9,en;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`La fuente respondio con ${response.status}.`);
  }

  return response.text();
}

function mapEspnMatch(match) {
  const homeTeam = match.teams?.find((team) => team.isHome) ?? match.teams?.[0];
  const awayTeam = match.teams?.find((team) => !team.isHome) ?? match.teams?.[1];

  return {
    id: `espn-${match.id}`,
    source: 'ESPN',
    sourceUrl: new URL(match.link, 'https://www.espn.com.ar').toString(),
    competition: match.league,
    date: match.date,
    displayDate: match.status?.detail ?? '',
    homeTeam: homeTeam?.displayName ?? '',
    awayTeam: awayTeam?.displayName ?? '',
    venue: match.venue?.fullName ?? '',
    city: match.venue?.address?.city ?? '',
  };
}

function extractEspnState(html) {
  const marker = "window['__espnfitt__']=";
  const startIndex = html.indexOf(marker);

  if (startIndex === -1) {
    throw new Error('No se encontro el estado de ESPN en la pagina.');
  }

  return JSON.parse(
    findBalancedJsonSlice(
      html.slice(startIndex + marker.length),
      /^/,
    ),
  );
}

export function parseBocaMatchesFromHtml(html) {
  const espnState = extractEspnState(html);
  const fixtures = espnState?.page?.content?.fixtures?.events;

  if (!Array.isArray(fixtures)) {
    throw new Error('No se encontro el calendario de Boca en ESPN.');
  }

  const now = Date.now();

  return fixtures
    .filter((match) => !match.completed && Date.parse(match.date) >= now)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .map(mapEspnMatch);
}

function extractJsonLdBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function safeJsonParse(block) {
  try {
    return JSON.parse(block);
  } catch {
    return null;
  }
}

function isBetisMatchSchema(entry) {
  return (
    entry &&
    entry['@type'] === 'SportsEvent' &&
    typeof entry.startDate === 'string' &&
    entry.homeTeam?.name &&
    entry.awayTeam?.name
  );
}

function mapBetisMatch(entry, index) {
  return {
    id: `laliga-${index}-${entry.startDate}`,
    source: 'LALIGA',
    sourceUrl: entry.url,
    competition: entry.superEvent?.name ?? 'Partido',
    date: entry.startDate,
    displayDate: '',
    homeTeam: entry.homeTeam.name,
    awayTeam: entry.awayTeam.name,
    venue: entry.location?.name ?? '',
    city: entry.location?.address?.addressLocality ?? '',
  };
}

export function parseBetisMatchesFromHtml(html) {
  const now = Date.now();

  return extractJsonLdBlocks(html)
    .map(safeJsonParse)
    .filter(isBetisMatchSchema)
    .filter((entry) => Date.parse(entry.startDate) >= now)
    .sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate))
    .map(mapBetisMatch);
}

export async function getBocaMatches() {
  const html = await fetchHtml(BOCA_URL);
  return parseBocaMatchesFromHtml(html);
}

export async function getBetisMatches() {
  const html = await fetchHtml(BETIS_URL);
  return parseBetisMatchesFromHtml(html);
}
