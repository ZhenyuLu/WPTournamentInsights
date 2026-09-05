import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server import available_path, safe_workbook_name, validate_remote_url


class ServerHelpersTest(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
