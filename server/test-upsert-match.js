import {
  getCompetitionBySlug,
  getTeamBySlug,
  upsertMatch,
} from './repositories/matchesRepository.js';

const boca = getTeamBySlug('boca-juniors');
const betis = getTeamBySlug('real-betis');
const competition = getCompetitionBySlug('liga-profesional-2026');

if (!boca || !betis || !competition) {
  console.error('Faltan datos base en la BD.');
  process.exit(1);
}

const savedMatch = upsertMatch({
  canonicalKey: 'boca-juniors_vs_real-betis_2026-03-22T23:00:00Z',
  homeTeamId: boca.id,
  awayTeamId: betis.id,
  competitionId: competition.id,
  matchDateUtc: '2026-03-22T23:00:00Z',
  status: 'scheduled',
  stage: null,
  roundName: 'Fecha actualizada desde Node',
  venueName: 'La Bombonera',
  venueCity: 'Buenos Aires',
  sourcePriority: 1,
});

console.log('Saved match:', savedMatch);
