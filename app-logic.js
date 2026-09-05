export const normalize = (value) => value.trim().toLocaleLowerCase();

export function formatScore(value, { signed = false } = {}) {
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return `${signed && normalized > 0 ? "+" : ""}${normalized}`;
}

export function resolveTeam(division, query) {
  const normalizedQuery = normalize(query);
  if (!division || !normalizedQuery) return { team: null, matches: [] };

  const exactTeam = division.teams.find((team) => normalize(team) === normalizedQuery);
  const matches = exactTeam
    ? [exactTeam]
    : division.teams.filter((team) => normalize(team).includes(normalizedQuery));
  return { team: matches.length === 1 ? matches[0] : null, matches };
}

export function opponentFor(game, teamName) {
  return normalize(game.white) === normalize(teamName) ? game.dark : game.white;
}

export function buildTeamUrl(tournamentId, divisionId, teamName) {
  const params = new URLSearchParams({ tournament: tournamentId, division: divisionId, team: teamName });
  return `?${params.toString()}`;
}
