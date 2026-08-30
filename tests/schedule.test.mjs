import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { buildTeamUrl, opponentFor, resolveTeam } from "../app-logic.js";

const schedule = JSON.parse(await fs.readFile(new URL("../data/schedule.json", import.meta.url), "utf8"));

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
  assert.match(html, /id="team"/);
  assert.match(html, /id="search-form"/);
  assert.match(app, /fetch\("data\/schedule\.json"\)/);
});

test("game links resolve to the opponent summary in the same division", () => {
  const division = schedule.divisions.find(({ id }) => id === "10U_M_Champ_35");
  const game = division.games.find(({ id }) => id === "10B-001");
  const opponent = opponentFor(game, "SD DONS");
  const url = buildTeamUrl(division.id, opponent);

  assert.equal(opponent, "SAN CLEMENTE BLACK");
  assert.equal(url, "?division=10U_M_Champ_35&team=SAN+CLEMENTE+BLACK");
  assert.equal(resolveTeam(division, new URLSearchParams(url).get("team")).team, opponent);
});
