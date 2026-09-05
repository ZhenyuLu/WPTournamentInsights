import { buildDownloadUrl } from "./download-logic.js";

const form = document.querySelector("#download-form");
const input = document.querySelector("#tournament-link");
const status = document.querySelector("#download-status");
const submit = form.querySelector("button");

form.addEventListener("submit", (event) => {
  event.preventDefault();

  try {
    const result = buildDownloadUrl(input.value);
    status.classList.remove("error");
    status.textContent = result.isOneDrive
      ? "Opening the OneDrive download in a new tab…"
      : "Opening the tournament result link in a new tab…";

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
    input.focus();
  }
});
