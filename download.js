import { buildDownloadUrl } from "./download-logic.js";
import { createTournament, parseStoredTournaments, TOURNAMENT_STORAGE_KEY, upsertTournament } from "./tournament-registry.js";

const form = document.querySelector("#download-form");
const nameInput = document.querySelector("#tournament-name");
const linkInput = document.querySelector("#tournament-link");
const status = document.querySelector("#download-status");
const submit = form.querySelector("button");
const reviewLink = document.querySelector("#review-tournaments");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const result = buildDownloadUrl(linkInput.value);
    submit.disabled = true;
    status.classList.remove("error");
    status.textContent = "Downloading the tournament workbook to the project folder…";

    const response = await fetch("/api/tournaments/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nameInput.value, url: result.url }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "The workbook could not be downloaded.");

    const tournament = createTournament(nameInput.value, result.url);
    tournament.localFilename = payload.filename;
    const stored = parseStoredTournaments(localStorage.getItem(TOURNAMENT_STORAGE_KEY));
    localStorage.setItem(TOURNAMENT_STORAGE_KEY, JSON.stringify(upsertTournament(stored, tournament)));

    status.classList.remove("error");
    status.textContent = `Download complete: ${payload.filename} was saved to the project folder and ${tournament.name} was added.`;
    reviewLink.href = `index.html?tournament=${encodeURIComponent(tournament.id)}`;
    reviewLink.hidden = false;
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
    (nameInput.value.trim() ? linkInput : nameInput).focus();
  } finally {
    submit.disabled = false;
  }
});
