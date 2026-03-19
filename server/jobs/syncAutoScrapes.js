import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from '../db.js';
import { finishScrapeRun, startScrapeRun } from '../repositories/matchesRepository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MATCH_PAST_BUFFER_HOURS = 12;
const UPCOMING_LOOKAHEAD_HOURS = 72;
const RECENT_LOOKBACK_DAYS = 3;

const LEAGUES = [
  {
    key: 'laliga',
    sourceName: 'LALIGA',
    detailSourceName: 'LALIGA',
    competitionSlug: 'laliga-ea-sports-2025-2026',
    seasonScript: 'syncLaLigaSeasonMatches.js',
    standingsScript: 'syncLaLigaStandings.js',
    detailScript: 'syncLaLigaMatchDetails.js',
    extraEnv: {},
  },
  {
    key: 'premier',
    sourceName: 'PREMIER',
    detailSourceName: 'PREMIER',
    competitionSlug: 'premier-league-2025-2026',
    seasonScript: 'syncPremierLeagueSeasonMatches.js',
    standingsScript: 'syncPremierLeagueStandings.js',
    detailScript: 'syncPremierLeagueMatchDetails.js',
    extraEnv: {},
  },
  {
    key: 'bundesliga',
    sourceName: 'BUNDESLIGA',
    detailSourceName: 'BUNDESLIGA',
    competitionSlug: 'bundesliga-2025-2026',
    seasonScript: 'syncBundesligaSeasonMatches.js',
    standingsScript: 'syncBundesligaStandings.js',
    detailScript: 'syncBundesligaMatchDetails.js',
    extraEnv: {},
  },
  {
    key: 'argentina',
    sourceName: 'LPF',
    detailSourceName: 'LPF',
    competitionSlug: 'liga-profesional-apertura-2026',
    seasonScript: 'syncArgentinaSeasonMatches.js',
    standingsScript: 'syncArgentinaStandings.js',
    detailScript: 'syncArgentinaMatchDetails.js',
    extraEnv: {
      RESET: '0',
    },
  },
  {
    key: 'seriea',
    sourceName: 'SERIEA',
    detailSourceName: 'SERIEA',
    competitionSlug: 'serie-a-2025-2026',
    seasonScript: 'syncSerieASeasonMatches.js',
    standingsScript: 'syncSerieAStandings.js',
    detailScript: 'syncSerieAMatchDetails.js',
    extraEnv: {},
  },
];

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function getLatestAutoSyncAt(leagueKey) {
  return (
    db
      .prepare(
        `
          SELECT finished_at
          FROM scrape_runs
          WHERE source_name = 'AUTO'
            AND target = ?
            AND status = 'success'
          ORDER BY datetime(finished_at) DESC, id DESC
          LIMIT 1
        `,
      )
      .get(`auto-sync-${leagueKey}`)?.finished_at ?? null
  );
}

function getNextMatchDate(competitionSlug, lastAutoSyncAt) {
  return (
    db
      .prepare(
        `
          SELECT match_date_utc
          FROM matches m
          JOIN competitions c ON c.id = m.competition_id
          WHERE c.slug = ?
            AND datetime(m.match_date_utc) > datetime(?)
          ORDER BY datetime(m.match_date_utc) ASC, m.id ASC
          LIMIT 1
        `,
      )
      .get(competitionSlug, lastAutoSyncAt ?? '1970-01-01T00:00:00.000Z')?.match_date_utc ?? null
  );
}

function getLatestPlayedMatchDate(competitionSlug, lastAutoSyncAt) {
  return (
    db
      .prepare(
        `
          SELECT match_date_utc
          FROM matches m
          JOIN competitions c ON c.id = m.competition_id
          WHERE c.slug = ?
            AND datetime(m.match_date_utc) <= datetime('now')
            AND datetime(m.match_date_utc) > datetime(?)
          ORDER BY datetime(m.match_date_utc) DESC, m.id DESC
          LIMIT 1
        `,
      )
      .get(competitionSlug, lastAutoSyncAt ?? '1970-01-01T00:00:00.000Z')
      ?.match_date_utc ?? null
  );
}

function getLatestPendingDetailMatchDate(competitionSlug, detailSourceName) {
  return (
    db
      .prepare(
        `
          SELECT m.match_date_utc
          FROM matches m
          JOIN competitions c ON c.id = m.competition_id
          WHERE c.slug = ?
            AND datetime(m.match_date_utc) <= datetime('now')
            AND datetime(m.match_date_utc) >= datetime('now', ?)
            AND (
              (SELECT COUNT(*) FROM lineups l WHERE l.match_id = m.id) < 2
              OR (SELECT COUNT(*) FROM match_team_stats mts WHERE mts.match_id = m.id AND mts.source_name = ?) = 0
              OR (SELECT COUNT(*) FROM match_events me WHERE me.match_id = m.id) = 0
            )
          ORDER BY datetime(m.match_date_utc) DESC, m.id DESC
          LIMIT 1
        `,
      )
      .get(competitionSlug, `-${RECENT_LOOKBACK_DAYS} days`, detailSourceName)?.match_date_utc ?? null
  );
}

function runJob(scriptName, env = {}) {
  const scriptPath = path.join(__dirname, scriptName);
  return spawnSync(process.execPath, [scriptPath], {
    cwd: path.resolve(__dirname, '..', '..'),
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
  });
}

const run = startScrapeRun({
  sourceName: 'AUTO',
  target: 'auto-sync',
});

try {
  const now = new Date();
  const summary = [];
  let syncedLeagues = 0;

  for (const league of LEAGUES) {
    const seasonResult = runJob(league.seasonScript);
    if (seasonResult.status !== 0) {
      throw new Error(
        `Fallo ${league.seasonScript}: ${seasonResult.stderr || seasonResult.stdout}`,
      );
    }

    const lastAutoSyncAt = getLatestAutoSyncAt(league.key);
    const latestPendingDetailMatchDate = getLatestPendingDetailMatchDate(
      league.competitionSlug,
      league.detailSourceName,
    );
    const latestPlayedMatchDate = getLatestPlayedMatchDate(league.competitionSlug, lastAutoSyncAt);
    const nextMatchDate = getNextMatchDate(league.competitionSlug, lastAutoSyncAt);
    const anchorDateString = latestPendingDetailMatchDate ?? latestPlayedMatchDate ?? null;
    const shouldSync = Boolean(anchorDateString);

    if (!shouldSync) {
      summary.push({
        league: league.key,
        synced: false,
        reason: nextMatchDate
          ? `Esperando que pase el proximo partido (${nextMatchDate})`
          : 'Sin partidos futuros para programar',
      });
      continue;
    }

    const anchorDate = new Date(anchorDateString);
    const windowFromUtc = addHours(anchorDate, -MATCH_PAST_BUFFER_HOURS).toISOString();
    const windowToUtc = addHours(anchorDate, UPCOMING_LOOKAHEAD_HOURS).toISOString();

    const standingsResult = runJob(league.standingsScript);
    if (standingsResult.status !== 0) {
      throw new Error(
        `Fallo ${league.standingsScript}: ${standingsResult.stderr || standingsResult.stdout}`,
      );
    }

    const detailResult = runJob(league.detailScript, {
      INCLUDE_UPCOMING: '1',
      MATCH_WINDOW_FROM_UTC: windowFromUtc,
      MATCH_WINDOW_TO_UTC: windowToUtc,
      ...league.extraEnv,
    });

    if (detailResult.status !== 0) {
      throw new Error(
        `Fallo ${league.detailScript}: ${detailResult.stderr || detailResult.stdout}`,
      );
    }

    const leagueRun = startScrapeRun({
      sourceName: 'AUTO',
      target: `auto-sync-${league.key}`,
    });
    finishScrapeRun(leagueRun.id, {
      status: 'success',
      itemsFound: 1,
      itemsSaved: 1,
    });

    syncedLeagues += 1;
    summary.push({
      league: league.key,
      synced: true,
      anchorDate: anchorDateString,
      latestPendingDetailMatchDate,
      latestPlayedMatchDate,
      nextMatchDate,
      windowFromUtc,
      windowToUtc,
    });
  }

  const result = finishScrapeRun(run.id, {
    status: 'success',
    itemsFound: LEAGUES.length,
    itemsSaved: syncedLeagues,
  });

  console.log(
    JSON.stringify(
      {
        ...result,
        summary,
      },
      null,
      2,
    ),
  );
} catch (error) {
  const result = finishScrapeRun(run.id, {
    status: 'error',
    errorMessage: error.message,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
}
