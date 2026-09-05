import { buildDownloadUrl } from "./download-logic.js";
import { createTournament, parseStoredTournaments, TOURNAMENT_STORAGE_KEY, upsertTournament } from "./tournament-registry.js";

const form = document.querySelector("#download-form");
const nameInput = document.querySelector("#tournament-name");
const linkInput = document.querySelector("#tournament-link");
const status = document.querySelector("#download-status");
const submit = form.querySelector("button");
const reviewLink = document.querySelector("#review-tournaments");

form.addEventListener("submit", (event) => {
  event.preventDefault();

  try {
    const result = buildDownloadUrl(linkInput.value);
    const tournament = createTournament(nameInput.value, result.url);
    const stored = parseStoredTournaments(localStorage.getItem(TOURNAMENT_STORAGE_KEY));
    localStorage.setItem(TOURNAMENT_STORAGE_KEY, JSON.stringify(upsertTournament(stored, tournament)));

    status.classList.remove("error");
    status.textContent = `${tournament.name} was added. Opening the ${result.isOneDrive ? "OneDrive " : ""}download in a new tab…`;
    reviewLink.href = `index.html?tournament=${encodeURIComponent(tournament.id)}`;
    reviewLink.hidden = false;

    submit.disabled = true;
    const downloadLink = document.createElement("a");
    downloadLink.href = result.url;
    downloadLink.target = "_blank";
    downloadLink.rel = "noopener noreferrer";
    downloadLink.click();
    window.setTimeout(() => { submit.disabled = false; }, 800);
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
    (nameInput.value.trim() ? linkInput : nameInput).focus();
  }
});
