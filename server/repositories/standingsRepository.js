import db from '../db.js';

function now() {
  return new Date().toISOString();
}

export function saveStandingsSnapshot({
  sourceName,
  competitionSlug,
  competitionName,
  season,
  sourceUrl,
  entries,
}) {
  const timestamp = now();
  const insertSnapshot = db.prepare(`
    INSERT INTO standings_snapshots (
      source_name,
      competition_slug,
      competition_name,
      season,
      source_url,
      fetched_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEntry = db.prepare(`
    INSERT INTO standings_entries (
      snapshot_id,
      team_slug,
      team_name,
      team_short_name,
      position,
      points,
      played,
      won,
      drawn,
      lost,
      goals_for,
      goals_against,
      goal_difference,
      qualification,
      logo_class,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    const snapshotResult = insertSnapshot.run(
      sourceName,
      competitionSlug,
      competitionName,
      season ?? null,
      sourceUrl ?? null,
      timestamp,
      timestamp,
    );

    for (const entry of entries) {
      insertEntry.run(
        snapshotResult.lastInsertRowid,
        entry.teamSlug,
        entry.teamName,
        entry.teamShortName ?? null,
        entry.position,
        entry.points,
        entry.played,
        entry.won,
        entry.drawn,
        entry.lost,
        entry.goalsFor,
        entry.goalsAgainst,
        entry.goalDifference,
        entry.qualification ?? null,
        entry.logoClass ?? null,
        timestamp,
      );
    }

    return db
      .prepare('SELECT * FROM standings_snapshots WHERE id = ?')
      .get(snapshotResult.lastInsertRowid);
  });

  return transaction();
}

export function getLatestStandingsSnapshot(competitionSlug) {
  return (
    db
      .prepare(
        `
          SELECT *
          FROM standings_snapshots
          WHERE competition_slug = ?
          ORDER BY datetime(fetched_at) DESC, id DESC
          LIMIT 1
        `,
      )
      .get(competitionSlug) ?? null
  );
}

export function getStandingsEntriesForSnapshot(snapshotId) {
  return db
    .prepare(
      `
        SELECT
          team_slug,
          team_name,
          team_short_name,
          position,
          points,
          played,
          won,
          drawn,
          lost,
          goals_for,
          goals_against,
          goal_difference,
          qualification,
          logo_class
        FROM standings_entries
        WHERE snapshot_id = ?
        ORDER BY position ASC, team_name ASC
      `,
    )
    .all(snapshotId);
}

export function getLatestStandingsTable(competitionSlug) {
  const snapshot = getLatestStandingsSnapshot(competitionSlug);

  if (!snapshot) {
    return null;
  }

  return {
    snapshot,
    entries: getStandingsEntriesForSnapshot(snapshot.id),
  };
}

export function getTeamStandingFromLatestSnapshot(competitionSlug, teamSlug) {
  const snapshot = getLatestStandingsSnapshot(competitionSlug);

  if (!snapshot) {
    return null;
  }

  const entry =
    db
      .prepare(
        `
          SELECT
            team_slug,
            team_name,
            team_short_name,
            position,
            points,
            played,
            won,
            drawn,
            lost,
            goals_for,
            goals_against,
            goal_difference,
            qualification,
            logo_class
          FROM standings_entries
          WHERE snapshot_id = ?
            AND team_slug = ?
          LIMIT 1
        `,
      )
      .get(snapshot.id, teamSlug) ?? null;

  if (!entry) {
    return null;
  }

  return {
    snapshot,
    entry,
  };
}
