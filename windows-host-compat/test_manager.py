import importlib.util
import json
from pathlib import Path
import socket
import struct
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('manager', Path(__file__).with_name('manager.py'))
manager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manager)


class SecurityTests(unittest.TestCase):
    def test_loopback_check_keeps_wildcard_listener_distinct(self):
        port = 45678
        rows = [struct.pack('<6I', 2, address, socket.htons(port), 0, 0, 123)
                for address in (0x0100007f, 0)]
        result = manager.parse_tcp_table(struct.pack('<I', 2) + b''.join(rows), 2, port)
        self.assertEqual(result, ['0100007F:B26E', '00000000:B26E'])
        self.assertNotEqual('\n'.join(result), '0100007F:B26E')

    def test_listener_check_filters_port_and_state(self):
        rows = [struct.pack('<6I', state, 0x0100007f, socket.htons(port), 0, 0, 123)
                for state, port in [(5, 45678), (2, 45679)]]
        self.assertEqual(manager.parse_tcp_table(struct.pack('<I', 2) + b''.join(rows), 2, 45678), [])
        with self.assertRaisesRegex(RuntimeError, 'Truncated'):
            manager.parse_tcp_table(struct.pack('<I', 3), 2, 45678)

    def test_arbitrary_awk_program_is_not_evaluated(self):
        self.assertEqual(manager.listener_port('$4 == "0A" && $2 ~ /:B26E$/ {print $2}'), 45678)
        with self.assertRaisesRegex(RuntimeError, 'Unsupported'):
            manager.listener_port('BEGIN {system("anything")}')

    def test_pid_reuse_and_missing_creation_time_are_not_live_servers(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(manager, 'STATE', Path(folder)):
            path = Path(folder) / 'server.json'
            path.write_text(json.dumps({'pid': 123, 'created': 456}))
            with patch.object(manager, 'creation_time', return_value=789):
                self.assertIsNone(manager.current())
            path.write_text(json.dumps({'pid': 123, 'created': None}))
            with patch.object(manager, 'creation_time', return_value=None):
                self.assertIsNone(manager.current())

    def test_unrelated_process_cleanup_is_refused(self):
        with patch.object(manager, 'stop') as stop:
            with self.assertRaisesRegex(RuntimeError, 'unrelated'):
                manager.main(['pkill', '-f', 'other-process'])
            self.assertEqual(manager.main(['pkill', '-f', 'codex.*desktop-ssh-websocket-v0.sock']), 1)
            stop.assert_not_called()

    def test_original_native_arguments_are_preserved(self):
        with patch.object(manager, 'native_cli', return_value=Path('codex.exe')), patch.object(manager, 'environment', return_value={}), patch.object(manager.subprocess, 'call', return_value=7) as call:
            self.assertEqual(manager.main(['codex', 'exec', "한글 space ' $"]), 7)
            call.assert_called_once_with(['codex.exe', 'exec', "한글 space ' $"], env={})


if __name__ == '__main__':
    unittest.main()
