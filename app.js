import { buildTeamUrl, normalize, opponentFor, resolveTeam } from "./app-logic.js";
import { DEFAULT_TOURNAMENT, markTournamentReady, parseStoredTournaments, TOURNAMENT_STORAGE_KEY, upsertTournament } from "./tournament-registry.js";

const state = { data: null, tournaments: [] };
const $ = (selector) => document.querySelector(selector);

const tournamentSelect = $("#tournament");
const divisionSelect = $("#division");
const teamInput = $("#team");
const teamOptions = $("#team-options");
const status = $("#load-status");

const formatDate = (date) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
})[character]);

function populateTournaments() {
  state.tournaments = [DEFAULT_TOURNAMENT, ...parseStoredTournaments(localStorage.getItem(TOURNAMENT_STORAGE_KEY))];
  tournamentSelect.replaceChildren();
  for (const tournament of state.tournaments) {
    const option = document.createElement("option");
    option.value = tournament.id;
    option.textContent = tournament.status === "ready" ? tournament.name : `${tournament.name} — processing required`;
    tournamentSelect.append(option);
  }
}

function clearSchedule() {
  state.data = null;
  divisionSelect.innerHTML = '<option value="">Select a division</option>';
  teamOptions.replaceChildren();
  teamInput.value = "";
  $("#results").hidden = true;
}

async function loadTournament({ applyUrl = false } = {}) {
  let tournament = selectedTournament();
  clearSchedule();
  if (!tournament?.dataUrl) {
    if (!tournament?.localFilename) {
      status.textContent = `${tournament?.name ?? "This tournament"} needs to be downloaded again so it can be processed.`;
      status.classList.add("pending");
      return;
    }
    try {
      status.classList.remove("error");
      status.classList.add("pending");
      status.textContent = `Processing ${tournament.localFilename}…`;
      const response = await fetch("/api/tournaments/process", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: tournament.localFilename }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "The workbook could not be processed.");
      tournament = markTournamentReady(tournament, payload);
      const stored = parseStoredTournaments(localStorage.getItem(TOURNAMENT_STORAGE_KEY));
      localStorage.setItem(TOURNAMENT_STORAGE_KEY, JSON.stringify(upsertTournament(stored, tournament)));
      state.tournaments = state.tournaments.map((item) => item.id === tournament.id ? tournament : item);
      tournamentSelect.selectedOptions[0].textContent = tournament.name;
    } catch (error) {
      status.textContent = error.message;
      status.classList.remove("pending");
      status.classList.add("error");
      return;
    }
  }

  try {
    status.classList.remove("error", "pending");
    status.textContent = `Loading ${tournament.name}…`;
    const response = await fetch(tournament.dataUrl);
    if (!response.ok) throw new Error(`Data request failed (${response.status})`);
    state.data = await response.json();
    for (const division of state.data.divisions) {
      const option = document.createElement("option");
      option.value = division.id;
      option.textContent = division.label;
      divisionSelect.append(option);
    }
    status.textContent = `${tournament.name} · ${state.data.divisions.length} divisions ready`;
    if (applyUrl) applyUrlSelection();
  } catch (error) {
    status.textContent = "Could not load the tournament data. Start the site through a local web server.";
    status.classList.add("error");
    console.error(error);
  }
}

function selectedTournament() {
  return state.tournaments.find(({ id }) => id === tournamentSelect.value);
}

function selectedDivision() {
  return state.data?.divisions.find((division) => division.id === divisionSelect.value);
}

function updateTeams() {
  teamOptions.replaceChildren();
  teamInput.value = "";
  for (const team of selectedDivision()?.teams ?? []) {
    const option = document.createElement("option");
    option.value = team;
    teamOptions.append(option);
  }
}

function resultFor(game, team) {
  const isWhite = normalize(game.white) === team;
  const teamScore = isWhite ? game.whiteScore : game.darkScore;
  const opponentScore = isWhite ? game.darkScore : game.whiteScore;
  if (teamScore === null || opponentScore === null) return "Upcoming";
  if (teamScore > opponentScore) return "Win";
  if (teamScore < opponentScore) return "Loss";
  return "Tie";
}

function renderGames(event) {
  event.preventDefault();
  const division = selectedDivision();
  const { team, matches } = resolveTeam(division, teamInput.value);
  if (!division || !team) {
    status.textContent = matches.length ? `Please choose one of the ${matches.length} matching teams.` : "No matching team was found in this division.";
    status.classList.add("error");
    return;
  }

  history.pushState({}, "", buildTeamUrl(tournamentSelect.value, division.id, team));
  renderTeam(division, team);
}

function renderTeam(division, teamName, { scroll = true } = {}) {
  status.classList.remove("error");
  status.textContent = `${selectedTournament().name} tournament data loaded`;
  divisionSelect.value = division.id;
  updateTeams();
  teamInput.value = teamName;
  const normalizedTeam = normalize(teamName);
  const games = division.games
    .filter((game) => normalize(game.white) === normalizedTeam || normalize(game.dark) === normalizedTeam)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.timeMinutes ?? 9999) - (b.timeMinutes ?? 9999));

  const counts = { Win: 0, Loss: 0, Tie: 0, Upcoming: 0 };
  games.forEach((game) => counts[resultFor(game, normalizedTeam)]++);
  const completed = games.filter((game) => resultFor(game, normalizedTeam) !== "Upcoming");
  const goalsFor = completed.reduce((total, game) => total + (normalize(game.white) === normalizedTeam ? game.whiteScore : game.darkScore), 0);
  const goalsAgainst = completed.reduce((total, game) => total + (normalize(game.white) === normalizedTeam ? game.darkScore : game.whiteScore), 0);

  $("#team-title").textContent = teamName;
  $("#division-title").textContent = division.label;
  $("#record-value").textContent = `${counts.Win}–${counts.Loss}–${counts.Tie}`;
  $("#game-count").textContent = `${games.length} game${games.length === 1 ? "" : "s"}`;
  $("#summary-cards").innerHTML = [
    ["Games played", completed.length],
    ["Goals for", goalsFor],
    ["Goals against", goalsAgainst],
    ["Goal difference", `${goalsFor - goalsAgainst > 0 ? "+" : ""}${goalsFor - goalsAgainst}`],
  ].map(([label, value]) => `<article><strong>${value}</strong><span>${label}</span></article>`).join("");

  $("#game-list").innerHTML = games.map((game) => {
    const isWhite = normalize(game.white) === normalizedTeam;
    const opponent = opponentFor(game, teamName);
    const teamScore = isWhite ? game.whiteScore : game.darkScore;
    const opponentScore = isWhite ? game.darkScore : game.whiteScore;
    const result = resultFor(game, normalizedTeam);
    const score = teamScore === null || opponentScore === null ? "—" : `${teamScore} : ${opponentScore}`;
    const opponentUrl = buildTeamUrl(tournamentSelect.value, division.id, opponent);
    return `<a class="game-card" href="${escapeHtml(opponentUrl)}" aria-label="View ${escapeHtml(opponent)} team summary">
      <div class="game-date"><strong>${formatDate(game.date)}</strong><span>${game.time}</span></div>
      <div class="game-opponent"><small>${escapeHtml(game.type || "Tournament game")}</small><strong>vs. ${escapeHtml(opponent)}</strong><span>${escapeHtml(game.location)}</span></div>
      <div class="game-score"><span class="result ${result.toLowerCase()}">${result}</span><strong>${score}</strong><small>${game.id}</small></div>
    </a>`;
  }).join("") || `<p class="empty">No games found for this team.</p>`;

  $("#results").hidden = false;
  if (scroll) $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyUrlSelection() {
  const params = new URLSearchParams(location.search);
  const division = state.data?.divisions.find(({ id }) => id === params.get("division"));
  const { team } = resolveTeam(division, params.get("team") ?? "");
  if (!division || !team) return;
  renderTeam(division, team, { scroll: false });
}

tournamentSelect.addEventListener("change", () => loadTournament());
divisionSelect.addEventListener("change", updateTeams);
$("#search-form").addEventListener("submit", renderGames);

populateTournaments();
const initialParams = new URLSearchParams(location.search);
const requestedTournament = state.tournaments.find(({ id }) => id === initialParams.get("tournament"));
tournamentSelect.value = requestedTournament?.id ?? DEFAULT_TOURNAMENT.id;
loadTournament({ applyUrl: true });
