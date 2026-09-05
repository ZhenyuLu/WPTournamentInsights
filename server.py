#!/usr/bin/env python3
"""Local development server with a guarded tournament workbook downloader."""

from __future__ import annotations

import ipaddress
import json
import os
from pathlib import Path
import re
import socket
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import tempfile
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from xlsx_processor import process_workbook

PROJECT_ROOT = Path(__file__).resolve().parent
MAX_REQUEST_BYTES = 16 * 1024
MAX_WORKBOOK_BYTES = 50 * 1024 * 1024


def safe_workbook_name(tournament_name: str) -> str:
    normalized = unicodedata.normalize("NFKD", tournament_name).encode("ascii", "ignore").decode()
    stem = re.sub(r"[^A-Za-z0-9]+", "_", normalized).strip("_")[:80]
    if not stem:
        raise ValueError("Enter a tournament name containing letters or numbers.")
    return f"{stem}.xlsx"


def available_path(directory: Path, filename: str) -> Path:
    candidate = directory / filename
    counter = 2
    while candidate.exists():
        candidate = directory / f"{Path(filename).stem}-{counter}.xlsx"
        counter += 1
    return candidate


def validate_remote_url(value: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("The tournament result must be a public HTTPS link.")

    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise ValueError("The tournament host could not be found.") from error

    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise ValueError("Private or local network addresses are not allowed.")
    return value


class GuardedRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        validate_remote_url(new_url)
        return super().redirect_request(request, file_pointer, code, message, headers, new_url)


def download_workbook(source_url: str, tournament_name: str) -> Path:
    validate_remote_url(source_url)
    destination = available_path(PROJECT_ROOT, safe_workbook_name(tournament_name))
    opener = build_opener(GuardedRedirectHandler())
    request = Request(source_url, headers={"User-Agent": "WPTournamentInsights/0.1"})

    temporary_path = None
    try:
        with opener.open(request, timeout=30) as response, tempfile.NamedTemporaryFile(
            prefix=".tournament-", suffix=".part", dir=PROJECT_ROOT, delete=False
        ) as temporary:
            temporary_path = Path(temporary.name)
            total = 0
            while chunk := response.read(64 * 1024):
                total += len(chunk)
                if total > MAX_WORKBOOK_BYTES:
                    raise ValueError("The workbook is larger than the 50 MB limit.")
                temporary.write(chunk)

        if temporary_path.stat().st_size == 0:
            raise ValueError("The downloaded workbook was empty.")
        with temporary_path.open("rb") as workbook:
            if workbook.read(4) != b"PK\x03\x04":
                raise ValueError("The link did not return a valid .xlsx workbook.")

        os.replace(temporary_path, destination)
        return destination
    finally:
        if temporary_path and temporary_path.exists():
            temporary_path.unlink()


def processing_response(destination: Path) -> dict:
    data_path, schedule = process_workbook(destination, PROJECT_ROOT / "data" / "tournaments")
    return {
        "filename": destination.name,
        "dataUrl": data_path.relative_to(PROJECT_ROOT).as_posix(),
        "divisionCount": len(schedule["divisions"]),
        "gameCount": sum(len(division["games"]) for division in schedule["divisions"]),
        "message": "Download and processing complete.",
    }


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PROJECT_ROOT), **kwargs)

    def send_json(self, status: int, payload: dict) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self) -> None:
        if self.path not in {"/api/tournaments/download", "/api/tournaments/process"}:
            self.send_json(404, {"error": "Not found."})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > MAX_REQUEST_BYTES:
                raise ValueError("Invalid download request.")
            payload = json.loads(self.rfile.read(length))
            if self.path == "/api/tournaments/download":
                tournament_name = str(payload.get("name", "")).strip()
                source_url = str(payload.get("url", "")).strip()
                destination = download_workbook(source_url, tournament_name)
            else:
                filename = str(payload.get("filename", "")).strip()
                if Path(filename).name != filename or not filename.lower().endswith(".xlsx"):
                    raise ValueError("Invalid workbook filename.")
                destination = PROJECT_ROOT / filename
                if not destination.is_file():
                    raise ValueError("The downloaded workbook could not be found in the project folder.")
            self.send_json(201, processing_response(destination))
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": str(error)})
        except (HTTPError, URLError, TimeoutError) as error:
            detail = getattr(error, "reason", "the request timed out")
            self.send_json(502, {"error": f"The workbook could not be downloaded: {detail}."})
        except Exception:
            self.send_json(500, {"error": "The workbook could not be downloaded."})


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 8000), AppHandler)
    print("Water Polo Tournament Insights running at http://127.0.0.1:8000", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
