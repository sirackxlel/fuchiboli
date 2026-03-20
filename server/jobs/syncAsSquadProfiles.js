import db from '../db.js';
import { getTeamsForCompetitionKey } from '../repositories/readRepository.js';
import { replaceTeamSquadProfiles } from '../repositories/squadProfilesRepository.js';

const ROOT_URL = 'https://en.as.com';
const SOURCE_NAME = 'AS';
const BUNDESLIGA_PLAYERS_URL = 'https://www.bundesliga.com/es/bundesliga/jugador';
const PREMIER_PLAYERS_API_URL =
  'https://sdp-prem-prod.premier-league-prod.pulselive.com/api/v1/competitions/8/seasons/2025/players';
const PREMIER_PHOTO_BASE_URL =
  'https://resources.premierleague.com/premierleague25/photos/players/110x140';

const COMPETITIONS = [
  {
    key: 'laliga',
    competitionSlug: 'laliga-ea-sports-2025-2026',
    teamsUrl: `${ROOT_URL}/resultados/futbol/primera/2025_2026/equipos/`,
    source: 'as',
  },
  {
    key: 'argentina',
    competitionSlug: 'liga-profesional-apertura-2026',
    teamsUrl: `${ROOT_URL}/resultados/futbol/argentina/2026/equipos/`,
    source: 'as',
  },
  {
    key: 'seriea',
    competitionSlug: 'serie-a-2025-2026',
    teamsUrl: `${ROOT_URL}/resultados/futbol/italia/2025_2026/equipos/`,
    source: 'as',
  },
  {
    key: 'bundesliga',
    competitionSlug: 'bundesliga-2025-2026',
    playersUrl: BUNDESLIGA_PLAYERS_URL,
    source: 'bundesliga',
  },
  {
    key: 'premier',
    competitionSlug: 'premier-league-2025-2026',
    playersApiUrl: PREMIER_PLAYERS_API_URL,
    source: 'premier',
  },
];

const TEAM_NAME_ALIASES = {
  laliga: {
    alaves: 'deportivo alaves',
    athletic: 'athletic club',
    atletico: 'atletico de madrid',
    barcelona: 'fc barcelona',
    betis: 'real betis',
    elche: 'elche cf',
    espanyol: 'rcd espanyol de barcelona',
    getafe: 'getafe cf',
    girona: 'girona fc',
    levante: 'levante ud',
    mallorca: 'rcd mallorca',
    osasuna: 'ca osasuna',
    oviedo: 'real oviedo',
    'r sociedad': 'real sociedad',
    rayo: 'rayo vallecano',
    sevilla: 'sevilla fc',
    valencia: 'valencia cf',
    villarreal: 'villarreal cf',
  },
  argentina: {
    'at tucuman': 'atletico tucuman',
    estudiantes: 'estudiantes de la plata',
    'newell s old boys': "newell's old boys",
    'san lorenzo de almagro': 'san lorenzo',
    talleres: 'talleres de cordoba',
  },
  seriea: {
    bolonia: 'bologna',
    'como 1907': 'como',
    napoles: 'napoli',
    verona: 'hellas verona',
  },
  bundesliga: {
    augsburg: 'fc augsburg',
    bayern: 'fc bayern munchen',
    bremen: 'sv werder bremen',
    dortmund: 'borussia dortmund',
    frankfurt: 'eintracht frankfurt',
    freiburg: 'sport club freiburg',
    hamburg: 'hamburger sv',
    heidenheim: '1 fc heidenheim 1846',
    hoffenheim: 'tsg hoffenheim',
    koln: '1 fc koln',
    leverkusen: 'bayer 04 leverkusen',
    leipzig: 'rb leipzig',
    mainz: '1 fsv mainz 05',
    'm gladbach': 'borussia monchengladbach',
    'monchengladbach': 'borussia monchengladbach',
    'rb leipzig': 'rb leipzig',
    'st pauli': 'fc st pauli',
    stuttgart: 'vfb stuttgart',
    'union berlin': '1 fc union berlin',
    werder: 'sv werder bremen',
    'werder bremen': 'sv werder bremen',
    wolfsburg: 'vfl wolfsburg',
  },
  premier: {},
};

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&ntilde;/gi, 'n')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtml(value) {
  return String(value ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function translatePosition(value) {
  const normalized = normalizeText(value);

  if (normalized === 'goalkeeper') {
    return 'Arquero';
  }

  if (normalized === 'defender') {
    return 'Defensor';
  }

  if (normalized === 'midfielder') {
    return 'Mediocampista';
  }

  if (normalized === 'forward') {
    return 'Delantero';
  }

  return decodeHtml(value) || null;
}

function resolveTeamNameKey(competitionKey, name) {
  const normalized = normalizeText(name);
  return TEAM_NAME_ALIASES[competitionKey]?.[normalized] ?? normalized;
}

function getLocalTeamsByKey(competitionKey) {
  const teams = getTeamsForCompetitionKey(competitionKey);
  return new Map(
    teams.map((team) => [
      resolveTeamNameKey(competitionKey, team.teamName),
      team,
    ]),
  );
}

function getTeamBySlug(teamSlug) {
  return db
    .prepare(
      `
        SELECT id, slug, name
        FROM teams
        WHERE slug = ?
      `,
    )
    .get(teamSlug);
}

function extractCompetitionTeamLinks(html) {
  const matches = [
    ...html.matchAll(
      /<a class="tm-ro_tm-n" href="([^"]+)">[\s\S]*?<span class="a_tb_tn">([\s\S]*?)<\/span>/g,
    ),
  ];

  return matches.map((match) => ({
    url: new URL(match[1], ROOT_URL).toString(),
    teamName: decodeHtml(match[2]),
  }));
}

function extractBundesligaPhotoMap(html) {
  const entries = [
    ...html.matchAll(
      /"slugifiedShort":"([^"]+)"[\s\S]*?"full":"([^"]+)"[\s\S]*?"playerImages":\{"FACE_CIRCLE":"([^"]+)"/g,
    ),
  ];
  const photoMap = new Map();

  for (const entry of entries) {
    photoMap.set(entry[1], {
      playerName: decodeHtml(entry[2]),
      photoUrl: decodeHtml(entry[3]),
    });
  }

  return photoMap;
}

function extractBundesligaTeamSquads(html) {
  const photoMap = extractBundesligaPhotoMap(html);
  const panels = html
    .split('<mat-expansion-panel ')
    .slice(1)
    .map((panel) => panel.split('</mat-expansion-panel>')[0]);

  return panels
    .map((panel) => {
      const teamName = decodeHtml(panel.match(/<h2[^>]*>([^<]+)<\/h2>/)?.[1] ?? '');

      if (!teamName) {
        return null;
      }

      const players = [];
      let currentPosition = null;
      const tokens = [
        ...panel.matchAll(
          /<div[^>]+class="col-12 position">([^<]+)<\/div>|(<div[^>]+class="col-12 col-md-6 col-lg-4 card">[\s\S]*?<\/player-card-simple><\/div>)/g,
        ),
      ];

      for (const token of tokens) {
        if (token[1]) {
          currentPosition = decodeHtml(token[1]);
          continue;
        }

        const cardHtml = token[2] ?? '';
        const playerHref = cardHtml.match(/href="([^"]+)"/)?.[1] ?? '';
        const playerSlug = playerHref.split('/').filter(Boolean).at(-1) ?? '';
        const firstName = decodeHtml(
          cardHtml.match(/class="playerName firstName">([^<]+)<\/span>/)?.[1] ?? '',
        );
        const lastName = decodeHtml(
          cardHtml.match(/class="playerName lastName">([^<]+)<\/span>/)?.[1] ?? '',
        );
        const playerName =
          photoMap.get(playerSlug)?.playerName ?? `${firstName} ${lastName}`.trim();
        const shirtNumber = Number.parseInt(
          decodeHtml(cardHtml.match(/class="playerNumber">([^<]+)<\/span>/)?.[1] ?? ''),
          10,
        );

        if (!playerName) {
          continue;
        }

        players.push({
          playerName,
          shirtNumber: Number.isFinite(shirtNumber) ? shirtNumber : null,
          positionLabel: currentPosition || null,
          photoUrl: photoMap.get(playerSlug)?.photoUrl ?? null,
        });
      }

      return {
        teamName,
        sourceUrl: BUNDESLIGA_PLAYERS_URL,
        players,
      };
    })
    .filter((entry) => entry?.teamName && entry.players.length > 0);
}

function translatePremierPosition(value) {
  return translatePosition(value);
}

async function fetchPremierTeamSquads() {
  const teamMap = new Map();
  let nextCursor = null;
  let safety = 0;

  while (safety < 20) {
    const url = new URL(PREMIER_PLAYERS_API_URL);
    url.searchParams.set('_limit', '100');

    if (nextCursor) {
      url.searchParams.set('_next', nextCursor);
    }

    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0',
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Premier respondio con ${response.status} en ${url}`);
    }

    const payload = await response.json();

    for (const player of payload.data ?? []) {
      const teamName = player.currentTeam?.name ?? null;

      if (!teamName) {
        continue;
      }

      const players = teamMap.get(teamName) ?? [];
      players.push({
        playerName: decodeHtml(
          player.name?.display ??
            [player.name?.firstName, player.name?.lastName].filter(Boolean).join(' '),
        ).trim(),
        shirtNumber: Number.isFinite(Number(player.shirtNum)) ? Number(player.shirtNum) : null,
        positionLabel: translatePremierPosition(player.position ?? null),
        photoUrl: `${PREMIER_PHOTO_BASE_URL}/${player.id?.playerId}.png`,
      });
      teamMap.set(teamName, players);
    }

    nextCursor = payload.pagination?._next ?? null;
    safety += 1;

    if (!nextCursor) {
      break;
    }
  }

  return [...teamMap.entries()].map(([teamName, players]) => ({
    teamName,
    sourceUrl: PREMIER_PLAYERS_API_URL,
    players,
  }));
}

function extractSquadPlayers(html) {
  const items = [
    ...html.matchAll(
      /<li class="col-md-2 col-sm-3 col-xs-6"[\s\S]*?<\/li>/g,
    ),
  ];

  return items
    .map((match) => {
      const cardHtml = match[0];
      const playerName = decodeHtml(
        cardHtml.match(/itemprop="name" class="ellipsis nom-jugador">([\s\S]*?)<\/span>/)?.[1] ?? '',
      );
      const positionLabel = translatePosition(
        cardHtml.match(/itemprop="jobTitle">([\s\S]*?)<\/span>/)?.[1] ?? '',
      );
      const shirtNumberRaw = decodeHtml(
        cardHtml.match(/class="info-team dorsal s-left s-tcenter">([\s\S]*?)<\/strong>/)?.[1] ?? '',
      );
      const photoUrlRaw =
        cardHtml.match(/<img[^>]+title="Photo of [^"]*"[^>]+src="([^"]+)"/)?.[1] ?? null;

      if (!playerName) {
        return null;
      }

      const shirtNumber = Number.parseInt(shirtNumberRaw, 10);

      return {
        playerName,
        shirtNumber: Number.isFinite(shirtNumber) ? shirtNumber : null,
        positionLabel,
        photoUrl: photoUrlRaw ? decodeHtml(photoUrlRaw) : null,
      };
    })
    .filter(Boolean);
}

function extractSquadPageUrl(teamPageHtml, teamPageUrl) {
  const squadHref =
    teamPageHtml.match(/data-item="plantilla"[^>]*href="([^"]+)"/)?.[1] ??
    `${teamPageUrl.replace(/\/$/, '')}/plantilla/`;

  return new URL(squadHref, ROOT_URL).toString();
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      'accept-language': 'es-AR,es;q=0.9,en;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`AS respondio con ${response.status} para ${url}`);
  }

  return response.text();
}

async function fetchTeamSquads(competition) {
  if (competition.source === 'bundesliga') {
    const html = await fetchHtml(competition.playersUrl);
    return extractBundesligaTeamSquads(html);
  }

  if (competition.source === 'premier') {
    return fetchPremierTeamSquads();
  }

  const teamsPageHtml = await fetchHtml(competition.teamsUrl);
  const teamLinks = extractCompetitionTeamLinks(teamsPageHtml);
  const teamSquads = [];

  for (const teamLink of teamLinks) {
    try {
      const teamPageHtml = await fetchHtml(teamLink.url);
      const squadUrl = extractSquadPageUrl(teamPageHtml, teamLink.url);
      const squadHtml = await fetchHtml(squadUrl);
      const players = extractSquadPlayers(squadHtml);

      teamSquads.push({
        teamName: teamLink.teamName,
        sourceUrl: squadUrl,
        players,
      });
    } catch (error) {
      teamSquads.push({
        teamName: teamLink.teamName,
        sourceUrl: teamLink.url,
        players: [],
        errorMessage: error.message,
      });
    }
  }

  return teamSquads;
}

const summary = [];

for (const competition of COMPETITIONS) {
  const localTeamsByKey = getLocalTeamsByKey(competition.key);
  let teamSquads = [];
  const warnings = [];

  try {
    teamSquads = await fetchTeamSquads(competition);
  } catch (error) {
    summary.push({
      competition: competition.key,
      teamsFound: 0,
      teamsSynced: 0,
      playersSynced: 0,
      warnings: [`Error general: ${error.message}`],
    });
    continue;
  }

  let syncedTeams = 0;
  let syncedPlayers = 0;

  for (const teamSquad of teamSquads) {
    const localTeam =
      localTeamsByKey.get(resolveTeamNameKey(competition.key, teamSquad.teamName)) ?? null;

    if (!localTeam) {
      warnings.push(`Sin match local para ${competition.key}: ${teamSquad.teamName}`);
      continue;
    }

    const team = getTeamBySlug(localTeam.teamSlug);

    if (!team) {
      warnings.push(`No existe el equipo ${localTeam.teamSlug} en teams`);
      continue;
    }

    const players = teamSquad.players ?? [];

    if (teamSquad.errorMessage) {
      warnings.push(`Error cargando ${competition.key} ${teamSquad.teamName}: ${teamSquad.errorMessage}`);
      continue;
    }

    if (players.length === 0) {
      warnings.push(`Sin jugadores parseados para ${competition.key}: ${teamSquad.teamName}`);
      continue;
    }

    replaceTeamSquadProfiles({
      teamId: team.id,
      competitionSlug: competition.competitionSlug,
      sourceName:
        competition.source === 'as'
          ? SOURCE_NAME
          : competition.source === 'bundesliga'
            ? 'BUNDESLIGA'
            : 'PREMIER',
      sourceUrl: teamSquad.sourceUrl,
      players,
    });

    syncedTeams += 1;
    syncedPlayers += players.length;
  }

  summary.push({
    competition: competition.key,
    teamsFound: teamSquads.length,
    teamsSynced: syncedTeams,
    playersSynced: syncedPlayers,
    warnings,
  });
}

console.log(JSON.stringify(summary, null, 2));
