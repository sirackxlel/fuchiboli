import db from '../db.js';

function now() {
  return new Date().toISOString();
}

export function replaceMatchEvents(matchId, events) {
  const timestamp = now();
  const deleteStatement = db.prepare('DELETE FROM match_events WHERE match_id = ?');
  const insertStatement = db.prepare(`
    INSERT INTO match_events (
      match_id,
      team_id,
      player_id,
      event_type,
      minute,
      extra_minute,
      description,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    deleteStatement.run(matchId);

    for (const event of events) {
      insertStatement.run(
        matchId,
        event.teamId ?? null,
        event.playerId ?? null,
        event.eventType,
        event.minute ?? null,
        event.extraMinute ?? null,
        event.description ?? null,
        timestamp,
      );
    }
  });

  transaction();
  return events.length;
}
