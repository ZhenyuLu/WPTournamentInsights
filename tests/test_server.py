import json
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server import AppHandler, available_path, safe_workbook_name, validate_remote_url
from xlsx_processor import parse_workbook, process_workbook


class ServerHelpersTest(unittest.TestCase):
    def test_local_server_disables_browser_caching(self):
        headers = []
        handler = object.__new__(AppHandler)
        handler.send_header = lambda name, value: headers.append((name, value))
        with patch("http.server.SimpleHTTPRequestHandler.end_headers"):
            handler.end_headers()
        self.assertIn(("Cache-Control", "no-store"), headers)

    def test_safe_workbook_name(self):
        self.assertEqual(safe_workbook_name("2026 KAP7 International"), "2026_KAP7_International.xlsx")
        self.assertEqual(safe_workbook_name("  Summer / Finals  "), "Summer_Finals.xlsx")
        with self.assertRaisesRegex(ValueError, "letters or numbers"):
            safe_workbook_name("---")

    def test_available_path_never_overwrites(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "Tournament.xlsx").touch()
            (root / "Tournament-2.xlsx").touch()
            self.assertEqual(available_path(root, "Tournament.xlsx").name, "Tournament-3.xlsx")

    @patch("server.socket.getaddrinfo")
    def test_rejects_private_network_downloads(self, getaddrinfo):
        getaddrinfo.return_value = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))]
        with self.assertRaisesRegex(ValueError, "Private or local"):
            validate_remote_url("https://localhost/results.xlsx")

    @patch("server.socket.getaddrinfo")
    def test_accepts_public_https_downloads(self, getaddrinfo):
        getaddrinfo.return_value = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]
        self.assertEqual(validate_remote_url("https://example.com/results.xlsx"), "https://example.com/results.xlsx")

    def test_bundled_workbook_is_processed_into_app_schedule(self):
        workbook = Path(__file__).resolve().parents[1] / "2026_NJO_Public_Sched_S2.xlsx"
        schedule = parse_workbook(workbook)
        self.assertEqual(len(schedule["divisions"]), 13)
        self.assertEqual(sum(len(item["games"]) for item in schedule["divisions"]), 2187)
        self.assertTrue(all(item["games"] and item["teams"] for item in schedule["divisions"]))

    def test_processing_writes_json_to_the_requested_data_directory(self):
        workbook = Path(__file__).resolve().parents[1] / "2026_NJO_Public_Sched_S2.xlsx"
        with tempfile.TemporaryDirectory() as directory:
            destination, schedule = process_workbook(workbook, Path(directory))
            self.assertEqual(destination.name, "2026_NJO_Public_Sched_S2.json")
            self.assertEqual(json.loads(destination.read_text())["source"], workbook.name)
            self.assertEqual(len(schedule["divisions"]), 13)

    def test_compact_master_schedule_is_grouped_by_division(self):
        workbook = Path(__file__).resolve().parents[1] / "2026 KAP7 INTERNATIONAL.xlsx"
        if not workbook.exists():
            self.skipTest("locally downloaded example workbook is unavailable")
        schedule = parse_workbook(workbook)
        self.assertGreater(len(schedule["divisions"]), 5)
        self.assertGreater(sum(len(item["games"]) for item in schedule["divisions"]), 100)

    def test_side_by_side_schedule_blocks_are_processed(self):
        workbook = Path(__file__).resolve().parents[1] / "2026_Kap_7_Futures_League.xlsx"
        if not workbook.exists():
            self.skipTest("locally downloaded example workbook is unavailable")
        schedule = parse_workbook(workbook)
        self.assertGreater(len(schedule["divisions"]), 5)
        self.assertGreater(sum(len(item["games"]) for item in schedule["divisions"]), 500)


if __name__ == "__main__":
    unittest.main()
