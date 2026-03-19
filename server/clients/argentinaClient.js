import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const ARGENTINA_TOURNAMENT_URL =
  'https://www.ligaprofesional.ar/torneo-apertura-2026/';
export const ARGENTINA_AFA_STATS_URL =
  'https://www.afa.com.ar/es/pages/estadisticas-primera-division';
export const ARGENTINA_AFA_FIXTURE_URL =
  'https://info.afa.org.ar/deposito/html/v3/page.html?channel=deportes.futbol.primeraa&lang=es_LA&page=fixture';
export const ARGENTINA_COMPETITION_ID = '384';
export const ARGENTINA_GENERAL_TABLE_COMPETITION_ID = '1122';
export const ARGENTINA_SEASON_ID = '2026';

const EDGE_CANDIDATE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function getBrowserPath() {
  const browserPath = EDGE_CANDIDATE_PATHS.find((candidate) => existsSync(candidate));

  if (!browserPath) {
    throw new Error('No encontramos Edge o Chrome para renderizar la pagina de Liga Profesional.');
  }

  return browserPath;
}

function renderUrlWithBrowser(url) {
  const userDataDir = mkdtempSync(path.join(tmpdir(), 'fuchiboli-edge-'));

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

async function fetchHtml(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      'user-agent': 'Mozilla/5.0',
      'accept-language': 'es-AR,es;q=0.9,en;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`No pudimos descargar ${url}: ${response.status}`);
  }

  return response.text();
}

function decodeHtmlEntities(value) {
  return String(value ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
    const normalized = String(code).toLowerCase();

    if (normalized === 'amp') return '&';
    if (normalized === 'nbsp') return ' ';
    if (normalized === 'quot') return '"';
    if (normalized === 'apos') return "'";
    if (normalized === 'lt') return '<';
    if (normalized === 'gt') return '>';
    if (normalized === 'ndash' || normalized === '#8211') return '-';
    if (normalized === 'mdash' || normalized === '#8212') return '-';
    if (normalized.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
    }
    if (normalized.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
    }

    return entity;
  });
}

function stripTags(value) {
  return decodeHtmlEntities(String(value ?? '').replace(/<[^>]+>/g, ''));
}

function normalizeWhitespace(value) {
  return stripTags(value).replace(/\s+/g, ' ').trim();
}

export function slugifyArgentinaTeam(value) {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function renderArgentinaTournamentPageHtml() {
  return renderUrlWithBrowser(ARGENTINA_TOURNAMENT_URL);
}

function getSectionBetween(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker);

  if (start === -1) {
    return '';
  }

  const end = endMarker ? html.indexOf(endMarker, start) : -1;
  return end === -1 ? html.slice(start) : html.slice(start, end);
}

function choosePreferredTeamName(names) {
  return [...names].sort((left, right) => right.length - left.length)[0] ?? null;
}

function buildTeamDirectory(html) {
  const directory = new Map();

  for (const match of html.matchAll(
    /Opta-Image-Team-(\d+)[\s\S]*?<img[^>]+src="([^"]+)"[^>]+alt="([^"]+)"/g,
  )) {
    const teamId = match[1];
    const logoUrl = decodeHtmlEntities(match[2]);
    const teamName = normalizeWhitespace(match[3]);

    if (!directory.has(teamId)) {
      directory.set(teamId, {
        names: new Set(),
        logoUrl,
      });
    }

    const entry = directory.get(teamId);
    entry.names.add(teamName);

    if (!entry.logoUrl) {
      entry.logoUrl = logoUrl;
    }
  }

  return new Map(
    [...directory.entries()].map(([teamId, entry]) => {
      const teamName = choosePreferredTeamName(entry.names) ?? `Equipo ${teamId}`;

      return [
        teamId,
        {
          teamId,
          teamName,
          teamSlug: slugifyArgentinaTeam(teamName),
          logoUrl: entry.logoUrl ?? null,
        },
      ];
    }),
  );
}

function resolveTeamMeta(teamDirectory, teamId, fallbackName) {
  const team = teamDirectory.get(String(teamId));
  const teamName = team?.teamName ?? normalizeWhitespace(fallbackName);

  return {
    teamId: String(teamId),
    teamName,
    teamSlug: team?.teamSlug ?? slugifyArgentinaTeam(teamName),
    logoUrl: team?.logoUrl ?? null,
  };
}

function normalizeFixtureStatus(className) {
  if (className.includes('Opta-live')) {
    return 'live';
  }

  if (className.includes('Opta-result')) {
    return 'finished';
  }

  if (className.includes('Opta-prematch')) {
    return 'scheduled';
  }

  return 'scheduled';
}

function parseWeekNumber(label) {
  const match = String(label ?? '').match(/Fecha\s+(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function parseScoreCell(rowHtml, side) {
  const match = rowHtml.match(
    new RegExp(`<td class="Opta-Score Opta-${side}[^"]*">([\\s\\S]*?)<\\/td>`, 'i'),
  );

  if (!match) {
    return null;
  }

  const value = normalizeWhitespace(match[1]);
  return value === '' ? null : Number.parseInt(value, 10);
}

function parseFixtures(fixturesHtml, teamDirectory) {
  const weekHeadingPattern =
    /<li(?:\s+[^>]*)?><h3 class="Opta-Exp"><span>(Fecha \d+)<\/span>[\s\S]*?<\/h3><div>/g;
  const weekHeadings = [...fixturesHtml.matchAll(weekHeadingPattern)];
  const weekBlocks = weekHeadings.map((headingMatch, index) => {
    const headingHtml = headingMatch[0];
    const roundName = normalizeWhitespace(headingMatch[1]);
    const contentStart = headingMatch.index + headingHtml.length;
    const contentEnd =
      index + 1 < weekHeadings.length
        ? weekHeadings[index + 1].index
        : fixturesHtml.lastIndexOf('</ul>');

    return {
      roundName,
      roundHtml: fixturesHtml.slice(contentStart, contentEnd === -1 ? undefined : contentEnd),
    };
  });
  const matches = [];

  for (const weekBlock of weekBlocks) {
    const roundName = weekBlock.roundName;
    const matchWeek = parseWeekNumber(roundName);
    const roundHtml = weekBlock.roundHtml;
    const fixtureBlocks = [...roundHtml.matchAll(
      /<tbody class="([^"]*Opta-fixture[^"]*)"([^>]*)>([\s\S]*?)<\/tbody>/g,
    )];

    for (const fixtureBlock of fixtureBlocks) {
      const className = fixtureBlock[1];
      const attributes = fixtureBlock[2];
      const fixtureHtml = fixtureBlock[3];
      const matchId = attributes.match(/data-match="(\d+)"/)?.[1] ?? null;
      const timestamp = attributes.match(/data-date="(\d+)"/)?.[1] ?? null;
      const kickoff = timestamp ? new Date(Number.parseInt(timestamp, 10)).toISOString() : null;
      const homeTeamId =
        fixtureHtml.match(/<td class="Opta-Team Opta-TeamName Opta-Home Opta-Team-(\d+)/)?.[1] ??
        null;
      const awayTeamId =
        fixtureHtml.match(/<td class="Opta-Team Opta-Away Opta-TeamName Opta-Team-(\d+)/)?.[1] ??
        null;
      const homeTeamLabel =
        fixtureHtml.match(/<td class="Opta-Team Opta-TeamName Opta-Home[^"]*">([^<]+)<\/td>/)?.[1] ??
        '';
      const awayTeamLabel =
        fixtureHtml.match(/<td class="Opta-Team Opta-Away Opta-TeamName[^"]*">([^<]+)<\/td>/)?.[1] ??
        '';
      const venue =
        fixtureHtml.match(/<td class="Opta-Venue" colspan="2">([\s\S]*?)<\/td>/)?.[1] ?? null;
      const sourcePath =
        fixtureHtml.match(/href="([^"]*competition=384&amp;season=2026&amp;match=\d+)"/)?.[1] ??
        null;
      const timeLabel =
        fixtureHtml.match(/<td class="Opta-Outer Opta-Time"><abbr title="([^"]*)">([^<]*)<\/abbr><\/td>/) ??
        [];

      if (!matchId || !homeTeamId || !awayTeamId || !kickoff) {
        continue;
      }

      const homeTeam = resolveTeamMeta(teamDirectory, homeTeamId, homeTeamLabel);
      const awayTeam = resolveTeamMeta(teamDirectory, awayTeamId, awayTeamLabel);

      matches.push({
        sourceMatchId: matchId,
        canonicalKey: `lpf_${ARGENTINA_COMPETITION_ID}_${ARGENTINA_SEASON_ID}_${matchId}`,
        matchDateUtc: kickoff,
        status: normalizeFixtureStatus(className),
        statusDetail: normalizeWhitespace(timeLabel[1] ?? timeLabel[2] ?? ''),
        roundName,
        matchWeek,
        venueName: normalizeWhitespace(venue),
        venueCity: null,
        homeTeam,
        awayTeam,
        homeScore: parseScoreCell(fixtureHtml, 'Home'),
        awayScore: parseScoreCell(fixtureHtml, 'Away'),
        sourceUrl: sourcePath
          ? `https://www.ligaprofesional.ar${decodeHtmlEntities(sourcePath)}`
          : ARGENTINA_TOURNAMENT_URL,
        rawPayload: fixtureHtml,
      });
    }
  }

  return matches;
}

function parseStandingsRows(tableBodyHtml, teamDirectory) {
  const rows = [...tableBodyHtml.matchAll(/<tr class="Opta-Team-(\d+)">([\s\S]*?)<\/tr>/g)];

  return rows
    .map((rowMatch) => {
      const teamId = rowMatch[1];
      const rowHtml = rowMatch[2];
      const position = Number.parseInt(rowHtml.match(/<th>(\d+)<\/th>/)?.[1] ?? '', 10);
      const teamCell = rowHtml.match(/<td class="Opta-Team">([\s\S]*?)<\/td>/)?.[1] ?? '';
      const team = resolveTeamMeta(teamDirectory, teamId, teamCell);
      const valuesAfterTeam = rowHtml.split('<td class="Opta-Team">')[1]?.split('</td>').slice(1).join('</td>') ?? '';
      const numericCells = [...valuesAfterTeam.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
        .map((cell) => normalizeWhitespace(cell[1]))
        .filter(Boolean);

      const [points, played, won, drawn, lost, goalsFor, goalsAgainst, goalDifference] =
        numericCells;

      if (!Number.isFinite(position)) {
        return null;
      }

      return {
        ...team,
        position,
        points: Number.parseInt(points ?? '0', 10),
        played: Number.parseInt(played ?? '0', 10),
        won: Number.parseInt(won ?? '0', 10),
        drawn: Number.parseInt(drawn ?? '0', 10),
        lost: Number.parseInt(lost ?? '0', 10),
        goalsFor: Number.parseInt(goalsFor ?? '0', 10),
        goalsAgainst: Number.parseInt(goalsAgainst ?? '0', 10),
        goalDifference: goalDifference ?? '0',
      };
    })
    .filter(Boolean);
}

function parseGroupedStandings(standingsHtml, teamDirectory) {
  const groups = {};

  for (const groupMatch of standingsHtml.matchAll(
    /<h3 class="Opta-groupname"><span>(Grupo [AB])<\/span><\/h3><div class="Opta-Table-Scroll"><div><table[\s\S]*?<tbody>([\s\S]*?)<\/tbody><\/table><\/div><\/div>/g,
  )) {
    const groupName = normalizeWhitespace(groupMatch[1]);
    groups[groupName] = parseStandingsRows(groupMatch[2], teamDirectory);
  }

  return groups;
}

function parseGeneralStandings(generalHtml, teamDirectory) {
  const tableBodyMatch = generalHtml.match(/<table[\s\S]*?<tbody>([\s\S]*?)<\/tbody><\/table>/);
  return tableBodyMatch ? parseStandingsRows(tableBodyMatch[1], teamDirectory) : [];
}

function parseAfaDateToUtc(value) {
  const match = String(value ?? '').match(
    /(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/,
  );

  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:00-03:00`).toISOString();
}

function normalizeFormation(value) {
  return normalizeWhitespace(value).replace(/\s*-\s*/g, '-');
}

function getInnerHtmlByClass(html, className) {
  const startMarker = `class="${className}"`;
  const start = html.indexOf(startMarker);

  if (start === -1) {
    return '';
  }

  const contentStart = html.indexOf('>', start);

  if (contentStart === -1) {
    return '';
  }

  let depth = 1;
  let cursor = contentStart + 1;

  while (cursor < html.length) {
    const nextOpen = html.indexOf('<div', cursor);
    const nextClose = html.indexOf('</div>', cursor);

    if (nextClose === -1) {
      break;
    }

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + 4;
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return html.slice(contentStart + 1, nextClose);
    }

    cursor = nextClose + 6;
  }

  return '';
}

function parseAfaLineupPlayers(sectionHtml, role) {
  return [...sectionHtml.matchAll(/<div class="player(?! coach)[^"]*"[^>]*>([\s\S]*?)<\/div>/g)]
    .map((playerMatch) => {
      const playerHtml = playerMatch[1];
      const name = normalizeWhitespace(playerHtml.match(/<span class="name">([\s\S]*?)<\/span>/)?.[1] ?? '');
      const shirtNumber = normalizeWhitespace(
        playerHtml.match(/<span class="number">([\s\S]*?)<\/span>/)?.[1] ?? '',
      );

      if (!name) {
        return null;
      }

      return {
        role,
        name,
        shirtNumber: shirtNumber === '' ? null : Number.parseInt(shirtNumber, 10),
        positionLabel: null,
      };
    })
    .filter(Boolean);
}

function parseAfaNumericStat(html, className) {
  const rawValue = normalizeWhitespace(
    html.match(new RegExp(`class="${className}[^"]*">([\\s\\S]*?)<\\/`, 'i'))?.[1] ?? '',
  );

  if (rawValue === '') {
    return null;
  }

  const parsed = Number.parseFloat(rawValue.replace(',', '.').replace('%', ''));
  return Number.isFinite(parsed) ? parsed : rawValue;
}

function parseAfaComparisonBars(html) {
  const stats = new Map();

  for (const match of html.matchAll(
    /<div data-stat-type="([^"]+)" class="boxWrapper mc-comparing[\s\S]*?<span class="text number mc-comparing-num1[^"]*">([\s\S]*?)<\/span>[\s\S]*?<span class="text number mc-comparing-num2[^"]*">([\s\S]*?)<\/span>/g,
  )) {
    const statType = match[1];
    const homeValue = normalizeWhitespace(match[2]);
    const awayValue = normalizeWhitespace(match[3]);

    if (homeValue === '' && awayValue === '') {
      continue;
    }

    stats.set(statType, {
      home: Number.parseFloat(homeValue.replace(',', '.')),
      away: Number.parseFloat(awayValue.replace(',', '.')),
    });
  }

  return stats;
}

function parseNumericValue(value) {
  const normalized = normalizeWhitespace(value).replace('%', '').replace(',', '.');

  if (normalized === '') {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseLpfScore(html, side) {
  const match = html.match(
    new RegExp(`<td class="Opta-Score Opta-${side}[^"]*"><span class="Opta-Team-Score\\s*">(\\d+)<\\/span>`, 'i'),
  );

  return match ? Number.parseInt(match[1], 10) : 0;
}

function parseLpfLineupTable(tableHtml, formation, opponentTeamName = null) {
  const teamName = normalizeWhitespace(tableHtml.match(/<h3><span>([\s\S]*?)<\/span><\/h3>/)?.[1] ?? '');
  const rows = [...tableHtml.matchAll(/<tr class="([^"]+)">([\s\S]*?)<\/tr>/g)];
  const starters = [];
  const bench = [];
  const events = [];
  let role = 'starter';

  for (const row of rows) {
    const className = row[1];
    const rowHtml = row[2];

    if (className.includes('Opta-Position')) {
      const sectionTitle = normalizeWhitespace(rowHtml);

      if (/Suplentes/i.test(sectionTitle)) {
        role = 'bench';
      }

      continue;
    }

    if (className.includes('Opta-Manager') || className.includes('Opta-Name')) {
      continue;
    }

    if (!className.includes('Opta-Player')) {
      continue;
    }

    const shirtNumberRaw = normalizeWhitespace(
      rowHtml.match(/<td class="Opta-Shirt">([\s\S]*?)<\/td>/)?.[1] ?? '',
    );
    const nameCellHtml = rowHtml.match(/<td class="Opta-Name">([\s\S]*?)<\/td>/)?.[1] ?? '';
    const name = normalizeWhitespace(nameCellHtml.replace(/<span[\s\S]*?<\/span>/g, ''));
    const positionTitle = normalizeWhitespace(
      rowHtml.match(/<abbr title="([^"]+)"/)?.[1] ??
        rowHtml.match(/<td class="Opta-Position">([\s\S]*?)<\/td>/)?.[1] ??
        '',
    );

    if (!name) {
      continue;
    }

    const player = {
      role,
      name,
      shirtNumber: shirtNumberRaw === '' || shirtNumberRaw === '-' ? null : Number.parseInt(shirtNumberRaw, 10),
      positionLabel: /^Suplente$/i.test(positionTitle) ? null : positionTitle || null,
    };

    for (const eventMatch of rowHtml.matchAll(
      /<span[^>]+class="Opta-Icon\s+(Opta-Icon[^"\s]+)[^"]*"[^>]*><\/span>\s*<span class="Opta-Event-Text"><span class="Opta-Event-Time">([^<]+)<abbr[^>]*>'<\/abbr>/g,
    )) {
      const iconClass = eventMatch[1];
      const minuteMatch = normalizeWhitespace(eventMatch[2]).match(/(\d+)(?:\+(\d+))?/);

      if (!minuteMatch) {
        continue;
      }

      let eventType = null;

      if (iconClass === 'Opta-IconGoal') {
        eventType = 'goal';
      } else if (iconClass === 'Opta-IconPenGoal') {
        eventType = 'penalty_goal';
      } else if (iconClass === 'Opta-IconOwn') {
        eventType = 'own_goal';
      } else if (iconClass === 'Opta-IconYellow') {
        eventType = 'yellow_card';
      } else if (iconClass === 'Opta-IconRed') {
        eventType = 'red_card';
      } else if (iconClass === 'Opta-Icon2ndYellowRed') {
        eventType = 'second_yellow_red';
      }

      if (!eventType) {
        continue;
      }

      events.push({
        eventType,
        minute: Number.parseInt(minuteMatch[1], 10),
        extraMinute: minuteMatch[2] ? Number.parseInt(minuteMatch[2], 10) : null,
        playerName: name,
        teamName: eventType === 'own_goal' ? opponentTeamName ?? teamName : teamName,
      });
    }

    if (role === 'starter') {
      starters.push(player);
    } else {
      bench.push(player);
    }
  }

  return {
    teamName,
    formation: formation || null,
    starters,
    bench,
    events,
  };
}

function extractLpfTeamNameFromComment(comment) {
  const cornerOrOffside = comment.match(/^(?:Corner|Fuera de juego),\s*([^.,]+?)\./i);

  if (cornerOrOffside) {
    return normalizeWhitespace(cornerOrOffside[1]);
  }

  const playerTeam = comment.match(/\(([^)]+)\)/);
  return playerTeam ? normalizeWhitespace(playerTeam[1]) : null;
}

function createEmptyLpfStats() {
  return {
    goals: 0,
    penalty_goals: 0,
    possession_percentage: null,
    total_scoring_att: 0,
    shots_on_target: 0,
    shots_off_target: 0,
    shots_on_woodwork: 0,
    yellowCard: 0,
    redCard: 0,
    fk_foul_lost: 0,
    total_offside: 0,
    corner_taken: 0,
    saves: 0,
    assists: 0,
  };
}

function parseLpfPossession(html) {
  const homeRaw = html.match(/<text class="Opta-possession Opta-Home"[^>]*>([^<]+)<\/text>/)?.[1] ?? '';
  const awayRaw = html.match(/<text class="Opta-possession Opta-Away"[^>]*>([^<]+)<\/text>/)?.[1] ?? '';

  return {
    home: parseNumericValue(homeRaw),
    away: parseNumericValue(awayRaw),
  };
}

function parseLpfCommentaryStats(html, homeTeamName, awayTeamName) {
  const homeStats = createEmptyLpfStats();
  const awayStats = createEmptyLpfStats();
  const teamMap = new Map([
    [homeTeamName, homeStats],
    [awayTeamName, awayStats],
  ]);

  const comments = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)];

  for (const commentMatch of comments) {
    const itemHtml = commentMatch[1];
    const comment = normalizeWhitespace(
      itemHtml.match(/<span class="Opta-comment\s*">([\s\S]*?)<\/span>/)?.[1] ?? '',
    );

    if (!comment) {
      continue;
    }

    const eventClass = itemHtml.match(/Opta-Event Opta-Icon (Opta-Icon[^\s"]+)/)?.[1] ?? '';
    const teamName = extractLpfTeamNameFromComment(comment);
    const teamStats = teamName ? teamMap.get(teamName) : null;

    if (/^Corner,/i.test(comment) && teamStats) {
      teamStats.corner_taken += 1;
    }

    if (/^Fuera de juego,/i.test(comment) && teamStats) {
      teamStats.total_offside += 1;
    }

    if (/^Falta de /i.test(comment) && teamStats) {
      teamStats.fk_foul_lost += 1;
    }

    if (/^Remate /i.test(comment) && teamStats) {
      teamStats.total_scoring_att += 1;

      if (/Remate rechazado/i.test(comment)) {
        // Counted in total shots only.
      } else if (/Remate parado/i.test(comment)) {
        teamStats.shots_on_target += 1;
        const opponentStats = teamName === homeTeamName ? awayStats : homeStats;
        opponentStats.saves += 1;
      } else if (/larguero|poste|palo/i.test(comment)) {
        teamStats.shots_on_woodwork += 1;
      } else if (/Remate fallado/i.test(comment)) {
        teamStats.shots_off_target += 1;
      }
    }

    if (eventClass.includes('Opta-IconGoal') && teamStats) {
      teamStats.goals += 1;
      teamStats.shots_on_target += 1;

      if (/Asistencia de /i.test(comment)) {
        teamStats.assists += 1;
      }
    }

    if (eventClass.includes('Opta-IconYellow') && teamStats) {
      teamStats.yellowCard += 1;
    }

    if ((eventClass.includes('Opta-IconRed') || eventClass.includes('Opta-Icon2ndYellowRed')) && teamStats) {
      teamStats.redCard += 1;
    }
  }

  return {
    home: homeStats,
    away: awayStats,
  };
}

const AFA_TEAM_SLUG_ALIASES = {
  argentinos: 'argentinos-juniors',
  'argentinos-juniors': 'argentinos-juniors',
  'atl-tucuman': 'atletico-tucuman',
  'atletico-tucuman': 'atletico-tucuman',
  'barracas-c': 'barracas-central',
  'barracas-central': 'barracas-central',
  boca: 'boca-juniors',
  'boca-juniors': 'boca-juniors',
  'c-cordoba-se': 'central-cordoba-santiago-del-estero',
  'central-cordoba-se': 'central-cordoba-santiago-del-estero',
  defensa: 'defensa-y-justicia',
  'defensa-y-justicia': 'defensa-y-justicia',
  'dep-riestra': 'deportivo-riestra',
  riestra: 'deportivo-riestra',
  'deportivo-riestra': 'deportivo-riestra',
  estudiantes: 'estudiantes-de-la-plata',
  'estudiantes-de-la-plata': 'estudiantes-de-la-plata',
  'estudiantes-rc': 'estudiantes-rio-cuarto',
  'estudiantes-rio-cuarto': 'estudiantes-rio-cuarto',
  gimnasia: 'gimnasia-la-plata',
  'gimnasia-la-plata': 'gimnasia-la-plata',
  'gimnasia-m': 'gimnasia-mendoza',
  'gimnasia-mendoza': 'gimnasia-mendoza',
  'indep-mza': 'independiente-rivadavia',
  'independiente-riv-m': 'independiente-rivadavia',
  'independiente-rivadavia': 'independiente-rivadavia',
  "newell-s": 'newell-s-old-boys',
  'newell-s-old-boys': 'newell-s-old-boys',
  'r-central': 'rosario-central',
  'rosario-central': 'rosario-central',
  racing: 'racing-club',
  'racing-club': 'racing-club',
  river: 'river-plate',
  'river-plate': 'river-plate',
  talleres: 'talleres-de-cordoba',
  'talleres-de-cordoba': 'talleres-de-cordoba',
  union: 'union-santa-fe',
  'union-santa-fe': 'union-santa-fe',
  velez: 'velez-sarsfield',
  'velez-sarsfield': 'velez-sarsfield',
};

export function resolveAfaTeamSlug(teamName) {
  const baseSlug = slugifyArgentinaTeam(teamName)
    .replace(/^atl-/, 'atletico-')
    .replace(/^dep-/, 'deportivo-')
    .replace(/^r-/, 'r-');

  return AFA_TEAM_SLUG_ALIASES[baseSlug] ?? baseSlug;
}

export async function fetchAfaFixtureMatches() {
  const html = await fetchHtml(ARGENTINA_AFA_FIXTURE_URL);

  const matches = [];

  for (const match of html.matchAll(
    /<div[^>]+class="([^"]*mc-matchContainer[^"]*)"[^>]+data-channel="([^"]+)"[^>]+data-originaldate="([^"]*)"[\s\S]*?<div class="col-lg-5 col-6 local[\s\S]*?<img[^>]+alt="([^"]*)"[\s\S]*?<div class="equipo[^"]*">([\s\S]*?)<\/div>[\s\S]*?<div class="col-lg-5 col-6 visitante[\s\S]*?<div class="equipo[^"]*">([\s\S]*?)<\/div>[\s\S]*?<img[^>]+alt="([^"]*)"[\s\S]*?<a class="btn matchLink[^"]*" href="([^"]+)"/g,
  )) {
    const className = match[1];
    const channel = match[2];
    const originalDate = match[3];
    const homeAlt = normalizeWhitespace(match[4]);
    const homeLabel = normalizeWhitespace(match[5]);
    const awayLabel = normalizeWhitespace(match[6]);
    const awayAlt = normalizeWhitespace(match[7]);
    const sourceUrl = decodeHtmlEntities(match[8]).replace('/minapp/../', '/');

    const homeName = homeAlt || homeLabel;
    const awayName = awayAlt || awayLabel;

    if (!channel || !homeName || !awayName) {
      continue;
    }

    matches.push({
      channel,
      status:
        className.includes('status-finished')
          ? 'finished'
          : className.includes('status-live')
            ? 'live'
            : 'scheduled',
      matchDateUtc: parseAfaDateToUtc(originalDate),
      homeTeamName: homeName,
      awayTeamName: awayName,
      homeTeamSlug: resolveAfaTeamSlug(homeName),
      awayTeamSlug: resolveAfaTeamSlug(awayName),
      sourceUrl: sourceUrl.startsWith('http')
        ? sourceUrl
        : `https://info.afa.org.ar${sourceUrl.startsWith('/') ? '' : '/'}${sourceUrl}`,
    });
  }

  return matches;
}

export async function fetchAfaMatchPageData(matchUrl) {
  const html = await fetchHtml(matchUrl);

  const homeFormation = normalizeFormation(
    html.match(/class="GC_title mc-home-tactic[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? '',
  );
  const awayFormation = normalizeFormation(
    html.match(/class="GC_title mc-away-tactic[^"]*">([\s\S]*?)<\/div>/)?.[1] ?? '',
  );

  const homeStarters = parseAfaLineupPlayers(getInnerHtmlByClass(html, 'home mc-home-starting'), 'starter');
  const awayStarters = parseAfaLineupPlayers(
    getInnerHtmlByClass(html, 'away mc-away-starting display'),
    'starter',
  );
  const homeBench = parseAfaLineupPlayers(
    getInnerHtmlByClass(
      html,
      'col-lg-6 col-md-6 col-sm-6 col-12 home mc-home-substitutes position-relative float-left w-lg-50 text-left pt-2',
    ),
    'bench',
  );
  const awayBench = parseAfaLineupPlayers(
    getInnerHtmlByClass(
      html,
      'col-lg-6 col-md-6 col-sm-6 col-12 away mc-away-substitutes position-relative float-left w-lg-50 text-right pt-2',
    ),
    'bench',
  );

  const comparisonBars = parseAfaComparisonBars(html);
  const shots = comparisonBars.get('shots');
  const saves = comparisonBars.get('saves');
  const assists = comparisonBars.get('assists');
  const fouls = comparisonBars.get('fouls');
  const offsides = comparisonBars.get('offsides');
  const corners = comparisonBars.get('cornerKicks');
  const clearances = comparisonBars.get('clearances');

  return {
    matchUrl,
    lineups: {
      home: {
        formation: homeFormation || null,
        starters: homeStarters,
        bench: homeBench,
      },
      away: {
        formation: awayFormation || null,
        starters: awayStarters,
        bench: awayBench,
      },
    },
    stats: {
      home: {
        goals: parseAfaNumericStat(html, 'mc-goals_1'),
        total_scoring_att:
          parseAfaNumericStat(html, 'mc-PlayerComparisonShotsTotal_1') ?? shots?.home ?? null,
        shots_on_target: parseAfaNumericStat(html, 'mc-onTarget_1'),
        shots_on_woodwork: parseAfaNumericStat(html, 'mc-onWoodwork_1'),
        shots_off_target: parseAfaNumericStat(html, 'mc-offTarget_1'),
        yellowCard: parseAfaNumericStat(html, 'mc-yellowCard_1'),
        redCard: parseAfaNumericStat(html, 'mc-redCard_1'),
        fk_foul_lost: fouls?.home ?? null,
        total_offside: offsides?.home ?? null,
        corner_taken: corners?.home ?? null,
        saves: saves?.home ?? null,
        assists: assists?.home ?? null,
        clearances: clearances?.home ?? null,
      },
      away: {
        goals: parseAfaNumericStat(html, 'mc-goals_2'),
        total_scoring_att:
          parseAfaNumericStat(html, 'mc-PlayerComparisonShotsTotal_2') ?? shots?.away ?? null,
        shots_on_target: parseAfaNumericStat(html, 'mc-onTarget_2'),
        shots_on_woodwork: parseAfaNumericStat(html, 'mc-onWoodwork_2'),
        shots_off_target: parseAfaNumericStat(html, 'mc-offTarget_2'),
        yellowCard: parseAfaNumericStat(html, 'mc-yellowCard_2'),
        redCard: parseAfaNumericStat(html, 'mc-redCard_2'),
        fk_foul_lost: fouls?.away ?? null,
        total_offside: offsides?.away ?? null,
        corner_taken: corners?.away ?? null,
        saves: saves?.away ?? null,
        assists: assists?.away ?? null,
        clearances: clearances?.away ?? null,
      },
    },
  };
}

export async function fetchLpfMatchPageData(matchUrl) {
  const html = renderUrlWithBrowser(matchUrl);

  const formations = [...html.matchAll(/<div class="Opta-TeamFormation">([^<]+)<\/div>/g)].map((match) =>
    normalizeFormation(match[1]),
  );
  const squadTables = [...html.matchAll(
    /<table class="Opta-Striped Opta-Squad Opta-IconTable Opta-(Home|Away)">([\s\S]*?)<\/table>/g,
  )];

  if (squadTables.length < 2) {
    throw new Error(`La pagina LPF no trajo tablas de alineacion para ${matchUrl}`);
  }

  const homeTeamName = normalizeWhitespace(
    squadTables[0][2].match(/<h3><span>([\s\S]*?)<\/span><\/h3>/)?.[1] ?? '',
  );
  const awayTeamName = normalizeWhitespace(
    squadTables[1][2].match(/<h3><span>([\s\S]*?)<\/span><\/h3>/)?.[1] ?? '',
  );
  const homeLineup = parseLpfLineupTable(squadTables[0][2], formations[0] ?? null, awayTeamName);
  const awayLineup = parseLpfLineupTable(squadTables[1][2], formations[1] ?? null, homeTeamName);
  const stats = parseLpfCommentaryStats(html, homeLineup.teamName, awayLineup.teamName);
  const possession = parseLpfPossession(html);

  stats.home.possession_percentage = possession.home;
  stats.away.possession_percentage = possession.away;

  const homeScore = parseLpfScore(html, 'Home');
  const awayScore = parseLpfScore(html, 'Away');

  if (!stats.home.goals) {
    stats.home.goals = homeScore;
  }

  if (!stats.away.goals) {
    stats.away.goals = awayScore;
  }

  stats.home.shots_on_target = Math.max(stats.home.shots_on_target, stats.home.goals);
  stats.away.shots_on_target = Math.max(stats.away.shots_on_target, stats.away.goals);

  for (const event of [...homeLineup.events, ...awayLineup.events]) {
    if (event.eventType === 'penalty_goal') {
      if (event.teamName === homeLineup.teamName) {
        stats.home.penalty_goals += 1;
      }

      if (event.teamName === awayLineup.teamName) {
        stats.away.penalty_goals += 1;
      }
    }
  }

  return {
    matchUrl,
    lineups: {
      home: {
        teamName: homeLineup.teamName,
        formation: homeLineup.formation,
        starters: homeLineup.starters,
        bench: homeLineup.bench,
      },
      away: {
        teamName: awayLineup.teamName,
        formation: awayLineup.formation,
        starters: awayLineup.starters,
        bench: awayLineup.bench,
      },
    },
    stats,
    events: [...homeLineup.events, ...awayLineup.events],
  };
}

export function fetchArgentinaTournamentData() {
  const html = renderArgentinaTournamentPageHtml();
  const teamDirectory = buildTeamDirectory(html);
  const fixturesHtml = getSectionBetween(html, '<div id="Opta_0"', '<div id="Opta_1"');
  const groupedStandingsHtml = getSectionBetween(html, '<div id="Opta_2"', '<div id="Opta_3"');
  const generalStandingsHtml = getSectionBetween(html, '<div id="Opta_3"', '<div id="Opta_4"');

  return {
    fixtures: parseFixtures(fixturesHtml, teamDirectory),
    standings: {
      groupA: parseGroupedStandings(groupedStandingsHtml, teamDirectory)['Grupo A'] ?? [],
      groupB: parseGroupedStandings(groupedStandingsHtml, teamDirectory)['Grupo B'] ?? [],
      general: parseGeneralStandings(generalStandingsHtml, teamDirectory),
    },
    teamDirectory,
  };
}
