import db from '../db.js';

function now() {
  return new Date().toISOString();
}

export function getTeamBySlug(slug) {
  return db.prepare('SELECT * FROM teams WHERE slug = ?').get(slug) ?? null;
}

export function getTeamByName(name) {
  return db.prepare('SELECT * FROM teams WHERE name = ?').get(name) ?? null;
}

export function createTeam({ slug, name, country = null, officialSite = null }) {
  const timestamp = now();
  const result = db
    .prepare(`
      INSERT INTO teams (
        slug,
        name,
        country,
        official_site,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(slug, name, country, officialSite, timestamp, timestamp);

  return db.prepare('SELECT * FROM teams WHERE id = ?').get(result.lastInsertRowid);
}

export function getOrCreateTeam({ slug, name, country = null }) {
  return getTeamBySlug(slug) ?? getTeamByName(name) ?? createTeam({ slug, name, country });
}
