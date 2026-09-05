# Water Polo Tournament Insights

A static MVP that turns the example NJO Excel workbook into a searchable team-performance page.

## Run locally

Start the local app server:

```sh
python3 server.py
```

Open `http://localhost:8000` and choose a division and team.

Use `download.html` to name a tournament and paste its shared workbook URL. Google Sheets editor links are converted to Excel export URLs, and OneDrive or SharePoint links are converted to direct downloads. The local server saves validated `.xlsx` files directly into the project folder without overwriting existing files, extracts their divisions, teams, and games into app-ready JSON, and marks them ready in the main tournament selector. Older downloads that were saved before processing was added are processed automatically when selected.

## Test

Run the syntax checks and data-integrity tests with:

```sh
npm test
```

## Refresh the data

The bundled tournament reads `data/schedule.json`, generated from `2026_NJO_Public_Sched_S2.xlsx` by `scripts/extract-schedule.mjs`. Shared-link downloads are processed by the dependency-free local parser in `xlsx_processor.py` and saved under `data/tournaments/` at runtime.
