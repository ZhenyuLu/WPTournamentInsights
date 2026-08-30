const state = { data: null };
const $ = (selector) => document.querySelector(selector);

const divisionSelect = $("#division");
const teamInput = $("#team");
const teamOptions = $("#team-options");
const status = $("#load-status");

const normalize = (value) => value.trim().toLocaleLowerCase();
const formatDate = (date) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));

async function loadSchedule() {
  try {
    const response = await fetch("data/schedule.json");
    if (!response.ok) throw new Error(`Data request failed (${response.status})`);
    state.data = await response.json();
    for (const division of state.data.divisions) {
      const option = document.createElement("option");
      option.value = division.id;
      option.textContent = division.label;
      divisionSelect.append(option);
    }
    status.textContent = `${state.data.divisions.length} divisions ready`;
  } catch (error) {
    status.textContent = "Could not load the tournament data. Start the site through a local web server.";
    status.classList.add("error");
    console.error(error);
  }
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
  const query = normalize(teamInput.value);
  if (!division || !query) return;

  const exactTeam = division.teams.find((team) => normalize(team) === query);
  const matchingTeams = exactTeam ? [exactTeam] : division.teams.filter((team) => normalize(team).includes(query));
  if (matchingTeams.length !== 1) {
    status.textContent = matchingTeams.length ? `Please choose one of the ${matchingTeams.length} matching teams.` : "No matching team was found in this division.";
    status.classList.add("error");
    return;
  }

  status.classList.remove("error");
  status.textContent = "Tournament data loaded from the example workbook";
  const teamName = matchingTeams[0];
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
    const opponent = isWhite ? game.dark : game.white;
    const teamScore = isWhite ? game.whiteScore : game.darkScore;
    const opponentScore = isWhite ? game.darkScore : game.whiteScore;
    const result = resultFor(game, normalizedTeam);
    const score = teamScore === null || opponentScore === null ? "—" : `${teamScore} : ${opponentScore}`;
    return `<article class="game-card">
      <div class="game-date"><strong>${formatDate(game.date)}</strong><span>${game.time}</span></div>
      <div class="game-opponent"><small>${game.type || "Tournament game"}</small><strong>vs. ${opponent}</strong><span>${game.location}</span></div>
      <div class="game-score"><span class="result ${result.toLowerCase()}">${result}</span><strong>${score}</strong><small>${game.id}</small></div>
    </article>`;
  }).join("") || `<p class="empty">No games found for this team.</p>`;

  $("#results").hidden = false;
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

divisionSelect.addEventListener("change", updateTeams);
$("#search-form").addEventListener("submit", renderGames);
loadSchedule();
