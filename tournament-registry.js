export const TOURNAMENT_STORAGE_KEY = "wpti.tournaments.v1";

export const DEFAULT_TOURNAMENT = Object.freeze({
  id: "2026-junior-olympics-session-2",
  name: "2026 Junior Olympics Session 2",
  sourceUrl: "2026_NJO_Public_Sched_S2.xlsx",
  dataUrl: "data/schedule.json",
  status: "ready",
  builtIn: true,
});

export function parseStoredTournaments(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item) => item && typeof item.id === "string" && typeof item.name === "string")
      : [];
  } catch {
    return [];
  }
}

export function createTournament(name, sourceUrl) {
  const cleanName = name.replace(/\s+/g, " ").trim();
  if (!cleanName) throw new Error("Enter the tournament name.");
  if (cleanName.length > 100) throw new Error("Tournament names must be 100 characters or fewer.");

  let hash = 0;
  for (const character of `${cleanName}|${sourceUrl}`) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;

  return {
    id: `tournament-${hash.toString(36)}`,
    name: cleanName,
    sourceUrl,
    dataUrl: null,
    status: "downloaded",
    builtIn: false,
  };
}

export function upsertTournament(tournaments, tournament) {
  return [...tournaments.filter(({ id }) => id !== tournament.id), tournament]
    .sort((a, b) => a.name.localeCompare(b.name));
}
