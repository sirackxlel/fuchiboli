import fs from 'node:fs/promises';
import path from 'node:path';
import db from '../db.js';

const ROOT_DIR = path.resolve(process.cwd(), 'public', 'team-logos');
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';
const PREMIER_STATIC_BASE = 'https://resources.premierleague.com/premierleague25/badges';

function slugify(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function ensureDirectories() {
  await fs.mkdir(path.join(ROOT_DIR, 'laliga'), { recursive: true });
  await fs.mkdir(path.join(ROOT_DIR, 'premier'), { recursive: true });
}

function getLaLigaLogos() {
  const rows = db
    .prepare(
      `
        SELECT raw_payload
        FROM match_sources
        WHERE source_name = 'LALIGA'
          AND raw_payload LIKE '%"shield"%'
      `,
    )
    .all();

  const map = new Map();

  for (const row of rows) {
    const payload = JSON.parse(row.raw_payload);

    for (const side of ['home_team', 'away_team']) {
      const team = payload?.[side];
      const slug = team?.slug;
      const url =
        team?.shield?.resizes?.small ??
        team?.shield?.url ??
        null;

      if (slug && url && !map.has(slug)) {
        map.set(slug, {
          slug,
          url,
          extension: '.png',
        });
      }
    }
  }

  return [...map.values()];
}

function getPremierLogos() {
  const rows = db
    .prepare(
      `
        SELECT
          t.slug AS team_slug,
          ms.raw_payload
        FROM match_sources ms
        JOIN matches m ON m.id = ms.match_id
        JOIN competitions c ON c.id = m.competition_id
        JOIN teams t ON t.id IN (m.home_team_id, m.away_team_id)
        WHERE ms.source_name = 'PREMIER'
          AND c.slug = 'premier-league-2025-2026'
      `,
    )
    .all();

  const map = new Map();

  for (const row of rows) {
    const payload = JSON.parse(row.raw_payload);
    const rawMatch = payload?.match ?? {};

    const candidates = [
      { slug: slugify(rawMatch?.homeTeam?.name), teamId: rawMatch?.homeTeam?.id },
      { slug: slugify(rawMatch?.awayTeam?.name), teamId: rawMatch?.awayTeam?.id },
    ];

    for (const candidate of candidates) {
      if (candidate.slug && candidate.teamId && !map.has(candidate.slug)) {
        map.set(candidate.slug, {
          slug: candidate.slug,
          teamId: String(candidate.teamId),
        });
      }
    }
  }

  return [...map.values()];
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      accept: '*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`No se pudo descargar ${url} (${response.status}).`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(destinationPath, Buffer.from(arrayBuffer));
}

async function downloadPremierLogo(team) {
  const svgUrl = `${PREMIER_STATIC_BASE}/${team.teamId}.svg`;
  const pngUrl = `${PREMIER_STATIC_BASE}/50/${team.teamId}.png`;
  const svgDestination = path.join(ROOT_DIR, 'premier', `${team.slug}.svg`);
  const pngDestination = path.join(ROOT_DIR, 'premier', `${team.slug}.png`);

  try {
    await downloadFile(svgUrl, svgDestination);
    return `/team-logos/premier/${team.slug}.svg`;
  } catch {
    await downloadFile(pngUrl, pngDestination);
    return `/team-logos/premier/${team.slug}.png`;
  }
}

async function downloadLaLigaLogo(team) {
  const destination = path.join(ROOT_DIR, 'laliga', `${team.slug}${team.extension}`);
  await downloadFile(team.url, destination);
  return `/team-logos/laliga/${team.slug}${team.extension}`;
}

async function main() {
  await ensureDirectories();

  const manifest = {
    laliga: {},
    premier: {},
  };

  const laligaTeams = getLaLigaLogos();
  for (const team of laligaTeams) {
    manifest.laliga[team.slug] = await downloadLaLigaLogo(team);
  }

  const premierTeams = getPremierLogos();
  for (const team of premierTeams) {
    manifest.premier[team.slug] = await downloadPremierLogo(team);
  }

  await fs.writeFile(
    path.join(ROOT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );

  console.log(
    JSON.stringify(
      {
        laliga: Object.keys(manifest.laliga).length,
        premier: Object.keys(manifest.premier).length,
        output: path.join(ROOT_DIR, 'manifest.json'),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
