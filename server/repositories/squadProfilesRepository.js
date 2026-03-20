import db from '../db.js';

function now() {
  return new Date().toISOString();
}

export function replaceTeamSquadProfiles({
  teamId,
  competitionSlug,
  sourceName,
  sourceUrl,
  players,
}) {
  const timestamp = now();
  const deleteStatement = db.prepare(`
    DELETE FROM team_squad_profiles
    WHERE team_id = ?
      AND competition_slug = ?
  `);
  const insertStatement = db.prepare(`
    INSERT INTO team_squad_profiles (
      team_id,
      competition_slug,
      player_name,
      shirt_number,
      position_label,
      photo_url,
      source_name,
      source_url,
      sort_order,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    deleteStatement.run(teamId, competitionSlug);

    players.forEach((player, index) => {
      insertStatement.run(
        teamId,
        competitionSlug,
        player.playerName,
        player.shirtNumber ?? null,
        player.positionLabel ?? null,
        player.photoUrl ?? null,
        sourceName,
        sourceUrl ?? null,
        index + 1,
        timestamp,
        timestamp,
      );
    });
  });

  transaction();
}

export function getTeamSquadProfiles(teamId, competitionSlug = null) {
  if (competitionSlug) {
    return db
      .prepare(
        `
          SELECT
            player_name,
            shirt_number,
            position_label,
            photo_url,
            sort_order
          FROM team_squad_profiles
          WHERE team_id = ?
            AND competition_slug = ?
          ORDER BY sort_order ASC, player_name ASC
        `,
      )
      .all(teamId, competitionSlug);
  }

  return db
    .prepare(
      `
        SELECT
          player_name,
          shirt_number,
          position_label,
          photo_url,
          sort_order
        FROM team_squad_profiles
        WHERE team_id = ?
          AND competition_slug = (
            SELECT competition_slug
            FROM team_squad_profiles
            WHERE team_id = ?
            ORDER BY updated_at DESC
            LIMIT 1
          )
        ORDER BY sort_order ASC, player_name ASC
      `,
    )
    .all(teamId, teamId);
}
