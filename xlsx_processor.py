"""Convert water-polo schedule workbooks into the JSON consumed by the app."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path, PurePosixPath
import re
import tempfile
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DOCUMENT_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CELL_REFERENCE = re.compile(r"([A-Z]+)")


def _tag(namespace: str, name: str) -> str:
    return f"{{{namespace}}}{name}"


def _column_index(reference: str) -> int:
    match = CELL_REFERENCE.match(reference.upper())
    if not match:
        raise ValueError(f"Invalid worksheet cell reference: {reference}")
    index = 0
    for character in match.group(1):
        index = index * 26 + ord(character) - ord("A") + 1
    return index - 1


def _shared_strings(archive: ZipFile) -> list[str]:
    try:
        root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return ["".join(node.text or "" for node in item.iter(_tag(MAIN_NS, "t"))) for item in root]


def _sheet_paths(archive: ZipFile) -> list[tuple[str, str]]:
    workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    relationships = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {relation.get("Id"): relation.get("Target", "")
               for relation in relationships.findall(_tag(PACKAGE_REL_NS, "Relationship"))}
    sheets = []
    for sheet in workbook.iter(_tag(MAIN_NS, "sheet")):
        target = targets.get(sheet.get(_tag(DOCUMENT_REL_NS, "id")), "")
        if not target:
            continue
        path = target.lstrip("/") if target.startswith("/xl/") else str(PurePosixPath("xl") / target)
        sheets.append((sheet.get("name", "Untitled"), path))
    return sheets


def _cell_value(cell: ElementTree.Element, shared_strings: list[str]):
    cell_type = cell.get("t")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.iter(_tag(MAIN_NS, "t")))
    value_node = cell.find(_tag(MAIN_NS, "v"))
    if value_node is None or value_node.text is None:
        return None
    value = value_node.text
    if cell_type == "s":
        try:
            return shared_strings[int(value)]
        except (ValueError, IndexError):
            return ""
    if cell_type in {"str", "e"}:
        return value
    if cell_type == "b":
        return value == "1"
    try:
        number = float(value)
        return int(number) if number.is_integer() else number
    except ValueError:
        return value


def _worksheet_rows(archive: ZipFile, path: str, shared_strings: list[str]):
    root = ElementTree.fromstring(archive.read(path))
    for row in root.iter(_tag(MAIN_NS, "row")):
        values = {}
        for cell in row.findall(_tag(MAIN_NS, "c")):
            reference = cell.get("r", "")
            if reference:
                values[_column_index(reference)] = _cell_value(cell, shared_strings)
        if values:
            result = [None] * (max(values) + 1)
            for index, value in values.items():
                result[index] = value
            yield result


def _excel_date(value) -> str | None:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 40000:
        return None
    return (datetime(1899, 12, 30) + timedelta(days=value)).date().isoformat()


def _excel_time_minutes(value) -> int | None:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not 0 <= value < 1:
        return None
    return round(value * 24 * 60) % (24 * 60)


def _excel_time(value) -> str | None:
    minutes = _excel_time_minutes(value)
    if minutes is None:
        return None
    hours, minute = divmod(minutes, 60)
    return f"{hours % 12 or 12}:{minute:02d} {'PM' if hours >= 12 else 'AM'}"


def _clean_team(value) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = " ".join(value.split())
    return cleaned.split("-", 1)[-1].strip()


def _score(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    try:
        number = float(value)
        return int(number) if number.is_integer() else number
    except (TypeError, ValueError):
        return None


def _games_from_rows(rows) -> list[dict]:
    games = []
    columns = None
    for row in rows:
        padded = [*row, *([None] * max(0, 12 - len(row)))]
        if padded[0] == "Date" and padded[1] == "Time" and padded[5] == "White" and padded[7] == "Dark":
            columns = {"date": 0, "time": 1, "type": 2, "location": 3, "number": 4,
                       "white": 5, "white_score": 6, "dark": 7, "dark_score": 8, "id": 11}
            continue
        if not columns:
            continue
        game_id = padded[columns["id"]]
        date = _excel_date(padded[columns["date"]])
        white_raw, dark_raw = padded[columns["white"]], padded[columns["dark"]]
        if not isinstance(game_id, str) or not date or not white_raw or not dark_raw:
            continue
        white, dark = _clean_team(white_raw), _clean_team(dark_raw)
        if not white or not dark:
            continue
        game_id = game_id.strip()
        minutes = _excel_time_minutes(padded[columns["time"]])
        location = str(padded[columns["location"]] or "")
        games.append({
            "key": f"{game_id}|{date}|{minutes if minutes is not None else 'unknown'}|{location}",
            "id": game_id, "date": date,
            "time": _excel_time(padded[columns["time"]]) or str(padded[columns["time"]] or ""),
            "timeMinutes": minutes, "type": str(padded[columns["type"]] or ""), "location": location,
            "gameNumber": padded[columns["number"]], "white": white, "whiteRaw": str(white_raw).strip(),
            "whiteScore": _score(padded[columns["white_score"]]), "dark": dark,
            "darkRaw": str(dark_raw).strip(), "darkScore": _score(padded[columns["dark_score"]]),
        })
    return games


def _grouped_games_from_rows(rows) -> dict[str, list[dict]]:
    """Parse compact master sheets that identify each game's division in a column."""
    divisions: dict[str, list[dict]] = {}
    columns = None
    for row in rows:
        headers = {str(value).strip().upper(): index for index, value in enumerate(row) if isinstance(value, str)}
        required = {"DATE", "TIME", "LOCATION", "GAME ID", "WHITE TEAM", "DARK TEAM", "DIVISION"}
        if required.issubset(headers):
            columns = headers
            continue
        if not columns:
            continue
        padded = [*row, *([None] * max(0, max(columns.values()) + 1 - len(row)))]
        date = _excel_date(padded[columns["DATE"]])
        game_id = padded[columns["GAME ID"]]
        division = str(padded[columns["DIVISION"]] or "").strip()
        white_raw, dark_raw = padded[columns["WHITE TEAM"]], padded[columns["DARK TEAM"]]
        if not date or not isinstance(game_id, str) or not division or not white_raw or not dark_raw:
            continue
        white, dark = _clean_team(white_raw), _clean_team(dark_raw)
        if not white or not dark:
            continue
        minutes = _excel_time_minutes(padded[columns["TIME"]])
        location = str(padded[columns["LOCATION"]] or "")
        game_id = game_id.strip()
        white_score_index = columns["WHITE TEAM"] + 1
        dark_score_index = columns["DARK TEAM"] + 1
        comment_index = columns.get("COMMENTS")
        game = {
            "key": f"{game_id}|{date}|{minutes if minutes is not None else 'unknown'}|{location}",
            "id": game_id, "date": date,
            "time": _excel_time(padded[columns["TIME"]]) or str(padded[columns["TIME"]] or ""),
            "timeMinutes": minutes,
            "type": str(padded[comment_index] or "") if comment_index is not None else "",
            "location": location, "gameNumber": None,
            "white": white, "whiteRaw": str(white_raw).strip(), "whiteScore": _score(padded[white_score_index]),
            "dark": dark, "darkRaw": str(dark_raw).strip(), "darkScore": _score(padded[dark_score_index]),
        }
        divisions.setdefault(division, []).append(game)
    return divisions


def _side_by_side_games(rows) -> list[dict]:
    """Parse schedule blocks laid out as Saturday and Sunday tables side by side."""
    rows = list(rows)
    contexts: dict[int, tuple[object, str]] = {}
    games: dict[str, dict] = {}
    for row in rows:
        padded = [*row, *([None] * max(0, 18 - len(row)))]
        for base in (0, 9):
            if _excel_date(padded[base + 1]) and str(padded[base + 4] or "").strip().lower() == "location:":
                contexts[base] = (padded[base + 1], str(padded[base + 5] or ""))
            if not isinstance(padded[base], str) or not isinstance(padded[base + 1], (int, float)):
                continue
            if padded[base].strip().lower() == "game #" or base not in contexts:
                continue
            white_raw, dark_raw = padded[base + 2], padded[base + 4]
            if not isinstance(white_raw, str) or not isinstance(dark_raw, str):
                continue
            date_serial, location = contexts[base]
            date = _excel_date(date_serial)
            minutes = _excel_time_minutes(padded[base + 1])
            game_id = padded[base].strip()
            white, dark = _clean_team(white_raw), _clean_team(dark_raw)
            if not date or minutes is None or not game_id or not white or not dark:
                continue
            key = f"{game_id}|{date}|{minutes}|{location}"
            games[key] = {
                "key": key, "id": game_id, "date": date, "time": _excel_time(padded[base + 1]),
                "timeMinutes": minutes, "type": str(padded[base + 7] or ""), "location": location,
                "gameNumber": game_id, "white": white, "whiteRaw": white_raw.strip(),
                "whiteScore": _score(padded[base + 3]), "dark": dark, "darkRaw": dark_raw.strip(),
                "darkScore": _score(padded[base + 5]),
            }
    return list(games.values())


def parse_workbook(workbook_path: Path) -> dict:
    """Return normalized schedule data from every recognizable division sheet."""
    try:
        with ZipFile(workbook_path) as archive:
            strings = _shared_strings(archive)
            divisions = []
            sheets = _sheet_paths(archive)
            master = next(((name, path) for name, path in sheets if name.strip().upper() == "MASTER BY DIVISION"), None)
            if master:
                grouped = _grouped_games_from_rows(_worksheet_rows(archive, master[1], strings))
                for name, games in grouped.items():
                    teams = sorted({team for game in games for team in (game["white"], game["dark"])})
                    divisions.append({"id": name, "label": name.replace("_", " "), "teams": teams, "games": games})
                sheets = []
            for name, path in sheets:
                rows = list(_worksheet_rows(archive, path, strings))
                games = _games_from_rows(rows) or _side_by_side_games(rows)
                if games:
                    teams = sorted({team for game in games for team in (game["white"], game["dark"])})
                    divisions.append({"id": name, "label": name.replace("_", " "), "teams": teams, "games": games})
    except (BadZipFile, KeyError, ElementTree.ParseError) as error:
        raise ValueError("The downloaded file is not a readable .xlsx workbook.") from error
    if not divisions:
        raise ValueError("The workbook does not contain recognizable water polo schedule tabs.")
    return {"generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "source": workbook_path.name, "divisions": divisions}


def process_workbook(workbook_path: Path, data_directory: Path) -> tuple[Path, dict]:
    """Parse a workbook and atomically save its normalized tournament data."""
    schedule = parse_workbook(workbook_path)
    data_directory.mkdir(parents=True, exist_ok=True)
    destination = data_directory / f"{workbook_path.stem}.json"
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", prefix=".schedule-", suffix=".json",
                                         dir=data_directory, delete=False) as temporary:
            temporary_path = Path(temporary.name)
            json.dump(schedule, temporary, indent=2)
        temporary_path.replace(destination)
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()
    return destination, schedule
