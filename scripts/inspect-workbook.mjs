import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Usage: node scripts/inspect-workbook.mjs <workbook.xlsx>");

const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);

const overview = await workbook.inspect({
  kind: process.argv[3] ?? "workbook,sheet,table,region",
  ...(process.argv[4] ? { sheetId: process.argv[4] } : {}),
  ...(process.argv[5] ? { range: process.argv[5] } : {}),
  maxChars: 30000,
  tableMaxRows: 18,
  tableMaxCols: 18,
  tableMaxCellChars: 120,
});

console.log(overview.ndjson);
