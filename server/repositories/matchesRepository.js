import db from '../db.js';
import { getTeamBySlug } from './teamsRepository.js';

function now() {
  return new Date().toISOString();
}

export function getCompetitionBySlug(slug) {
  return db.prepare('SELECT * FROM competitions WHERE slug = ?').get(slug) ?? null;
}

export function createCompetition({
  slug,
  name,
  country = null,
  seasonLabel = null,
  competitionType = 'league',
}) {
  const timestamp = now();
  const result = db
    .prepare(
      `
        INSERT INTO competitions (
          slug,
          name,
          country,
          season_label,
          competition_type,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(slug, name, country, seasonLabel, competitionType, timestamp, timestamp);

  return db.prepare('SELECT * FROM competitions WHERE id = ?').get(result.lastInsertRowid);
}

export function getOrCreateCompetition(competition) {
  return getCompetitionBySlug(competition.slug) ?? createCompetition(competition);
}

export function findMatchByCanonicalKey(canonicalKey) {
  return (
    db.prepare('SELECT * FROM matches WHERE canonical_key = ?').get(canonicalKey) ??
    null
  );
}

export function insertMatch(match) {
  const statement = db.prepare(`
    INSERT INTO matches (
      canonical_key,
      home_team_id,
      away_team_id,
      competition_id,
      match_date_utc,
      status,
      stage,
      round_name,
      venue_name,
      venue_city,
      home_score,
      away_score,
      status_detail,
      match_week,
      season_slug,
      source_priority,
      last_seen_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const timestamp = now();
  const result = statement.run(
    match.canonicalKey,
    match.homeTeamId,
    match.awayTeamId,
    match.competitionId ?? null,
    match.matchDateUtc,
    match.status,
    match.stage ?? null,
    match.roundName ?? null,
    match.venueName ?? null,
    match.venueCity ?? null,
    match.homeScore ?? null,
    match.awayScore ?? null,
    match.statusDetail ?? null,
    match.matchWeek ?? null,
    match.seasonSlug ?? null,
    match.sourcePriority ?? 0,
    timestamp,
    timestamp,
    timestamp,
  );

  return db.prepare('SELECT * FROM matches WHERE id = ?').get(result.lastInsertRowid);
}

export function updateMatch(id, match) {
  const statement = db.prepare(`
    UPDATE matches
    SET
      home_team_id = ?,
      away_team_id = ?,
      competition_id = ?,
      match_date_utc = ?,
      status = ?,
      stage = ?,
      round_name = ?,
      venue_name = ?,
      venue_city = ?,
      home_score = ?,
      away_score = ?,
      status_detail = ?,
      match_week = ?,
      season_slug = ?,
      source_priority = ?,
      last_seen_at = ?,
      updated_at = ?
    WHERE id = ?
  `);

  const timestamp = now();
  statement.run(
    match.homeTeamId,
    match.awayTeamId,
    match.competitionId ?? null,
    match.matchDateUtc,
    match.status,
    match.stage ?? null,
    match.roundName ?? null,
    match.venueName ?? null,
    match.venueCity ?? null,
    match.homeScore ?? null,
    match.awayScore ?? null,
    match.statusDetail ?? null,
    match.matchWeek ?? null,
    match.seasonSlug ?? null,
    match.sourcePriority ?? 0,
    timestamp,
    timestamp,
    id,
  );

  return db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
}

export function upsertMatch(match) {
  const existingMatch = findMatchByCanonicalKey(match.canonicalKey);

  if (existingMatch) {
    return updateMatch(existingMatch.id, match);
  }

  return insertMatch(match);
}

export function insertMatchSource(matchSource) {
  const statement = db.prepare(`
    INSERT INTO match_sources (
      match_id,
      source_name,
      source_match_id,
      source_url,
      raw_payload,
      fetched_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const timestamp = now();
  const result = statement.run(
    matchSource.matchId,
    matchSource.sourceName,
    matchSource.sourceMatchId ?? null,
    matchSource.sourceUrl ?? null,
    matchSource.rawPayload ?? null,
    matchSource.fetchedAt ?? timestamp,
    timestamp,
  );

  return db
    .prepare('SELECT * FROM match_sources WHERE id = ?')
    .get(result.lastInsertRowid);
}

export function startScrapeRun({ sourceName, target }) {
  const timestamp = now();
  const result = db
    .prepare(`
      INSERT INTO scrape_runs (
        source_name,
        target,
        status,
        started_at,
        items_found,
        items_saved
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(sourceName, target, 'running', timestamp, 0, 0);

  return db.prepare('SELECT * FROM scrape_runs WHERE id = ?').get(result.lastInsertRowid);
}

export function finishScrapeRun(id, data) {
  const timestamp = now();
  db.prepare(`
    UPDATE scrape_runs
    SET
      status = ?,
      finished_at = ?,
      items_found = ?,
      items_saved = ?,
      error_message = ?
    WHERE id = ?
  `).run(
    data.status,
    timestamp,
    data.itemsFound ?? 0,
    data.itemsSaved ?? 0,
    data.errorMessage ?? null,
    id,
  );

  return db.prepare('SELECT * FROM scrape_runs WHERE id = ?').get(id);
}
