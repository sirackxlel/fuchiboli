import { useEffect, useMemo, useState } from 'react';
import { FaChevronDown, FaChevronUp } from 'react-icons/fa';

const LALIGA_SHIELD_SPRITE_STYLESHEET =
  'https://assets.laliga.com/assets/sprites/shield-sprite.css?20251002124452881729';
const LOGO_SLUG_ALIASES = {
  laliga: {
    'elche-cf': 'elche-c-f',
    'ca-osasuna': 'c-a-osasuna',
    'rcd-espanyol-de-barcelona': 'rcd-espanyol',
  },
};

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

function getCompetitionLabel(competitionKey) {
  if (competitionKey === 'laliga') {
    return 'LaLiga';
  }

  if (competitionKey === 'premier') {
    return 'Premier';
  }

  return 'Bundesliga';
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

function TeamBadge({ teamSlug, competitionKey, teamName, logoManifest, logoUrl = null }) {
  if (logoUrl) {
    return <img className="team-badge-image" src={logoUrl} alt={`${teamName} escudo`} />;
  }

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

  if (logoClass) {
    return <i className={logoClass} aria-hidden="true" />;
  }

  return <span className="team-badge-fallback">{getInitials(teamName)}</span>;
}

function StandingsBadge({ entry, competitionKey, logoManifest }) {
  if (entry.logoClass?.startsWith('http')) {
    return <img className="team-badge-image" src={entry.logoClass} alt={`${entry.teamName} escudo`} />;
  }

  const localLogo = getLocalLogoPath({
    competitionKey,
    teamSlug: entry.teamSlug,
    teamName: entry.teamName,
    logoManifest,
  });

  if (localLogo) {
    return <img className="team-badge-image" src={localLogo} alt={`${entry.teamName} escudo`} />;
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
    key: 'penalty_summary',
    label: 'Penaltis',
    type: 'text',
    candidates: ['penalty_summary'],
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
  const homePens = `${toNumber(
    getStatByCandidates(home.stats, ['att_pen_goal', 'attPenGoal']),
  )} [${toNumber(getStatByCandidates(home.stats, ['att_pen_miss', 'attPenMiss']))}]`;
  const awayPens = `${toNumber(
    getStatByCandidates(away.stats, ['att_pen_goal', 'attPenGoal']),
  )} [${toNumber(getStatByCandidates(away.stats, ['att_pen_miss', 'attPenMiss']))}]`;

  const enrichedHome = {
    ...home.stats,
    effectiveness: homeShots > 0 ? (homeGoals / homeShots) * 100 : 0,
    penalty_summary: homePens,
  };
  const enrichedAway = {
    ...away.stats,
    effectiveness: awayShots > 0 ? (awayGoals / awayShots) * 100 : 0,
    penalty_summary: awayPens,
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
  });
}

function MatchDetailModal({ detail, loading, error, onClose, logoManifest }) {
  const [selectedStandingsTeamSlug, setSelectedStandingsTeamSlug] = useState('');
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
    if (!detail?.lineups?.length) {
      setSelectedLineupTeamName('');
      return;
    }

    setSelectedLineupTeamName(detail.lineups[0].teamName);
  }, [detail?.id, detail?.lineups]);

  if (!detail && !loading && !error) {
    return null;
  }

  const selectedStandingsTeam = detail?.standings?.teams?.find(
    (team) => team.teamSlug === selectedStandingsTeamSlug,
  );
  const selectedLineup = detail?.lineups?.find(
    (lineup) => lineup.teamName === selectedLineupTeamName,
  );
  const statsComparison = buildStatsComparison(detail);

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
            <p>{formatDate(detail.date)}</p>
            <p className="fixture__venue">{detail.venue || 'Sede a confirmar'}</p>

            <div className="detail-section">
              <h3>Alineaciones</h3>
              {detail.lineups.length === 0 && (
                <p className="status">Las alineaciones todavia no estan disponibles.</p>
              )}

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
                            <p key={`${selectedLineup.teamName}-${player.player_name}-starter`}>
                              {player.shirt_number ? `${player.shirt_number}. ` : ''}
                              {player.player_name}
                            </p>
                          ))}
                        </div>

                        <div>
                          <h5>Suplentes</h5>
                          {selectedLineup.bench.length === 0 && (
                            <p className="lineup-empty">Sin suplentes cargados.</p>
                          )}
                          {selectedLineup.bench.map((player) => (
                            <p key={`${selectedLineup.teamName}-${player.player_name}-bench`}>
                              {player.shirt_number ? `${player.shirt_number}. ` : ''}
                              {player.player_name}
                            </p>
                          ))}
                        </div>
                      </div>
                    </article>
                  )}
                </>
              )}
            </div>

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

            <div className="detail-section">
              <h3>Tabla de posiciones</h3>
              {!detail.standings.available && (
                <p className="status">{detail.standings.message}</p>
              )}

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
                selectedStandingsTeam.standing &&
                selectedStandingsTeam.fullTable && (
                  <article className="standings-card standings-card--table">
                    <div className="standings-card__header">
                      <div>
                        <p className="standings-competition">
                          {selectedStandingsTeam.competitionName}
                        </p>
                        <h4>{selectedStandingsTeam.teamName}</h4>
                      </div>

                      <div className="standings-card__summary">
                        <span>Puesto {selectedStandingsTeam.standing.position}</span>
                        <strong>{selectedStandingsTeam.standing.points} pts</strong>
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
                          {selectedStandingsTeam.fullTable.map((entry) => (
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
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function RoundGroup({ group, onOpenMatch, logoManifest }) {
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
            <p className="fixture__venue">
              {match.venue || 'Sede a confirmar'}
              {match.city ? ` · ${match.city}` : ''}
            </p>
          </button>
        ))}
      </div>
    </section>
  );
}

function SeasonSelectorSection({ matches, loading, error, onOpenMatch, logoManifest }) {
  const [query, setQuery] = useState('');
  const [selectedCompetition, setSelectedCompetition] = useState('laliga');
  const [visibleUpcomingRounds, setVisibleUpcomingRounds] = useState(1);
  const [visiblePastRounds, setVisiblePastRounds] = useState(0);

  const normalizedQuery = query.trim().toLowerCase();

  const filteredMatches = useMemo(() => {
    return matches.filter((match) => {
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

  const { upcomingGroups, pastGroups } = useMemo(() => {
    const now = Date.now();
    const upcoming = filteredMatches
      .filter((match) => Date.parse(match.date) >= now && match.status !== 'finished')
      .sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
    const past = filteredMatches
      .filter((match) => Date.parse(match.date) < now || match.status === 'finished')
      .sort((left, right) => Date.parse(right.date) - Date.parse(left.date));

    return {
      upcomingGroups: groupMatchesByRound(upcoming),
      pastGroups: groupMatchesByRound(past),
    };
  }, [filteredMatches]);

  const visibleUpcomingGroupList = upcomingGroups.slice(0, visibleUpcomingRounds);
  const visiblePastGroupList = [...pastGroups.slice(0, visiblePastRounds)].reverse();

  useEffect(() => {
    setVisibleUpcomingRounds(1);
    setVisiblePastRounds(0);
  }, [normalizedQuery, selectedCompetition]);

  return (
    <section className="team-card season-card">
      <div className="team-card__header">
        <p className="eyebrow">Proximos partidos</p>
        <h2>LaLiga, Premier League y Bundesliga 2025/2026</h2>
      </div>

      <div className="competition-filters">
        <label className="competition-filter">
          <input
            type="radio"
            name="competition"
            checked={selectedCompetition === 'laliga'}
            onChange={() => setSelectedCompetition('laliga')}
          />
          <span>LaLiga</span>
        </label>
        <label className="competition-filter">
          <input
            type="radio"
            name="competition"
            checked={selectedCompetition === 'premier'}
            onChange={() => setSelectedCompetition('premier')}
          />
          <span>Premier League</span>
        </label>
        <label className="competition-filter">
          <input
            type="radio"
            name="competition"
            checked={selectedCompetition === 'bundesliga'}
            onChange={() => setSelectedCompetition('bundesliga')}
          />
          <span>Bundesliga</span>
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
  const [logoManifest, setLogoManifest] = useState({ laliga: {}, premier: {}, bundesliga: {} });

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
    ])
      .then(([laligaMatches, premierMatches, bundesligaMatches]) => {
        if (!cancelled) {
          setSeasonMatches([...laligaMatches, ...premierMatches, ...bundesligaMatches]);
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
          setLogoManifest({ laliga: {}, premier: {}, bundesliga: {} });
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
      .then((detail) => {
        if (!cancelled) {
          const selectedMatch = seasonMatches.find((match) => match.id === selectedMatchId);
          setSelectedMatchDetail({
            ...detail,
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

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="badge">LALIGA + PREMIER + BUNDESLIGA</p>
        <h1>Elegi que liga queres seguir</h1>
      </section>

      <SeasonSelectorSection
        matches={seasonMatches}
        loading={seasonLoading}
        error={seasonError}
        onOpenMatch={setSelectedMatchId}
        logoManifest={logoManifest}
      />

      <MatchDetailModal
        detail={selectedMatchDetail}
        loading={detailLoading}
        error={detailError}
        onClose={() => setSelectedMatchId('')}
        logoManifest={logoManifest}
      />
    </main>
  );
}
