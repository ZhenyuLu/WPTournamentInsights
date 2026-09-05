import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { buildTeamUrl, formatScore, opponentFor, resolveTeam } from "../app-logic.js";
import { buildDownloadUrl } from "../download-logic.js";
import { createTournament, DEFAULT_TOURNAMENT, markTournamentReady, parseStoredTournaments, upsertTournament } from "../tournament-registry.js";

const schedule = JSON.parse(await fs.readFile(new URL("../data/schedule.json", import.meta.url), "utf8"));

test("scores are displayed with at most one decimal place", () => {
  assert.equal(formatScore(58.00000000000001), "58");
  assert.equal(formatScore(13.26), "13.3");
  assert.equal(formatScore(-1.04), "-1");
  assert.equal(formatScore(1.04, { signed: true }), "+1");
  assert.equal(formatScore(-0), "0");
});

test("schedule contains all expected division tabs", () => {
  assert.equal(schedule.divisions.length, 13);
  assert.equal(new Set(schedule.divisions.map(({ id }) => id)).size, 13);
  assert.ok(schedule.divisions.every(({ games }) => games.length > 0));
});

test("every game has valid normalized schedule data", () => {
  for (const division of schedule.divisions) {
    const gameKeys = new Set();
    for (const game of division.games) {
      assert.match(game.id, /^[A-Z0-9]+-/);
      assert.match(game.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(Number.isInteger(game.timeMinutes));
      assert.ok(game.timeMinutes >= 0 && game.timeMinutes < 1440);
      assert.ok(game.white.length > 0);
      assert.ok(game.dark.length > 0);
      assert.ok(game.location.length > 0);
      assert.ok(!gameKeys.has(game.key), `duplicate ${game.key} in ${division.id}`);
      gameKeys.add(game.key);

      for (const score of [game.whiteScore, game.darkScore]) {
        assert.ok(score === null || (Number.isFinite(score) && score >= 0));
      }
    }
  }
});

test("division team indexes match the teams used in games", () => {
  for (const division of schedule.divisions) {
    const expected = [...new Set(division.games.flatMap(({ white, dark }) => [white, dark]).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    assert.deepEqual(division.teams, expected);
  }
});

test("known SD DONS workbook results produce a 6-1 record", () => {
  const division = schedule.divisions.find(({ id }) => id === "10U_M_Champ_35");
  assert.ok(division);

  const games = division.games.filter(({ white, dark }) => white === "SD DONS" || dark === "SD DONS");
  assert.equal(games.length, 7);

  const record = games.reduce((total, game) => {
    const isWhite = game.white === "SD DONS";
    const teamScore = isWhite ? game.whiteScore : game.darkScore;
    const opponentScore = isWhite ? game.darkScore : game.whiteScore;
    if (teamScore > opponentScore) total.wins++;
    if (teamScore < opponentScore) total.losses++;
    if (teamScore === opponentScore) total.ties++;
    return total;
  }, { wins: 0, losses: 0, ties: 0 });

  assert.deepEqual(record, { wins: 6, losses: 1, ties: 0 });
});

test("page loads the generated schedule and exposes the lookup controls", async () => {
  const html = await fs.readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await fs.readFile(new URL("../app.js", import.meta.url), "utf8");

  assert.match(html, /id="division"/);
  assert.match(html, /id="tournament"/);
  assert.match(html, /id="team"/);
  assert.match(html, /<select id="team"/);
  assert.doesNotMatch(html, /<datalist/);
  assert.match(html, /id="search-form"/);
  assert.match(app, /fetch\(tournament\.dataUrl\)/);
  assert.match(app, /\/api\/tournaments\/process/);
});

test("game links resolve to the opponent summary in the same division", () => {
  const division = schedule.divisions.find(({ id }) => id === "10U_M_Champ_35");
  const game = division.games.find(({ id }) => id === "10B-001");
  const opponent = opponentFor(game, "SD DONS");
  const url = buildTeamUrl(DEFAULT_TOURNAMENT.id, division.id, opponent);

  assert.equal(opponent, "SAN CLEMENTE BLACK");
  assert.equal(url, "?tournament=2026-junior-olympics-session-2&division=10U_M_Champ_35&team=SAN+CLEMENTE+BLACK");
  assert.equal(resolveTeam(division, new URLSearchParams(url).get("team")).team, opponent);
});

test("the bundled workbook has the requested tournament name", () => {
  assert.equal(DEFAULT_TOURNAMENT.name, "2026 Junior Olympics Session 2");
  assert.equal(DEFAULT_TOURNAMENT.dataUrl, "data/schedule.json");
  assert.equal(DEFAULT_TOURNAMENT.status, "ready");
});

test("named tournament downloads can be stored and updated", () => {
  const tournament = createTournament("  Summer   Invitational  ", "https://example.com/results.xlsx");
  assert.equal(tournament.name, "Summer Invitational");
  assert.equal(tournament.status, "downloaded");
  assert.equal(upsertTournament([], tournament)[0].id, tournament.id);
  assert.deepEqual(parseStoredTournaments(JSON.stringify([tournament])), [tournament]);
  assert.deepEqual(parseStoredTournaments("not-json"), []);
  assert.throws(() => createTournament(" ", "https://example.com/results.xlsx"), /Enter the tournament name/);
});

test("processed tournament downloads are immediately ready for review", () => {
  const downloaded = createTournament("Summer Invitational", "https://example.com/results.xlsx");
  const ready = markTournamentReady(downloaded, {
    filename: "Summer_Invitational.xlsx",
    dataUrl: "data/tournaments/Summer_Invitational.json",
  });
  assert.equal(ready.status, "ready");
  assert.equal(ready.localFilename, "Summer_Invitational.xlsx");
  assert.equal(ready.dataUrl, "data/tournaments/Summer_Invitational.json");
  assert.throws(() => markTournamentReady(downloaded, {}), /processed tournament data is incomplete/);
});

test("OneDrive and SharePoint links are converted to direct downloads", () => {
  assert.deepEqual(buildDownloadUrl("https://1drv.ms/x/s!example?e=abc"), {
    url: "https://1drv.ms/x/s!example?e=abc&download=1",
    isOneDrive: true,
    isGoogleSheets: false,
  });
  assert.deepEqual(buildDownloadUrl("https://example.sharepoint.com/:x:/s/results?web=1"), {
    url: "https://example.sharepoint.com/:x:/s/results?web=1&download=1",
    isOneDrive: true,
    isGoogleSheets: false,
  });
});

test("Google Sheets editor links are converted to Excel exports", () => {
  const sharedUrl = "https://docs.google.com/spreadsheets/d/1AkX3vwOU9CIc3cymacG2F-uXz-_Gi_A8yR40dEbDpMQ/edit?gid=271825513#gid=271825513";
  assert.deepEqual(buildDownloadUrl(sharedUrl), {
    url: "https://docs.google.com/spreadsheets/d/1AkX3vwOU9CIc3cymacG2F-uXz-_Gi_A8yR40dEbDpMQ/export?format=xlsx",
    isOneDrive: false,
    isGoogleSheets: true,
  });
});

test("download links must be complete HTTPS URLs", () => {
  assert.throws(() => buildDownloadUrl(""), /Enter a tournament result link/);
  assert.throws(() => buildDownloadUrl("example.com/results.xlsx"), /beginning with https/);
  assert.throws(() => buildDownloadUrl("http://example.com/results.xlsx"), /must use HTTPS/);
  assert.deepEqual(buildDownloadUrl("https://example.com/results.xlsx"), {
    url: "https://example.com/results.xlsx",
    isOneDrive: false,
    isGoogleSheets: false,
  });
});

test("download page saves through the local project API", async () => {
  const script = await fs.readFile(new URL("../download.js", import.meta.url), "utf8");
  assert.match(script, /fetch\("\/api\/tournaments\/download"/);
  assert.match(script, /Download and processing complete:/);
  assert.doesNotMatch(script, /downloadLink\.click/);
});
