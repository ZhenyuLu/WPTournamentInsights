# Water Polo Tournament Insights

A static MVP that turns the example NJO Excel workbook into a searchable team-performance page.

## Run locally

Serve the project directory with any static HTTP server, then open the displayed URL. For example:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000` and choose a division and team.

## Test

Run the syntax checks and data-integrity tests with:

```sh
npm test
```

## Refresh the data

The browser reads `data/schedule.json`, generated from `2026_NJO_Public_Sched_S2.xlsx` by `scripts/extract-schedule.mjs`. The extraction step uses the Codex bundled spreadsheet runtime. The UI is deliberately isolated from this import step so a future OneDrive adapter can fetch the shared workbook and produce the same JSON shape.
