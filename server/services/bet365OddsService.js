const SCORECAST_PREMATCH_URL = 'https://scorecast.info/prematch';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = {
  expiresAt: 0,
  matches: [],
};

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTeamName(value) {
  const stopWords = new Set([
    'ac',
    'afc',
    'athletic',
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

function decodeEmbeddedPayload(html) {
  return html
    .replace(/\\u0026/g, '&')
    .replace(/\\u003c/g, '<')
    .replace(/\\u003e/g, '>')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '')
    .replace(/\\\//g, '/');
}

function extractBalancedObject(source, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
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

    if (character === '{') {
      depth += 1;
      continue;
    }

    if (character === '}') {
      depth -= 1;

      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function parseOddsNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : null;
}

function normalizeScorecastMatch(match) {
  const bet365 = match?.bookmaker_odds?.bet365?.['1x2'];

  return {
    homeTeam: match.home_team,
    awayTeam: match.away_team,
    startTime: String(match.start_time ?? '').replace(/^\$D/, ''),
    bet365: bet365
      ? {
          home: parseOddsNumber(bet365.option1_odds),
          draw: parseOddsNumber(bet365.option2_odds),
          away: parseOddsNumber(bet365.option3_odds),
          updatedAt: String(bet365.updated_at ?? '').replace(/^\$D/, '') || null,
        }
      : null,
  };
}

async function fetchScorecastPrematchMatches() {
  if (cache.matches.length > 0 && cache.expiresAt > Date.now()) {
    return cache.matches;
  }

  const response = await fetch(SCORECAST_PREMATCH_URL, {
    headers: {
      'user-agent': USER_AGENT,
      'accept-language': 'en-US,en;q=0.9,es;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Scorecast respondio con ${response.status}.`);
  }

  const html = await response.text();
  const decoded = decodeEmbeddedPayload(html);
  const matches = [];
  let cursor = 0;

  while (cursor < decoded.length) {
    const startIndex = decoded.indexOf('{"match_id":"', cursor);

    if (startIndex === -1) {
      break;
    }

    const block = extractBalancedObject(decoded, startIndex);
    cursor = startIndex + 1;

    if (!block) {
      continue;
    }

    try {
      const parsed = JSON.parse(block);

      if (parsed?.home_team && parsed?.away_team && parsed?.start_time) {
        matches.push(normalizeScorecastMatch(parsed));
      }
    } catch {
      // Ignore malformed embedded objects and keep scanning.
    }
  }

  cache.matches = matches;
  cache.expiresAt = Date.now() + CACHE_TTL_MS;
  return matches;
}

function scoreCandidateMatch(targetMatch, candidateMatch) {
  const homeScore = scoreTeamNameMatch(targetMatch.homeTeam, candidateMatch.homeTeam);
  const awayScore = scoreTeamNameMatch(targetMatch.awayTeam, candidateMatch.awayTeam);

  if (homeScore === 0 || awayScore === 0) {
    return Number.NEGATIVE_INFINITY;
  }

  const targetDate = Date.parse(targetMatch.date);
  const candidateDate = Date.parse(candidateMatch.startTime);
  const dateDiffMinutes = Math.abs(targetDate - candidateDate) / (60 * 1000);

  if (!Number.isFinite(dateDiffMinutes) || dateDiffMinutes > 24 * 60) {
    return Number.NEGATIVE_INFINITY;
  }

  return homeScore + awayScore - dateDiffMinutes / 30;
}

function findBestCandidate(targetMatch, candidates) {
  let bestCandidate = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const score = scoreCandidateMatch(targetMatch, candidate);

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  return bestScore >= 100 ? bestCandidate : null;
}

export async function getBet365OddsForMatches(matches) {
  const scorecastMatches = await fetchScorecastPrematchMatches();

  return matches.reduce((accumulator, match) => {
    const bestCandidate = findBestCandidate(match, scorecastMatches);

    accumulator[match.id] = bestCandidate?.bet365
      ? {
          ...bestCandidate.bet365,
          source: 'Scorecast',
        }
      : null;

    return accumulator;
  }, {});
}
