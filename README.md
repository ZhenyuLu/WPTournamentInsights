# Water Polo Tournament Insights

A static MVP that turns the example NJO Excel workbook into a searchable team-performance page.

## Run locally

Start the local app server:

```sh
python3 server.py
```

Open `http://localhost:8000` and choose a division and team.

Use `download.html` to name a tournament and paste its shared workbook URL. The local server downloads validated `.xlsx` files directly into the project folder, without overwriting existing files. Downloaded tournaments are saved in the browser and appear in the main tournament selector. The bundled workbook is named **2026 Junior Olympics Session 2** and is ready to review; newly downloaded workbooks remain marked as processing required until automatic Excel parsing is added.

## Test

Run the syntax checks and data-integrity tests with:

```sh
npm test
```

## Refresh the data

The browser reads `data/schedule.json`, generated from `2026_NJO_Public_Sched_S2.xlsx` by `scripts/extract-schedule.mjs`. The extraction step uses the Codex bundled spreadsheet runtime. The UI is deliberately isolated from this import step so a future OneDrive adapter can fetch the shared workbook and produce the same JSON shape.
