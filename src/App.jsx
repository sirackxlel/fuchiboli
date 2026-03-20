import { useEffect, useMemo, useState } from 'react';
import { FaChevronDown, FaChevronUp, FaRegStar, FaStar } from 'react-icons/fa';

const LALIGA_SHIELD_SPRITE_STYLESHEET =
  'https://assets.laliga.com/assets/sprites/shield-sprite.css?20251002124452881729';
const FAVORITE_TEAMS_COOKIE_NAME = 'fuchiboli_favorite_teams';
const LOGO_SLUG_ALIASES = {
  laliga: {
    'elche-cf': 'elche-c-f',
    'ca-osasuna': 'c-a-osasuna',
    'rcd-espanyol-de-barcelona': 'rcd-espanyol',
  },
};

function readFavoriteTeamSlugsFromCookie() {
  if (typeof document === 'undefined') {
    return [];
  }

  const cookie = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${FAVORITE_TEAMS_COOKIE_NAME}=`));

  if (!cookie) {
    return [];
  }

  try {
    const value = decodeURIComponent(cookie.split('=').slice(1).join('='));
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeFavoriteTeamSlugsToCookie(teamSlugs) {
  if (typeof document === 'undefined') {
    return;
  }

  document.cookie = `${FAVORITE_TEAMS_COOKIE_NAME}=${encodeURIComponent(
    JSON.stringify(teamSlugs),
  )}; path=/; max-age=${60 * 60 * 24 * 365}`;
}

function slugifyTeamName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatDate(dateString) {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(dateString));
}

function formatGoalDifference(goalDifference) {
  if (goalDifference == null || goalDifference === '') {
    return '-';
  }

  return String(goalDifference).startsWith('-')
    ? String(goalDifference)
    : `+${goalDifference}`.replace('++', '+');
}

function formatScore(match) {
  if (match.homeScore == null || match.awayScore == null) {
    return 'vs';
  }

  return `${match.homeScore} - ${match.awayScore}`;
}

function formatBetssonOdd(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '-';
}

function getTeamLogoClass(teamSlug, competitionKey) {
  return competitionKey === 'laliga' && teamSlug ? `shield-sprite xs ${teamSlug}` : '';
}

function getLocalLogoPath({ competitionKey, teamSlug, teamName, logoManifest }) {
  const competitionLogos = logoManifest?.[competitionKey] ?? {};
  const aliasSlug = LOGO_SLUG_ALIASES?.[competitionKey]?.[teamSlug] ?? null;
  const nameSlug = slugifyTeamName(teamName);
  const aliasFromName = LOGO_SLUG_ALIASES?.[competitionKey]?.[nameSlug] ?? null;
  const candidates = [teamSlug, aliasSlug, nameSlug, aliasFromName].filter(Boolean);

  for (const candidate of candidates) {
    if (competitionLogos[candidate]) {
      return competitionLogos[candidate];
    }
  }

  return null;
}

function getInitials(name) {
  return String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function normalizePersonName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getNameTokens(value) {
  return normalizePersonName(value)
    .split(' ')
    .filter(Boolean)
    .filter((token) => token.length > 1);
}

function getCompetitionLabel(competitionKey) {
  if (competitionKey === 'laliga') {
    return 'LaLiga';
  }

  if (competitionKey === 'premier') {
    return 'Premier';
  }

  if (competitionKey === 'bundesliga') {
    return 'Bundesliga';
  }

  if (competitionKey === 'argentina') {
    return 'Argentina';
  }

  if (competitionKey === 'seriea') {
    return 'Serie A';
  }

  return 'Liga';
}

function getCompetitionOptions() {
  return [
    { key: 'laliga', label: 'LaLiga' },
    { key: 'premier', label: 'Premier League' },
    { key: 'bundesliga', label: 'Bundesliga' },
    { key: 'argentina', label: 'Liga Argentina' },
    { key: 'seriea', label: 'Serie A' },
  ];
}

function getGroupKey(match) {
  return `${match.competitionKey}-${match.week ?? match.roundName ?? 'sin-jornada'}`;
}

function groupMatchesByRound(matches) {
  const groups = [];
  const seen = new Map();

  for (const match of matches) {
    const key = getGroupKey(match);

    if (!seen.has(key)) {
      const group = {
        key,
        competitionKey: match.competitionKey,
        competitionLabel: getCompetitionLabel(match.competitionKey),
        week: match.week ?? null,
        roundName: match.roundName || match.competition,
        firstDate: match.date,
        matches: [],
      };

      seen.set(key, group);
      groups.push(group);
    }

    const group = seen.get(key);
    group.matches.push(match);

    if (Date.parse(match.date) < Date.parse(group.firstDate)) {
      group.firstDate = match.date;
    }
  }

  return groups.map((group) => ({
    ...group,
    matches: [...group.matches].sort((left, right) => Date.parse(left.date) - Date.parse(right.date)),
  }));
}

function getEffectiveMatchStatus(match) {
  return match.displayStatus ?? match.status;
}

function getStatusLabel(match) {
  const status = getEffectiveMatchStatus(match);

  if (status === 'suspended') {
    return 'Suspendido';
  }

  if (status === 'live') {
    return 'En juego';
  }

  if (status === 'finished') {
    return 'Finalizado';
  }

  return 'Programado';
}

function enrichMatchesForDisplay(matches) {
  const now = Date.now();
  const groupsByCompetition = new Map();

  for (const match of matches) {
    const competitionGroups = groupsByCompetition.get(match.competitionKey) ?? new Map();
    const groupKey = getGroupKey(match);

    if (!competitionGroups.has(groupKey)) {
      competitionGroups.set(groupKey, {
        week: match.week ?? null,
        firstDate: Date.parse(match.date),
      });
    }

    const group = competitionGroups.get(groupKey);
    group.firstDate = Math.min(group.firstDate, Date.parse(match.date));
    groupsByCompetition.set(match.competitionKey, competitionGroups);
  }

  const currentRoundByCompetition = new Map();

  for (const [competitionKey, groups] of groupsByCompetition.entries()) {
    const orderedGroups = [...groups.values()]
      .filter((group) => group.week != null)
      .sort((left, right) => left.week - right.week);
    const reachedGroups = orderedGroups.filter((group) => group.firstDate <= now);
    currentRoundByCompetition.set(competitionKey, reachedGroups.at(-1)?.week ?? null);
  }

  return matches.map((match) => {
    const currentRound = currentRoundByCompetition.get(match.competitionKey);
    const isPending = match.status !== 'finished' && match.status !== 'live';
    const shouldSuspend =
      isPending &&
      typeof match.week === 'number' &&
      typeof currentRound === 'number' &&
      currentRound >= match.week + 2;

    return {
      ...match,
      displayStatus: shouldSuspend ? 'suspended' : match.status,
    };
  });
}

function TeamBadge({ teamSlug, competitionKey, teamName, logoManifest, logoUrl = null }) {
  const localLogo = getLocalLogoPath({
    competitionKey,
    teamSlug,
    teamName,
    logoManifest,
  });
  const logoClass = getTeamLogoClass(teamSlug, competitionKey);

  if (localLogo) {
    return <img className="team-badge-image" src={localLogo} alt={`${teamName} escudo`} />;
  }

  if (logoUrl) {
    return <img className="team-badge-image" src={logoUrl} alt={`${teamName} escudo`} />;
  }

  if (logoClass) {
    return <i className={logoClass} aria-hidden="true" />;
  }

  return <span className="team-badge-fallback">{getInitials(teamName)}</span>;
}

function BetssonOddsLine({ odds }) {
  if (!odds) {
    return null;
  }

  return (
    <div className="fixture__odds" aria-label="Cuotas Betsson">
      <span className="fixture__odds-bookmaker">Betsson</span>
      <div className="fixture__odds-values">
        <span>{formatBetssonOdd(odds.home)}</span>
        <span>X {formatBetssonOdd(odds.draw)}</span>
        <span>{formatBetssonOdd(odds.away)}</span>
      </div>
    </div>
  );
}

function BetssonLogo() {
  return (
    <span className="betsson-logo" aria-label="Betsson">
      <span className="betsson-logo__word">betsson</span>
    </span>
  );
}

function buildBetssonBarSegments(odds) {
  const home = Number(odds?.home);
  const away = Number(odds?.away);

  if (!Number.isFinite(home) || !Number.isFinite(away) || home <= 0 || away <= 0) {
    return {
      homeWidth: 50,
      awayWidth: 50,
    };
  }

  const total = home + away;

  return {
    homeWidth: (home / total) * 100,
    awayWidth: (away / total) * 100,
  };
}

function BetssonOddsModalCard({ detail }) {
  const odds = detail?.betssonOdds ?? null;

  if (!odds) {
    return null;
  }

  const { homeWidth, awayWidth } = buildBetssonBarSegments(odds);

  return (
    <div className="detail-section">
      <h3>Cuotas Betsson</h3>
      <article className="betsson-card">
        <div className="betsson-card__header">
          <div className="betsson-card__brand">
            <BetssonLogo />
            <div>
              <strong>Betsson</strong>
              <p>Cuotas 1X2 para este partido</p>
            </div>
          </div>
          {odds.updatedAt && (
            <span className="betsson-card__updated">Actualizado {formatDate(odds.updatedAt)}</span>
          )}
        </div>

        <div className="betsson-card__odds">
          <div className="betsson-card__odd">
            <span className="betsson-card__label">{detail.homeTeam}</span>
            <strong>{formatBetssonOdd(odds.home)}</strong>
          </div>
          <div className="betsson-card__odd betsson-card__odd--draw">
            <span className="betsson-card__label">Empate</span>
            <strong>{formatBetssonOdd(odds.draw)}</strong>
          </div>
          <div className="betsson-card__odd betsson-card__odd--away">
            <span className="betsson-card__label">{detail.awayTeam}</span>
            <strong>{formatBetssonOdd(odds.away)}</strong>
          </div>
        </div>

        <div className="betsson-card__bar-wrap">
          <div className="betsson-card__bar-labels">
            <span>{detail.homeTeam}</span>
            <span>{detail.awayTeam}</span>
          </div>
          <div className="betsson-card__bar" aria-label="Comparacion de cuotas entre local y visitante">
            <span className="betsson-card__bar-home" style={{ width: `${homeWidth}%` }} />
            <span className="betsson-card__bar-away" style={{ width: `${awayWidth}%` }} />
          </div>
        </div>
      </article>
    </div>
  );
}

function StandingsBadge({ entry, competitionKey, logoManifest }) {
  const localLogo = getLocalLogoPath({
    competitionKey,
    teamSlug: entry.teamSlug,
    teamName: entry.teamName,
    logoManifest,
  });

  if (localLogo) {
    return <img className="team-badge-image" src={localLogo} alt={`${entry.teamName} escudo`} />;
  }

  if (entry.logoClass?.startsWith('http')) {
    return <img className="team-badge-image" src={entry.logoClass} alt={`${entry.teamName} escudo`} />;
  }

  if (entry.logoClass) {
    return <i className={entry.logoClass} aria-hidden="true" />;
  }

  return <span className="team-badge-fallback">{getInitials(entry.teamName)}</span>;
}

const STAT_CONFIG = [
  {
    key: 'possession',
    label: 'Posesion',
    type: 'percentage',
    candidates: ['possession_percentage', 'possessionPercentage'],
  },
  {
    key: 'shots',
    label: 'Remates',
    type: 'number',
    candidates: ['total_scoring_att', 'totalScoringAtt'],
  },
  {
    key: 'effectiveness',
    label: 'Efectividad',
    type: 'percentage',
    candidates: ['effectiveness'],
  },
  {
    key: 'fouls',
    label: 'Faltas',
    type: 'number',
    candidates: ['fk_foul_lost', 'fkFoulLost'],
  },
  {
    key: 'yellow',
    label: 'Tarjetas amarillas',
    type: 'number',
    candidates: ['total_yel_card', 'totalYelCard', 'yellowCard'],
  },
  {
    key: 'red',
    label: 'Tarjetas rojas',
    type: 'number',
    candidates: ['total_red_card', 'totalRedCard', 'redCard'],
  },
  {
    key: 'penalties',
    label: 'Penales',
    type: 'number',
    candidates: ['penalty_goals', 'att_pen_goal', 'attPenGoal'],
    hideWhenBothZero: true,
  },
  {
    key: 'offside',
    label: 'Fueras de juego',
    type: 'number',
    candidates: ['total_offside', 'totalOffside'],
  },
  {
    key: 'corners',
    label: 'Corners lanzados',
    type: 'number',
    candidates: ['corner_taken', 'cornerTaken'],
  },
  {
    key: 'saves',
    label: 'Atajadas',
    type: 'number',
    candidates: ['saves'],
  },
  {
    key: 'assists',
    label: 'Asistencias',
    type: 'number',
    candidates: ['assists'],
  },
  {
    key: 'clearances',
    label: 'Despejes',
    type: 'number',
    candidates: ['clearances'],
  },
];

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatStatValue(value, type) {
  if (type === 'percentage') {
    return `${Number(value).toFixed(1)}%`;
  }

  return String(value);
}

function getStatByCandidates(stats, candidates, fallback = 0) {
  for (const candidate of candidates) {
    if (stats?.[candidate] != null) {
      return stats[candidate];
    }
  }

  return fallback;
}

function buildStatsComparison(detail) {
  if (!detail?.stats?.length) {
    return null;
  }

  const home = detail.stats.find((team) => team.teamName === detail.homeTeam);
  const away = detail.stats.find((team) => team.teamName === detail.awayTeam);

  if (!home || !away) {
    return null;
  }

  const homeShots = toNumber(
    getStatByCandidates(home.stats, ['total_scoring_att', 'totalScoringAtt']),
  );
  const awayShots = toNumber(
    getStatByCandidates(away.stats, ['total_scoring_att', 'totalScoringAtt']),
  );
  const homeGoals = toNumber(getStatByCandidates(home.stats, ['goals']));
  const awayGoals = toNumber(getStatByCandidates(away.stats, ['goals']));

  const enrichedHome = {
    ...home.stats,
    effectiveness: homeShots > 0 ? (homeGoals / homeShots) * 100 : 0,
  };
  const enrichedAway = {
    ...away.stats,
    effectiveness: awayShots > 0 ? (awayGoals / awayShots) * 100 : 0,
  };

  return STAT_CONFIG.map((config) => {
      const homeValue = getStatByCandidates(enrichedHome, config.candidates);
      const awayValue = getStatByCandidates(enrichedAway, config.candidates);
    const homeNumeric = config.type === 'text' ? 0 : toNumber(homeValue);
    const awayNumeric = config.type === 'text' ? 0 : toNumber(awayValue);
    const total = homeNumeric + awayNumeric;

    return {
      ...config,
      homeValue: formatStatValue(homeValue, config.type),
      awayValue: formatStatValue(awayValue, config.type),
      homeWidth:
        config.type === 'text' ? 50 : total === 0 ? 50 : (homeNumeric / total) * 100,
      awayWidth:
        config.type === 'text' ? 50 : total === 0 ? 50 : (awayNumeric / total) * 100,
    };
  }).filter((config) => {
    if (!config.hideWhenBothZero) {
      return true;
    }

    return !(toNumber(config.homeValue) === 0 && toNumber(config.awayValue) === 0);
  });
}

function formatEventMinute(event) {
  if (event?.minute == null) {
    return '-';
  }

  if (event.extraMinute != null) {
    return `${event.minute}+${event.extraMinute}'`;
  }

  return `${event.minute}'`;
}

function getEventLabel(event) {
  if (event.eventType === 'penalty_goal') {
    return 'Gol de penal';
  }

  if (event.eventType === 'own_goal') {
    return 'Gol en propia';
  }

  if (event.eventType === 'yellow_card') {
    return 'Amarilla';
  }

  if (event.eventType === 'red_card') {
    return 'Roja';
  }

  if (event.eventType === 'second_yellow_red') {
    return 'Doble amarilla';
  }

  return 'Gol';
}

function getEventTone(event) {
  if (event.eventType === 'own_goal') {
    return 'own-goal';
  }

  if (event.eventType === 'yellow_card') {
    return 'warning';
  }

  if (event.eventType === 'red_card' || event.eventType === 'second_yellow_red') {
    return 'danger';
  }

  return 'success';
}

function lineupHasPlayer(lineup, playerName) {
  if (!lineup || !playerName) {
    return false;
  }

  const playerNames = new Set(
    [...(lineup.starters ?? []), ...(lineup.bench ?? [])]
      .map((player) => normalizePersonName(player.player_name))
      .filter(Boolean),
  );

  return Boolean(findMatchingPlayerKey(playerNames, playerName));
}

function buildMatchEvents(detail) {
  if (!detail?.events?.length) {
    return null;
  }

  const interestingEvents = detail.events.filter((event) =>
    ['goal', 'penalty_goal', 'own_goal', 'yellow_card', 'red_card', 'second_yellow_red'].includes(
      event.eventType,
    ),
  );

  if (interestingEvents.length === 0) {
    return null;
  }

  const homeLineup = detail.lineups?.find((lineup) => lineup.teamName === detail.homeTeam);
  const awayLineup = detail.lineups?.find((lineup) => lineup.teamName === detail.awayTeam);

  return {
    home: interestingEvents.filter((event) => {
      if (event.eventType === 'own_goal') {
        return lineupHasPlayer(homeLineup, event.playerName);
      }

      return event.teamName === detail.homeTeam;
    }),
    away: interestingEvents.filter((event) => {
      if (event.eventType === 'own_goal') {
        return lineupHasPlayer(awayLineup, event.playerName);
      }

      return event.teamName === detail.awayTeam;
    }),
  };
}

function findMatchingPlayerKey(playerNames, playerName) {
  const normalizedPlayerName = normalizePersonName(playerName);

  if (playerNames.has(normalizedPlayerName)) {
    return normalizedPlayerName;
  }

  const playerTokens = getNameTokens(playerName);

  for (const candidate of playerNames) {
    if (
      candidate.includes(normalizedPlayerName) ||
      normalizedPlayerName.includes(candidate)
    ) {
      return candidate;
    }

    const candidateTokens = getNameTokens(candidate);
    const sharedTokens = playerTokens.filter((token) => candidateTokens.includes(token));

    if (sharedTokens.length >= Math.min(2, playerTokens.length, candidateTokens.length)) {
      return candidate;
    }

    if (
      playerTokens.length === 1 &&
      candidateTokens.some((token) => token === playerTokens[0])
    ) {
      return candidate;
    }
  }

  return null;
}

function buildLineupIncidents(detail, lineup) {
  if (!detail?.events?.length || !lineup) {
    return new Map();
  }

  const incidents = new Map();
  const normalizedTeamName = normalizePersonName(lineup.teamName);
  const lineupPlayerKeys = new Set(
    [...(lineup.starters ?? []), ...(lineup.bench ?? [])]
      .map((player) => normalizePersonName(player.player_name))
      .filter(Boolean),
  );

  for (const event of detail.events) {
    const playerKey = findMatchingPlayerKey(lineupPlayerKeys, event.playerName);
    const eventTeamMatches = normalizePersonName(event.teamName) === normalizedTeamName;
    const isOwnGoalBySelectedLineup = event.eventType === 'own_goal' && Boolean(playerKey);

    if ((!eventTeamMatches && !isOwnGoalBySelectedLineup) || !playerKey) {
      continue;
    }

    if (!incidents.has(playerKey)) {
      incidents.set(playerKey, {
        goals: 0,
        ownGoals: 0,
        yellow: 0,
        red: 0,
      });
    }

    const playerIncidents = incidents.get(playerKey);

    if (event.eventType === 'goal' || event.eventType === 'penalty_goal') {
      playerIncidents.goals += 1;
    }

    if (event.eventType === 'own_goal') {
      playerIncidents.ownGoals += 1;
    }

    if (event.eventType === 'yellow_card') {
      playerIncidents.yellow += 1;
    }

    if (event.eventType === 'red_card' || event.eventType === 'second_yellow_red') {
      playerIncidents.red += 1;
    }
  }

  return incidents;
}

function resolvePlayerIncidents(incidentsByPlayer, playerName) {
  if (!incidentsByPlayer?.size || !playerName) {
    return null;
  }

  const normalizedPlayerName = normalizePersonName(playerName);

  if (incidentsByPlayer.has(normalizedPlayerName)) {
    return incidentsByPlayer.get(normalizedPlayerName);
  }

  const playerTokens = getNameTokens(playerName);

  for (const [incidentName, incidents] of incidentsByPlayer.entries()) {
    if (
      incidentName.includes(normalizedPlayerName) ||
      normalizedPlayerName.includes(incidentName)
    ) {
      return incidents;
    }

    const incidentTokens = getNameTokens(incidentName);
    const sharedTokens = playerTokens.filter((token) => incidentTokens.includes(token));

    if (sharedTokens.length >= Math.min(2, playerTokens.length, incidentTokens.length)) {
      return incidents;
    }

    if (
      playerTokens.length === 1 &&
      incidentTokens.some((token) => token === playerTokens[0])
    ) {
      return incidents;
    }
  }

  return null;
}

function PlayerIncidents({ incidents }) {
  if (
    !incidents ||
    (!incidents.goals && !incidents.ownGoals && !incidents.yellow && !incidents.red)
  ) {
    return null;
  }

  return (
    <span className="lineup-incidents" aria-label="Incidencias del jugador">
      {incidents.goals > 0 && (
        <span className="lineup-incidents__item lineup-incidents__item--goal" title="Goles">
          {'\u26BD'.repeat(incidents.goals)}
        </span>
      )}
      {incidents.ownGoals > 0 && (
        <span
          className="lineup-incidents__item lineup-incidents__item--own-goal"
          title="Goles en contra"
        >
          {Array.from({ length: incidents.ownGoals }, (_, index) => (
            <span key={`own-goal-${index}`} className="lineup-incidents__own-goal-mark">
              {'\u26BD'}(GEC)
            </span>
          ))}
        </span>
      )}
      {incidents.yellow > 0 && (
        <span className="lineup-incidents__item lineup-incidents__item--yellow" title="Tarjetas amarillas">
          {'\u{1F7E8}'.repeat(incidents.yellow)}
        </span>
      )}
      {incidents.red > 0 && (
        <span className="lineup-incidents__item lineup-incidents__item--red" title="Tarjetas rojas">
          {'\u{1F7E5}'.repeat(incidents.red)}
        </span>
      )}
    </span>
  );
}

function LineupPlayerRow({ player, incidentsByPlayer, teamName, role }) {
  const incidents = resolvePlayerIncidents(incidentsByPlayer, player.player_name);

  return (
    <p key={`${teamName}-${player.player_name}-${role}`}>
      {player.shirt_number ? `${player.shirt_number}. ` : ''}
      {player.player_name}
      <PlayerIncidents incidents={incidents} />
    </p>
  );
}

function MatchEventsColumn({ title, events, emptyLabel }) {
  return (
    <div className="events-card__column">
      <h4>{title}</h4>
      {events.length === 0 && <p className="lineup-empty">{emptyLabel}</p>}
      {events.length > 0 && (
        <div className="events-list">
          {events.map((event, index) => (
            <article
              key={`${title}-${event.eventType}-${event.playerName ?? 'sin-jugador'}-${event.minute ?? 'na'}-${event.extraMinute ?? 'na'}-${index}`}
              className={`event-item event-item--${getEventTone(event)}`}
            >
              <div className="event-item__top">
                <strong>{event.playerName ?? 'Jugador no identificado'}</strong>
                <span>{formatEventMinute(event)}</span>
              </div>
              <p>{getEventLabel(event)}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function MatchDetailModal({
  detail,
  loading,
  error,
  onClose,
  logoManifest,
  favoriteTeamSlugs,
  onToggleFavoriteTeam,
}) {
  const [selectedStandingsTeamSlug, setSelectedStandingsTeamSlug] = useState('');
  const [selectedStandingsTableKey, setSelectedStandingsTableKey] = useState('');
  const [selectedLineupTeamName, setSelectedLineupTeamName] = useState('');

  useEffect(() => {
    if (!detail?.standings?.teams?.length) {
      setSelectedStandingsTeamSlug('');
      return;
    }

    const defaultTeam =
      detail.standings.teams.find((team) => team.available) ?? detail.standings.teams[0];

    setSelectedStandingsTeamSlug(defaultTeam.teamSlug);
  }, [detail?.id, detail?.standings?.teams]);

  useEffect(() => {
    const selectedTeam = detail?.standings?.teams?.find(
      (team) => team.teamSlug === selectedStandingsTeamSlug,
    );

    if (!selectedTeam?.tableViews?.length) {
      setSelectedStandingsTableKey('');
      return;
    }

    setSelectedStandingsTableKey(selectedTeam.tableViews[0].key);
  }, [detail?.id, detail?.standings?.teams, selectedStandingsTeamSlug]);

  useEffect(() => {
    if (!detail?.lineups?.length) {
      setSelectedLineupTeamName('');
      return;
    }

    setSelectedLineupTeamName(detail.lineups[0].teamName);
  }, [detail?.id, detail?.lineups]);

  if (!detail && !loading && !error) {
    return null;
  }

  const isHomeFavorite = detail ? favoriteTeamSlugs.includes(detail.homeSlug) : false;
  const isAwayFavorite = detail ? favoriteTeamSlugs.includes(detail.awaySlug) : false;

  const selectedStandingsTeam = detail?.standings?.teams?.find(
    (team) => team.teamSlug === selectedStandingsTeamSlug,
  );
  const selectedLineup = detail?.lineups?.find(
    (lineup) => lineup.teamName === selectedLineupTeamName,
  );
  const selectedStandingsTableView =
    selectedStandingsTeam?.tableViews?.find((tableView) => tableView.key === selectedStandingsTableKey) ??
    selectedStandingsTeam?.tableViews?.[0] ??
    null;
  const hasLineupData = Boolean(
    detail?.lineups?.some(
      (lineup) => (lineup.starters?.length ?? 0) > 0 || (lineup.bench?.length ?? 0) > 0,
    ),
  );
  const statsComparison = buildStatsComparison(detail);
  const matchEvents = buildMatchEvents(detail);
  const lineupIncidents = buildLineupIncidents(detail, selectedLineup);
  const hasExtraData = hasLineupData || Boolean(statsComparison) || Boolean(matchEvents);
  const usesSharedStandingsTable = ['premier', 'laliga', 'bundesliga', 'seriea'].includes(
    detail?.competitionKey,
  );
  const homeStandingsTeam = detail?.standings?.teams?.find((team) => team.teamSlug === detail.homeSlug);
  const awayStandingsTeam = detail?.standings?.teams?.find((team) => team.teamSlug === detail.awaySlug);
  const singleTableViewForTeam = selectedStandingsTeam
    ? {
        key: 'single-table',
        competitionName: selectedStandingsTeam.competitionName ?? detail?.competition ?? 'Liga',
        standing: selectedStandingsTeam.standing,
        fullTable: selectedStandingsTeam.fullTable,
      }
    : null;
  const activeStandingsTableView =
    selectedStandingsTableView?.standing && selectedStandingsTableView?.fullTable
      ? selectedStandingsTableView
      : singleTableViewForTeam?.standing && singleTableViewForTeam?.fullTable
        ? singleTableViewForTeam
        : null;
  const sharedStandingsTableView =
    homeStandingsTeam?.tableViews?.find((tableView) => tableView.key === 'general') ??
    homeStandingsTeam?.tableViews?.[0] ??
    (homeStandingsTeam?.standing && homeStandingsTeam?.fullTable
      ? {
          key: 'single-table',
          competitionName: homeStandingsTeam.competitionName ?? detail?.competition ?? 'Liga',
          standing: homeStandingsTeam.standing,
          fullTable: homeStandingsTeam.fullTable,
        }
      : null) ??
    awayStandingsTeam?.tableViews?.find((tableView) => tableView.key === 'general') ??
    awayStandingsTeam?.tableViews?.[0] ??
    (awayStandingsTeam?.standing && awayStandingsTeam?.fullTable
      ? {
          key: 'single-table',
          competitionName: awayStandingsTeam.competitionName ?? detail?.competition ?? 'Liga',
          standing: awayStandingsTeam.standing,
          fullTable: awayStandingsTeam.fullTable,
        }
      : null) ??
    null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <section className="detail-modal" onClick={(event) => event.stopPropagation()}>
        <button className="detail-modal__close" type="button" onClick={onClose}>
          Cerrar
        </button>

        {loading && <p className="status">Cargando detalle del partido...</p>}
        {error && <p className="status status--error">{error}</p>}

        {detail && !loading && !error && (
          <>
            <p className="eyebrow">{detail.competition}</p>
            <h2>
              {detail.homeTeam} vs {detail.awayTeam}
            </h2>
            <div className="favorite-team-actions">
              <button
                type="button"
                className={`favorite-team-button ${isHomeFavorite ? 'favorite-team-button--active' : ''}`}
                onClick={() => onToggleFavoriteTeam(detail.homeSlug)}
              >
                {isHomeFavorite ? <FaStar aria-hidden="true" /> : <FaRegStar aria-hidden="true" />}
                <span>{detail.homeTeam}</span>
              </button>
              <button
                type="button"
                className={`favorite-team-button ${isAwayFavorite ? 'favorite-team-button--active' : ''}`}
                onClick={() => onToggleFavoriteTeam(detail.awaySlug)}
              >
                {isAwayFavorite ? <FaStar aria-hidden="true" /> : <FaRegStar aria-hidden="true" />}
                <span>{detail.awayTeam}</span>
              </button>
            </div>
            <p>{formatDate(detail.date)}</p>
            <p className="fixture__venue">{detail.venue || 'Sede a confirmar'}</p>

            {!hasExtraData && (
              <div className="detail-section">
                <h3>Datos extra</h3>
                <p className="status">No hay datos extras.</p>
              </div>
            )}

            {hasExtraData && (
            <div className="detail-section">
              <h3>Alineaciones</h3>
              {detail.lineups.length > 0 && (
                <>
                  <div className="standings-tabs" role="tablist" aria-label="Elegir alineacion">
                    {detail.lineups.map((lineup) => (
                      <button
                        key={lineup.teamName}
                        className={
                          lineup.teamName === selectedLineupTeamName
                            ? 'standings-tab standings-tab--active'
                            : 'standings-tab'
                        }
                        type="button"
                        onClick={() => setSelectedLineupTeamName(lineup.teamName)}
                      >
                        {lineup.teamName}
                      </button>
                    ))}
                  </div>

                  {selectedLineup && (
                    <article className="lineup-card">
                      <h4>{selectedLineup.teamName}</h4>
                      <p className="lineup-meta">
                        {selectedLineup.formation
                          ? `Formacion ${selectedLineup.formation}`
                          : 'Formacion no informada'}
                      </p>
                      <p className="lineup-meta">
                        {selectedLineup.isConfirmed
                          ? 'Alineacion confirmada'
                          : 'Alineacion no confirmada'}
                      </p>

                      <div className="lineup-columns">
                        <div>
                          <h5>Titulares</h5>
                          {selectedLineup.starters.length === 0 && (
                            <p className="lineup-empty">Sin titulares cargados.</p>
                          )}
                          {selectedLineup.starters.map((player) => (
                            <LineupPlayerRow
                              key={`${selectedLineup.teamName}-${player.player_name}-starter`}
                              player={player}
                              incidentsByPlayer={lineupIncidents}
                              teamName={selectedLineup.teamName}
                              role="starter"
                            />
                          ))}
                        </div>

                        <div>
                          <h5>Suplentes</h5>
                          {selectedLineup.bench.length === 0 && (
                            <p className="lineup-empty">Sin suplentes cargados.</p>
                          )}
                          {selectedLineup.bench.map((player) => (
                            <LineupPlayerRow
                              key={`${selectedLineup.teamName}-${player.player_name}-bench`}
                              player={player}
                              incidentsByPlayer={lineupIncidents}
                              teamName={selectedLineup.teamName}
                              role="bench"
                            />
                          ))}
                        </div>
                      </div>
                    </article>
                  )}
                </>
              )}
            </div>
            )}

            {hasExtraData && (
            <div className="detail-section">
              <h3>Estadisticas</h3>
              {!statsComparison && (
                <p className="status">Las estadisticas todavia no estan disponibles.</p>
              )}

              {statsComparison && (
                <article className="stats-card">
                  <div className="stats-head">
                    <div className="stats-head__team">
                      <TeamBadge
                        teamSlug={detail.homeSlug}
                        competitionKey={detail.competitionKey}
                        teamName={detail.homeTeam}
                        logoManifest={logoManifest}
                        logoUrl={detail.homeLogoUrl}
                      />
                      <strong>{detail.homeTeam}</strong>
                    </div>
                    <div className="stats-head__score">{formatScore(detail)}</div>
                    <div className="stats-head__team stats-head__team--away">
                      <strong>{detail.awayTeam}</strong>
                      <TeamBadge
                        teamSlug={detail.awaySlug}
                        competitionKey={detail.competitionKey}
                        teamName={detail.awayTeam}
                        logoManifest={logoManifest}
                        logoUrl={detail.awayLogoUrl}
                      />
                    </div>
                  </div>

                  <div className="stats-list">
                    {statsComparison.map((stat) => (
                      <div key={stat.key} className="stats-row">
                        <div className="stats-row__values">
                          <span>{stat.homeValue}</span>
                          <strong>{stat.label}</strong>
                          <span>{stat.awayValue}</span>
                        </div>
                        <div className="stats-row__bars">
                          <div className="stats-row__bar stats-row__bar--home">
                            <div style={{ width: `${stat.homeWidth}%` }} />
                          </div>
                          <div className="stats-row__bar stats-row__bar--away">
                            <div style={{ width: `${stat.awayWidth}%` }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              )}
            </div>
            )}

            {hasExtraData && (
            <div className="detail-section">
              <h3>Incidencias</h3>
              {!matchEvents && (
                <p className="status">Las incidencias todavia no estan disponibles.</p>
              )}

              {matchEvents && (
                <article className="events-card">
                  <div className="events-card__header">
                    <div className="stats-head__team">
                      <TeamBadge
                        teamSlug={detail.homeSlug}
                        competitionKey={detail.competitionKey}
                        teamName={detail.homeTeam}
                        logoManifest={logoManifest}
                        logoUrl={detail.homeLogoUrl}
                      />
                      <strong>{detail.homeTeam}</strong>
                    </div>
                    <div className="stats-head__team stats-head__team--away">
                      <strong>{detail.awayTeam}</strong>
                      <TeamBadge
                        teamSlug={detail.awaySlug}
                        competitionKey={detail.competitionKey}
                        teamName={detail.awayTeam}
                        logoManifest={logoManifest}
                        logoUrl={detail.awayLogoUrl}
                      />
                    </div>
                  </div>

                  <div className="events-card__grid">
                    <MatchEventsColumn
                      title={detail.homeTeam}
                      events={matchEvents.home}
                      emptyLabel="Sin incidencias cargadas."
                    />
                    <MatchEventsColumn
                      title={detail.awayTeam}
                      events={matchEvents.away}
                      emptyLabel="Sin incidencias cargadas."
                    />
                  </div>
                </article>
              )}
            </div>
            )}

            <div className="detail-section">
              <h3>Tabla de posiciones</h3>
              {!detail.standings.available && (
                <p className="status">{detail.standings.message}</p>
              )}

              {usesSharedStandingsTable && sharedStandingsTableView?.fullTable && (
                <article className="standings-card standings-card--table">
                  <div className="standings-card__header">
                    <div>
                      <p className="standings-competition">
                        {sharedStandingsTableView.competitionName}
                      </p>
                      <h4>{detail.homeTeam} y {detail.awayTeam}</h4>
                    </div>

                    <div className="standings-card__summary">
                      <span>Tabla compartida</span>
                      <strong>{sharedStandingsTableView.competitionName ?? detail.competition}</strong>
                    </div>
                  </div>

                  <div className="league-table__scroll">
                    <table className="table-standings">
                      <thead>
                        <tr>
                          <th>Posicion</th>
                          <th>Equipo</th>
                          <th>Puntos</th>
                          <th>PJ</th>
                          <th>PG</th>
                          <th>PE</th>
                          <th>PP</th>
                          <th>GF</th>
                          <th>GC</th>
                          <th>DG</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sharedStandingsTableView.fullTable.map((entry) => {
                          const isHomeTeam = entry.teamSlug === detail.homeSlug;
                          const isAwayTeam = entry.teamSlug === detail.awaySlug;

                          return (
                            <tr
                              key={entry.teamSlug}
                              className={
                                isHomeTeam || isAwayTeam ? 'table-standings__row--highlight' : ''
                              }
                            >
                              <td>{entry.position}</td>
                              <td>
                                <div className="team-cell">
                                  <StandingsBadge
                                    entry={entry}
                                    competitionKey={detail.competitionKey}
                                    logoManifest={logoManifest}
                                  />
                                  <div>
                                    <strong>{entry.teamName}</strong>
                                    {isHomeTeam && <span className="team-cell__tag">Local</span>}
                                    {isAwayTeam && <span className="team-cell__tag">Visitante</span>}
                                    {!isHomeTeam && !isAwayTeam && entry.qualification && (
                                      <span className="team-cell__tag">{entry.qualification}</span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td>{entry.points}</td>
                              <td>{entry.played}</td>
                              <td>{entry.won}</td>
                              <td>{entry.drawn}</td>
                              <td>{entry.lost}</td>
                              <td>{entry.goalsFor}</td>
                              <td>{entry.goalsAgainst}</td>
                              <td>{formatGoalDifference(entry.goalDifference)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </article>
              )}

              {!usesSharedStandingsTable && (
                <>
                  <div className="standings-tabs" role="tablist" aria-label="Elegir equipo">
                    {detail.standings.teams.map((team) => (
                      <button
                        key={team.teamSlug}
                        className={
                          team.teamSlug === selectedStandingsTeamSlug
                            ? 'standings-tab standings-tab--active'
                            : 'standings-tab'
                        }
                        type="button"
                        onClick={() => setSelectedStandingsTeamSlug(team.teamSlug)}
                      >
                        {team.teamName}
                      </button>
                    ))}
                  </div>

                  {selectedStandingsTeam && !selectedStandingsTeam.available && (
                    <article className="standings-card">
                      <h4>{selectedStandingsTeam.teamName}</h4>
                      <p className="lineup-empty">
                        La tabla de posiciones de su liga todavia no esta disponible.
                      </p>
                    </article>
                  )}

                  {selectedStandingsTeam &&
                    selectedStandingsTeam.available &&
                    activeStandingsTableView &&
                    activeStandingsTableView.standing &&
                    activeStandingsTableView.fullTable && (
                  <article className="standings-card standings-card--table">
                    {selectedStandingsTeam.tableViews?.length > 1 && (
                      <div className="standings-tabs" role="tablist" aria-label="Elegir tabla">
                        {selectedStandingsTeam.tableViews.map((tableView) => (
                          <button
                            key={tableView.key}
                            className={
                              tableView.key === selectedStandingsTableKey
                                ? 'standings-tab standings-tab--active'
                                : 'standings-tab'
                            }
                            type="button"
                            onClick={() => setSelectedStandingsTableKey(tableView.key)}
                          >
                            {tableView.key === 'general' ? 'General' : tableView.competitionName}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="standings-card__header">
                      <div>
                        <p className="standings-competition">
                          {activeStandingsTableView.competitionName}
                        </p>
                        <h4>{selectedStandingsTeam.teamName}</h4>
                      </div>

                      <div className="standings-card__summary">
                        <span>Puesto {activeStandingsTableView.standing.position}</span>
                        <strong>{activeStandingsTableView.standing.points} pts</strong>
                      </div>
                    </div>

                    <div className="league-table__scroll">
                      <table className="table-standings">
                        <thead>
                          <tr>
                            <th>Posicion</th>
                            <th>Equipo</th>
                            <th>Puntos</th>
                            <th>PJ</th>
                            <th>PG</th>
                            <th>PE</th>
                            <th>PP</th>
                            <th>GF</th>
                            <th>GC</th>
                            <th>DG</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeStandingsTableView.fullTable.map((entry) => (
                            <tr
                              key={entry.teamSlug}
                              className={
                                entry.teamSlug === selectedStandingsTeam.teamSlug
                                  ? 'table-standings__row--highlight'
                                  : ''
                              }
                            >
                              <td>{entry.position}</td>
                              <td>
                                <div className="team-cell">
                                  <StandingsBadge
                                    entry={entry}
                                    competitionKey={detail.competitionKey}
                                    logoManifest={logoManifest}
                                  />
                                  <div>
                                    <strong>{entry.teamName}</strong>
                                    {entry.qualification && (
                                      <span className="team-cell__tag">{entry.qualification}</span>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td>{entry.points}</td>
                              <td>{entry.played}</td>
                              <td>{entry.won}</td>
                              <td>{entry.drawn}</td>
                              <td>{entry.lost}</td>
                              <td>{entry.goalsFor}</td>
                              <td>{entry.goalsAgainst}</td>
                              <td>{formatGoalDifference(entry.goalDifference)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </article>
                  )}
                </>
              )}
            </div>
            <BetssonOddsModalCard detail={detail} />
          </>
        )}
      </section>
    </div>
  );
}

function RoundGroup({ group, onOpenMatch, logoManifest, oddsByMatchId }) {
  return (
    <section className="round-group">
      <div className="round-group__header">
        <div>
          <p className="fixture__competition">{group.roundName}</p>
          <span className="fixture__league-tag">{group.competitionLabel}</span>
        </div>
      </div>

      <div className="fixtures">
        {group.matches.map((match) => (
          <button
            key={match.id}
            type="button"
            className="fixture fixture--button fixture--season"
            onClick={() => onOpenMatch(match.id)}
          >
            <div className="fixture__season-top">
              <div>
                <p className="fixture__competition">{match.roundName || match.competition}</p>
                <span className="fixture__league-tag">{group.competitionLabel}</span>
              </div>
              <span className="fixture__score">{formatScore(match)}</span>
            </div>

            <div className="fixture__teams">
              <div className="fixture__team">
                <TeamBadge
                  teamSlug={match.homeSlug}
                  competitionKey={match.competitionKey}
                  teamName={match.homeTeam}
                  logoManifest={logoManifest}
                  logoUrl={match.homeLogoUrl}
                />
                <h3>{match.homeTeam}</h3>
              </div>
              <span className="fixture__versus">vs</span>
              <div className="fixture__team">
                <TeamBadge
                  teamSlug={match.awaySlug}
                  competitionKey={match.competitionKey}
                  teamName={match.awayTeam}
                  logoManifest={logoManifest}
                  logoUrl={match.awayLogoUrl}
                />
                <h3>{match.awayTeam}</h3>
              </div>
            </div>

            <p>{formatDate(match.date)}</p>
            <p className="fixture__competition">{getStatusLabel(match)}</p>
            <p className="fixture__venue">
              {match.venue || 'Sede a confirmar'}
              {match.city ? ` · ${match.city}` : ''}
            </p>
            <BetssonOddsLine odds={oddsByMatchId?.[match.id] ?? null} />
          </button>
        ))}
      </div>
    </section>
  );
}

function OverdueMatchesSection({ matches, onOpenMatch, logoManifest, oddsByMatchId }) {
  if (matches.length === 0) {
    return null;
  }

  return (
    <section className="round-group">
      <div className="round-group__header">
        <div>
          <p className="fixture__competition">Partidos atrasados</p>
          <span className="fixture__league-tag">No cuentan como proxima jornada</span>
        </div>
      </div>

      <div className="fixtures">
        {matches.map((match) => (
          <button
            key={match.id}
            type="button"
            className="fixture fixture--button fixture--season"
            onClick={() => onOpenMatch(match.id)}
          >
            <div className="fixture__season-top">
              <div>
                <p className="fixture__competition">Atrasado</p>
                <span className="fixture__league-tag">{match.roundName || match.competition}</span>
              </div>
              <span className="fixture__score">{formatScore(match)}</span>
            </div>

            <div className="fixture__teams">
              <div className="fixture__team">
                <TeamBadge
                  teamSlug={match.homeSlug}
                  competitionKey={match.competitionKey}
                  teamName={match.homeTeam}
                  logoManifest={logoManifest}
                  logoUrl={match.homeLogoUrl}
                />
                <h3>{match.homeTeam}</h3>
              </div>
              <span className="fixture__versus">vs</span>
              <div className="fixture__team">
                <TeamBadge
                  teamSlug={match.awaySlug}
                  competitionKey={match.competitionKey}
                  teamName={match.awayTeam}
                  logoManifest={logoManifest}
                  logoUrl={match.awayLogoUrl}
                />
                <h3>{match.awayTeam}</h3>
              </div>
            </div>

            <p>{formatDate(match.date)}</p>
            <p className="fixture__competition">Atrasado</p>
            <p className="fixture__venue">
              {match.venue || 'Sede a confirmar'}
              {match.city ? ` Â· ${match.city}` : ''}
            </p>
            <BetssonOddsLine odds={oddsByMatchId?.[match.id] ?? null} />
          </button>
        ))}
      </div>
    </section>
  );
}

function FavoriteMatchesSection({ matches, onOpenMatch, logoManifest, oddsByMatchId }) {
  if (matches.length === 0) {
    return null;
  }

  return (
    <section className="round-group round-group--favorites">
      <div className="round-group__header">
        <div>
          <p className="fixture__competition">Tus favoritos</p>
          <span className="fixture__league-tag">Proximos 3 partidos de tus equipos favoritos</span>
        </div>
      </div>

      <div className="fixtures">
        {matches.map((match) => (
          <button
            key={`favorite-${match.id}`}
            type="button"
            className="fixture fixture--button fixture--season"
            onClick={() => onOpenMatch(match.id)}
          >
            <div className="fixture__season-top">
              <div>
                <p className="fixture__competition">{match.roundName || match.competition}</p>
                <span className="fixture__league-tag">{getCompetitionLabel(match.competitionKey)}</span>
              </div>
              <span className="fixture__score">{formatScore(match)}</span>
            </div>

            <div className="fixture__teams">
              <div className="fixture__team">
                <TeamBadge
                  teamSlug={match.homeSlug}
                  competitionKey={match.competitionKey}
                  teamName={match.homeTeam}
                  logoManifest={logoManifest}
                  logoUrl={match.homeLogoUrl}
                />
                <h3>{match.homeTeam}</h3>
              </div>
              <span className="fixture__versus">vs</span>
              <div className="fixture__team">
                <TeamBadge
                  teamSlug={match.awaySlug}
                  competitionKey={match.competitionKey}
                  teamName={match.awayTeam}
                  logoManifest={logoManifest}
                  logoUrl={match.awayLogoUrl}
                />
                <h3>{match.awayTeam}</h3>
              </div>
            </div>

            <p>{formatDate(match.date)}</p>
            <p className="fixture__competition">{getStatusLabel(match)}</p>
            <p className="fixture__venue">
              {match.venue || 'Sede a confirmar'}
              {match.city ? ` · ${match.city}` : ''}
            </p>
            <BetssonOddsLine odds={oddsByMatchId?.[match.id] ?? null} />
          </button>
        ))}
      </div>
    </section>
  );
}

function SquadSection({ logoManifest }) {
  const [selectedCompetition, setSelectedCompetition] = useState('argentina');
  const [teams, setTeams] = useState([]);
  const [teamsLoading, setTeamsLoading] = useState(true);
  const [teamsError, setTeamsError] = useState('');
  const [selectedTeamSlug, setSelectedTeamSlug] = useState('');
  const [squad, setSquad] = useState(null);
  const [squadLoading, setSquadLoading] = useState(false);
  const [squadError, setSquadError] = useState('');

  const competitionOptions = getCompetitionOptions();

  useEffect(() => {
    let cancelled = false;
    setTeamsLoading(true);
    setTeamsError('');
    setSelectedTeamSlug('');
    setSquad(null);
    setSquadError('');

    fetch(`/api/teams/${selectedCompetition}`)
      .then(async (response) => {
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || 'No pudimos cargar los equipos.');
        }

        return response.json();
      })
      .then((data) => {
        if (!cancelled) {
          const nextTeams = data.teams ?? [];
          setTeams(nextTeams);
          setSelectedTeamSlug(nextTeams[0]?.teamSlug ?? '');
          setTeamsLoading(false);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setTeamsError(loadError.message);
          setTeamsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedCompetition]);

  useEffect(() => {
    if (!selectedTeamSlug) {
      setSquad(null);
      setSquadLoading(false);
      setSquadError('');
      return;
    }

    let cancelled = false;
    setSquadLoading(true);
    setSquadError('');

    fetch(`/api/team/${selectedTeamSlug}/players?competition=${selectedCompetition}`)
      .then(async (response) => {
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || 'No pudimos cargar el plantel.');
        }

        return response.json();
      })
      .then((data) => {
        if (!cancelled) {
          setSquad(data);
          setSquadLoading(false);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setSquadError(loadError.message);
          setSquadLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTeamSlug]);

  const selectedTeam = teams.find((team) => team.teamSlug === selectedTeamSlug) ?? null;

  return (
    <section className="team-card squad-card">
      <div className="team-card__header">
        <p className="eyebrow">Equipos</p>
        <h2>Plantel por numero</h2>
      </div>

      <div className="competition-filters">
        {competitionOptions.map((competition) => (
          <label key={competition.key} className="competition-filter">
            <input
              type="radio"
              name="squad-competition"
              checked={selectedCompetition === competition.key}
              onChange={() => setSelectedCompetition(competition.key)}
            />
            <span>{competition.label}</span>
          </label>
        ))}
      </div>

      <label className="search-field">
        <span>Elegir equipo</span>
        <select
          value={selectedTeamSlug}
          onChange={(event) => setSelectedTeamSlug(event.target.value)}
          disabled={teamsLoading || teams.length === 0}
          className="search-field__select"
        >
          {teams.length === 0 && <option value="">Sin equipos disponibles</option>}
          {teams.map((team) => (
            <option key={team.teamSlug} value={team.teamSlug}>
              {team.teamName}
            </option>
          ))}
        </select>
      </label>

      {teamsLoading && <p className="status">Cargando equipos...</p>}
      {teamsError && <p className="status status--error">{teamsError}</p>}
      {squadLoading && <p className="status">Cargando plantel...</p>}
      {squadError && <p className="status status--error">{squadError}</p>}

      {!teamsLoading && !teamsError && selectedTeam && (
        <div className="squad-card__header">
          <div className="team-cell">
            <TeamBadge
              teamSlug={selectedTeam.teamSlug}
              competitionKey={selectedCompetition}
              teamName={selectedTeam.teamName}
              logoManifest={logoManifest}
              logoUrl={selectedTeam.logoUrl}
            />
            <div>
              <strong>{selectedTeam.teamName}</strong>
              <p className="competition-helper">Jugadores ordenados por ultimo numero conocido.</p>
            </div>
          </div>
        </div>
      )}

      {!squadLoading && !squadError && squad && (
        <>
          {squad.players.length === 0 && (
            <p className="status">No encontramos jugadores cargados para este equipo.</p>
          )}

          {squad.players.length > 0 && (
            <div className="squad-grid">
              {squad.players.map((player) => (
                <article
                  key={`${squad.teamSlug}-${player.playerName}-${player.shirtNumber ?? 'sn'}`}
                  className="squad-player"
                >
                  <div className="squad-player__media">
                    {player.photoUrl ? (
                      <img
                        className="squad-player__photo"
                        src={player.photoUrl}
                        alt={`Foto de ${player.playerName}`}
                      />
                    ) : (
                      <span className="squad-player__photo-fallback">
                        {getInitials(player.playerName)}
                      </span>
                    )}
                    <div className="squad-player__number">
                      {player.shirtNumber != null ? player.shirtNumber : '--'}
                    </div>
                  </div>
                  <div>
                    <h3>{player.playerName}</h3>
                    <p>{player.positionLabel || 'Posicion no informada'}</p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SeasonSelectorSection({
  matches,
  loading,
  error,
  onOpenMatch,
  logoManifest,
  favoriteTeamSlugs,
}) {
  const [query, setQuery] = useState('');
  const [selectedCompetition, setSelectedCompetition] = useState('laliga');
  const [visibleUpcomingRounds, setVisibleUpcomingRounds] = useState(1);
  const [visiblePastRounds, setVisiblePastRounds] = useState(0);
  const [oddsByMatchId, setOddsByMatchId] = useState({});

  function handleCompetitionChange(nextCompetition) {
    setSelectedCompetition(nextCompetition);
    setQuery('');
  }

  const normalizedQuery = query.trim().toLowerCase();

  const filteredMatches = useMemo(() => {
    return enrichMatchesForDisplay(matches).filter((match) => {
      if (match.competitionKey !== selectedCompetition) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return (
        match.homeTeam.toLowerCase().includes(normalizedQuery) ||
        match.awayTeam.toLowerCase().includes(normalizedQuery) ||
        match.competition.toLowerCase().includes(normalizedQuery) ||
        String(match.week ?? '').includes(normalizedQuery)
      );
    });
  }, [matches, normalizedQuery, selectedCompetition]);

  const { favoriteMatches, overdueMatches, upcomingGroups, pastGroups } = useMemo(() => {
    const favorite = filteredMatches
      .filter((match) => favoriteTeamSlugs.includes(match.homeSlug) || favoriteTeamSlugs.includes(match.awaySlug))
      .filter((match) => {
        const status = getEffectiveMatchStatus(match);
        return status !== 'finished' && status !== 'suspended';
      })
      .sort((left, right) => Date.parse(left.date) - Date.parse(right.date))
      .filter(
        (match, index, list) =>
          list.findIndex((candidate) => candidate.id === match.id) === index,
      )
      .slice(0, 3);
    const overdue = filteredMatches
      .filter((match) => getEffectiveMatchStatus(match) === 'suspended')
      .sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
    const activeMatches = filteredMatches.filter(
      (match) => getEffectiveMatchStatus(match) !== 'suspended',
    );
    const groupedMatches = groupMatchesByRound(activeMatches);
    const upcoming = groupedMatches
      .filter((group) =>
        group.matches.some((match) => {
          const status = getEffectiveMatchStatus(match);
          return status !== 'finished';
        }),
      )
      .sort((left, right) => Date.parse(left.firstDate) - Date.parse(right.firstDate));
    const past = groupedMatches
      .filter((group) =>
        group.matches.every((match) => {
          const status = getEffectiveMatchStatus(match);
          return status === 'finished';
        }),
      )
      .sort((left, right) => Date.parse(right.firstDate) - Date.parse(left.firstDate));

    return {
      favoriteMatches: favorite,
      overdueMatches: overdue,
      upcomingGroups: upcoming,
      pastGroups: past,
    };
  }, [favoriteTeamSlugs, filteredMatches]);

  const visibleUpcomingGroupList = upcomingGroups.slice(0, visibleUpcomingRounds);
  const visiblePastGroupList = [...pastGroups.slice(0, visiblePastRounds)].reverse();
  const visibleMatchIdsForOdds = useMemo(() => {
    const ids = new Set();

    favoriteMatches.forEach((match) => ids.add(match.id));
    overdueMatches.forEach((match) => ids.add(match.id));
    visibleUpcomingGroupList.forEach((group) => {
      group.matches.forEach((match) => {
        if (getEffectiveMatchStatus(match) !== 'finished') {
          ids.add(match.id);
        }
      });
    });

    return [...ids];
  }, [favoriteMatches, overdueMatches, visibleUpcomingGroupList]);

  useEffect(() => {
    setVisibleUpcomingRounds(1);
    setVisiblePastRounds(0);
  }, [normalizedQuery, selectedCompetition]);

  useEffect(() => {
    const missingIds = visibleMatchIdsForOdds.filter((matchId) => !(matchId in oddsByMatchId));

    if (missingIds.length === 0) {
      return undefined;
    }

    let cancelled = false;

    fetch(`/api/odds/betsson?matchIds=${encodeURIComponent(missingIds.join(','))}`)
      .then(async (response) => {
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || 'No pudimos cargar las cuotas de Betsson.');
        }

        return response.json();
      })
      .then((data) => {
        if (!cancelled) {
          setOddsByMatchId((current) => ({
            ...current,
            ...(data.oddsByMatchId ?? {}),
          }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOddsByMatchId((current) => {
            const next = { ...current };

            missingIds.forEach((matchId) => {
              next[matchId] = null;
            });

            return next;
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [oddsByMatchId, visibleMatchIdsForOdds]);

  return (
    <section className="team-card season-card">
      <div className="team-card__header">
        <p className="eyebrow">Proximos partidos</p>
        <h2>2025/2026</h2>
      </div>

      <div className="competition-filters">
        <label className="competition-filter">
          <input
            type="radio"
            name="competition"
            checked={selectedCompetition === 'laliga'}
            onChange={() => handleCompetitionChange('laliga')}
          />
          <span>LaLiga</span>
        </label>
        <label className="competition-filter">
          <input
            type="radio"
            name="competition"
            checked={selectedCompetition === 'premier'}
            onChange={() => handleCompetitionChange('premier')}
          />
          <span>Premier League</span>
        </label>
        <label className="competition-filter">
          <input
            type="radio"
            name="competition"
            checked={selectedCompetition === 'bundesliga'}
            onChange={() => handleCompetitionChange('bundesliga')}
          />
          <span>Bundesliga</span>
        </label>
        <label className="competition-filter">
          <input
            type="radio"
            name="competition"
            checked={selectedCompetition === 'argentina'}
            onChange={() => handleCompetitionChange('argentina')}
          />
          <span>Liga Argentina</span>
        </label>
        <label className="competition-filter">
          <input
            type="radio"
            name="competition"
            checked={selectedCompetition === 'seriea'}
            onChange={() => handleCompetitionChange('seriea')}
          />
          <span>Serie A</span>
        </label>
      </div>

      <label className="search-field">
        <span>Buscar equipo, liga o jornada</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ej: Betis, Chelsea, Premier o 31"
        />
      </label>

      <p className="competition-helper">Primero ves la jornada que viene. Despues podes abrir mas.</p>

      {loading && <p className="status">Cargando proximos partidos...</p>}
      {error && <p className="status status--error">{error}</p>}

      {!loading && !error && favoriteMatches.length > 0 && (
        <FavoriteMatchesSection
          matches={favoriteMatches}
          onOpenMatch={onOpenMatch}
          logoManifest={logoManifest}
          oddsByMatchId={oddsByMatchId}
        />
      )}

      {!loading && !error && overdueMatches.length > 0 && (
        <OverdueMatchesSection
          matches={overdueMatches}
          onOpenMatch={onOpenMatch}
          logoManifest={logoManifest}
          oddsByMatchId={oddsByMatchId}
        />
      )}

      {!loading && !error && upcomingGroups.length === 0 && (
        <p className="status">No encontramos proximos partidos con esos filtros.</p>
      )}

      {!loading && !error && pastGroups.length > 0 && (
        <div className="round-controls round-controls--past">
          <button
            type="button"
            className="round-toggle"
            onClick={() => setVisiblePastRounds((current) => Math.min(current + 1, pastGroups.length))}
            disabled={visiblePastRounds >= pastGroups.length}
          >
            <FaChevronUp aria-hidden="true" />
            <span>Ver una jornada anterior</span>
          </button>

          {visiblePastRounds > 0 && (
            <button
              type="button"
              className="round-close"
              onClick={() => setVisiblePastRounds(0)}
            >
              Cerrar partidos anteriores
            </button>
          )}
        </div>
      )}

      {!loading && !error && visiblePastGroupList.length > 0 && (
        <div className="fixtures fixtures--past">
          {visiblePastGroupList.map((group) => (
            <RoundGroup
              key={group.key}
              group={group}
              onOpenMatch={onOpenMatch}
              logoManifest={logoManifest}
              oddsByMatchId={oddsByMatchId}
            />
          ))}
        </div>
      )}

      {!loading && !error && visibleUpcomingGroupList.length > 0 && (
        <>
          <div className="fixtures">
            {visibleUpcomingGroupList.map((group) => (
              <RoundGroup
                key={group.key}
                group={group}
                onOpenMatch={onOpenMatch}
                logoManifest={logoManifest}
                oddsByMatchId={oddsByMatchId}
              />
            ))}
          </div>

          {visibleUpcomingRounds < upcomingGroups.length && (
            <div className="round-more">
              <button
                type="button"
                className="round-more__button"
                onClick={() =>
                  setVisibleUpcomingRounds((current) =>
                    Math.min(current + 1, upcomingGroups.length),
                  )
                }
                aria-label="Ver una jornada mas"
              >
                <FaChevronDown aria-hidden="true" />
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

async function fetchCompetitionMatches(url, competitionKey) {
  const response = await fetch(url);

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'No pudimos cargar el calendario.');
  }

  const data = await response.json();

  return (data.matches ?? []).map((match) => ({
    ...match,
    competitionKey,
  }));
}

export default function App() {
  const [selectedMatchId, setSelectedMatchId] = useState('');
  const [selectedMatchDetail, setSelectedMatchDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [seasonMatches, setSeasonMatches] = useState([]);
  const [seasonLoading, setSeasonLoading] = useState(true);
  const [seasonError, setSeasonError] = useState('');
  const [favoriteTeamSlugs, setFavoriteTeamSlugs] = useState([]);
  const [logoManifest, setLogoManifest] = useState({
    laliga: {},
    premier: {},
    bundesliga: {},
    argentina: {},
    seriea: {},
  });

  useEffect(() => {
    setFavoriteTeamSlugs(readFavoriteTeamSlugsFromCookie());
  }, []);

  useEffect(() => {
    if (document.querySelector('link[data-laliga-shields="true"]')) {
      return undefined;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = LALIGA_SHIELD_SPRITE_STYLESHEET;
    link.dataset.laligaShields = 'true';
    document.head.appendChild(link);

    return () => {
      link.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetchCompetitionMatches('/api/season/laliga/matches', 'laliga'),
      fetchCompetitionMatches('/api/season/premier/matches', 'premier'),
      fetchCompetitionMatches('/api/season/bundesliga/matches', 'bundesliga'),
      fetchCompetitionMatches('/api/season/argentina/matches', 'argentina'),
      fetchCompetitionMatches('/api/season/serie-a/matches', 'seriea'),
    ])
      .then(([laligaMatches, premierMatches, bundesligaMatches, argentinaMatches, serieAMatches]) => {
        if (!cancelled) {
          setSeasonMatches([
            ...laligaMatches,
            ...premierMatches,
            ...bundesligaMatches,
            ...argentinaMatches,
            ...serieAMatches,
          ]);
          setSeasonLoading(false);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setSeasonError(loadError.message);
          setSeasonLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch('/team-logos/manifest.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Sin manifest de logos');
        }

        return response.json();
      })
      .then((manifest) => {
        if (!cancelled) {
          setLogoManifest(manifest);
        }
        })
      .catch(() => {
        if (!cancelled) {
          setLogoManifest({ laliga: {}, premier: {}, bundesliga: {}, argentina: {}, seriea: {} });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedMatchId) {
      setSelectedMatchDetail(null);
      setDetailError('');
      setDetailLoading(false);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError('');

    fetch(`/api/match/${selectedMatchId}`)
      .then(async (response) => {
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || 'No pudimos cargar el detalle del partido.');
        }

        return response.json();
      })
      .then(async (detail) => {
        let betssonOdds = null;

        try {
          const oddsResponse = await fetch(
            `/api/odds/betsson?matchIds=${encodeURIComponent(selectedMatchId)}`,
          );

          if (oddsResponse.ok) {
            const oddsData = await oddsResponse.json();
            betssonOdds = oddsData?.oddsByMatchId?.[selectedMatchId] ?? null;
          }
        } catch {
          betssonOdds = null;
        }

        if (!cancelled) {
          const selectedMatch = seasonMatches.find((match) => match.id === selectedMatchId);
          setSelectedMatchDetail({
            ...detail,
            betssonOdds,
            competitionKey: selectedMatch?.competitionKey ?? 'laliga',
          });
          setDetailLoading(false);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setDetailError(loadError.message);
          setDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [seasonMatches, selectedMatchId]);

  function handleToggleFavoriteTeam(teamSlug) {
    setFavoriteTeamSlugs((current) => {
      const nextFavorites = current.includes(teamSlug)
        ? current.filter((favoriteSlug) => favoriteSlug !== teamSlug)
        : [...current, teamSlug];

      writeFavoriteTeamSlugsToCookie(nextFavorites);
      return nextFavorites;
    });
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="badge">Fuchiboli</p>
        <h1>Elegi que liga queres seguir</h1>
      </section>

      <SeasonSelectorSection
        matches={seasonMatches}
        loading={seasonLoading}
        error={seasonError}
        onOpenMatch={setSelectedMatchId}
        logoManifest={logoManifest}
        favoriteTeamSlugs={favoriteTeamSlugs}
      />

      <SquadSection logoManifest={logoManifest} />

      <MatchDetailModal
        detail={selectedMatchDetail}
        loading={detailLoading}
        error={detailError}
        onClose={() => setSelectedMatchId('')}
        logoManifest={logoManifest}
        favoriteTeamSlugs={favoriteTeamSlugs}
        onToggleFavoriteTeam={handleToggleFavoriteTeam}
      />
    </main>
  );
}
