import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const [inputPath = "2026_NJO_Public_Sched_S2.xlsx", outputPath = "data/schedule.json"] = process.argv.slice(2);
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));

const excelDate = (serial) => {
  if (typeof serial !== "number" || serial < 40000) return null;
  const utc = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(utc).toISOString().slice(0, 10);
};

const excelTime = (serial) => {
  if (typeof serial !== "number" || serial < 0 || serial >= 1) return null;
  const minutes = Math.round(serial * 24 * 60);
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(mins).padStart(2, "0")} ${suffix}`;
};

const excelTimeMinutes = (serial) => typeof serial === "number" && serial >= 0 && serial < 1
  ? Math.round(serial * 24 * 60)
  : null;

const cleanTeam = (value) => {
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/\s+/g, " ").trim();
  const dash = trimmed.indexOf("-");
  return dash === -1 ? trimmed : trimmed.slice(dash + 1).trim();
};

const divisions = [];
for (const sheet of workbook.worksheets.items.slice(1)) {
  const rows = sheet.getUsedRange(true)?.values ?? [];
  const games = [];
  let columns = null;

  for (const row of rows) {
    if (row?.[0] === "Date" && row?.[1] === "Time" && row?.[5] === "White" && row?.[7] === "Dark") {
      columns = { date: 0, time: 1, type: 2, location: 3, gameNumber: 4, white: 5, whiteScore: 6, dark: 7, darkScore: 8, gameId: 11 };
      continue;
    }

    if (!columns) continue;
    const gameId = row?.[columns.gameId];
    const whiteRaw = row?.[columns.white];
    const darkRaw = row?.[columns.dark];
    if (typeof gameId !== "string" || !whiteRaw || !darkRaw || !excelDate(row[columns.date])) continue;

    const whiteScore = Number.isFinite(row[columns.whiteScore]) ? row[columns.whiteScore] : null;
    const darkScore = Number.isFinite(row[columns.darkScore]) ? row[columns.darkScore] : null;
    games.push({
      id: gameId.trim(),
      date: excelDate(row[columns.date]),
      time: excelTime(row[columns.time]) ?? String(row[columns.time] ?? ""),
      timeMinutes: excelTimeMinutes(row[columns.time]),
      type: String(row[columns.type] ?? ""),
      location: String(row[columns.location] ?? ""),
      gameNumber: row[columns.gameNumber] ?? null,
      white: cleanTeam(whiteRaw),
      whiteRaw: String(whiteRaw).trim(),
      whiteScore,
      dark: cleanTeam(darkRaw),
      darkRaw: String(darkRaw).trim(),
      darkScore,
    });
  }

  const teams = [...new Set(games.flatMap((game) => [game.white, game.dark]).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  divisions.push({ id: sheet.name, label: sheet.name.replaceAll("_", " "), teams, games });
}

await fs.mkdir(new URL("../data/", import.meta.url), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), source: inputPath, divisions }, null, 2));
console.log(`Extracted ${divisions.reduce((sum, division) => sum + division.games.length, 0)} games across ${divisions.length} divisions.`);
