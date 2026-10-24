"""Windows-side lifecycle adapter; native Codex owns authentication and the wire protocol."""
import contextlib
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
STATE = ROOT / 'state'
SOCKET = ROOT / 'socket/app-server.sock'


def windows_path(value):
    if len(value) >= 3 and value[0] == '/' and value[1].isalpha() and value[2] == '/':
        return value[1].upper() + ':' + value[2:].replace('/', '\\')
    return value


def native_cli():
    override = os.environ.get('CODEX_SSH_COMPAT_CLI')
    if override:
        return Path(windows_path(override)).resolve(strict=True)
    base = Path(os.environ['LOCALAPPDATA']) / 'OpenAI/Codex/bin'
    paths = list(base.rglob('codex.exe'))
    if not paths:
        raise RuntimeError('Install Windows Codex or set CODEX_SSH_COMPAT_CLI')
    return max(paths, key=lambda p: p.stat().st_mtime_ns)


def environment():
    env = dict(os.environ)
    env['CODEX_HOME'] = windows_path(env.get('CODEX_HOME', str(Path.home() / '.codex')))
    # Shell startup hooks are for the SSH wrapper, not for native task shells.
    for key in ('BASH_ENV', 'CODEX_REMOTE_PAYLOAD'):
        env.pop(key, None)
    return env


def creation_time(pid):
    k = ctypes.WinDLL('kernel32', use_last_error=True)
    k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    k.OpenProcess.restype = wintypes.HANDLE
    k.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    k.CloseHandle.argtypes = [wintypes.HANDLE]
    h = k.OpenProcess(0x1000, False, int(pid))
    if not h:
        return None
    try:
        values = [wintypes.FILETIME() for _ in range(4)]
        if not k.GetProcessTimes(h, *[ctypes.byref(v) for v in values]):
            return None
        return (values[0].dwHighDateTime << 32) | values[0].dwLowDateTime
    finally:
        k.CloseHandle(h)


def current():
    try:
        record = json.loads((STATE / 'server.json').read_text())
    except FileNotFoundError:
        return None
    if not isinstance(record.get('created'), int) or record['created'] <= 0:
        return None
    return record if creation_time(record['pid']) == record['created'] else None


def listener_port(pattern):
    match = re.fullmatch(r'\$4 == "0A" && \$2 ~ /:([0-9A-F]{4})\$/ \{print \$2\}', pattern)
    if not match:
        raise RuntimeError('Unsupported listener query')
    return int(match[1], 16)


def parse_tcp_table(raw, family, port):
    row_size, port_offset, state_offset = (24, 8, 0) if family == 2 else (56, 20, 48)
    count = int.from_bytes(raw[:4], 'little')
    if len(raw) < 4 + count * row_size:
        raise RuntimeError('Truncated Windows TCP table')
    addresses = []
    for index in range(count):
        row = raw[4 + index * row_size:4 + (index + 1) * row_size]
        local_port = socket.ntohs(int.from_bytes(row[port_offset:port_offset + 4], 'little') & 0xffff)
        state = int.from_bytes(row[state_offset:state_offset + 4], 'little')
        if local_port == port and state == 2:
            address = f'{int.from_bytes(row[4:8], "little"):08X}' if family == 2 else row[:16].hex().upper()
            addresses.append(f'{address}:{port:04X}')
    return addresses


def listeners(pattern):
    port = listener_port(pattern)
    api = ctypes.WinDLL('iphlpapi', use_last_error=True)
    api.GetExtendedTcpTable.argtypes = [ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD),
        wintypes.BOOL, wintypes.DWORD, ctypes.c_int, wintypes.DWORD]
    for family, row_size, port_offset, state_offset in [(2, 24, 8, 0), (23, 56, 20, 48)]:
        size = wintypes.DWORD(0)
        code = api.GetExtendedTcpTable(None, ctypes.byref(size), False, family, 3, 0)
        if code not in (0, 122):
            raise ctypes.WinError(code)
        for attempt in range(4):
            table = ctypes.create_string_buffer(size.value)
            code = api.GetExtendedTcpTable(table, ctypes.byref(size), False, family, 3, 0)
            if code != 122:
                break
        if code:
            raise ctypes.WinError(code)
        raw = table.raw
        for address in parse_tcp_table(raw, family, port):
            print(address)
    return 0


@contextlib.contextmanager
def lock():
    import msvcrt
    STATE.mkdir(exist_ok=True)
    with (STATE / 'lifecycle.lock').open('a+b') as f:
        if f.tell() == 0:
            f.write(b'0'); f.flush()
        for attempt in range(200):
            try:
                f.seek(0); msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1); break
            except OSError:
                if attempt == 199:
                    raise RuntimeError('Timed out waiting for lifecycle lock')
                time.sleep(.05)
        try:
            yield
        finally:
            f.seek(0); msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)


def start(options):
    with lock():
        record = current()
        if record:
            return record
        SOCKET.unlink(missing_ok=True)
        args = [str(native_cli()), *options, 'app-server', '--listen', 'unix://' + SOCKET.as_posix()]
        with (STATE / 'server.log').open('ab') as log:
            child = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                cwd=str(Path.home()), env=environment(), close_fds=True,
                creationflags=0x01000000 | 0x00000008 | 0x00000200)
        record = {'pid': child.pid, 'created': creation_time(child.pid), 'executable': args[0]}
        if record['created'] is None:
            child.terminate()
            raise RuntimeError('Could not record native server process identity')
        for _ in range(200):
            if child.poll() is not None:
                raise RuntimeError('Native app-server exited; inspect state/server.log')
            if SOCKET.exists():
                (STATE / 'server.json').write_text(json.dumps(record))
                return record
            time.sleep(.05)
        child.terminate()
        raise RuntimeError('Native app-server socket did not become ready')


def stop():
    with lock():
        record = current()
        if not record:
            return 1
        # Revalidate PID creation time under the lifecycle lock before termination.
        k = ctypes.WinDLL('kernel32', use_last_error=True)
        k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        k.OpenProcess.restype = wintypes.HANDLE
        k.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
        k.CloseHandle.argtypes = [wintypes.HANDLE]
        h = k.OpenProcess(1 | 0x1000, False, record['pid'])
        if not h:
            return 1
        try:
            if creation_time(record['pid']) != record['created']:
                raise RuntimeError('Server PID changed')
            if not k.TerminateProcess(h, 0):
                raise ctypes.WinError(ctypes.get_last_error())
        finally:
            k.CloseHandle(h)
        (STATE / 'server.json').unlink(missing_ok=True)
        return 0


def main(args):
    action, *args = args
    if action == 'listeners':
        return listeners(args[0])
    if action == 'pkill':
        if '-f' not in args:
            raise RuntimeError('Only Desktop app-server cleanup patterns are accepted')
        pattern = args[args.index('-f') + 1]
        if 'codex' not in pattern or not ('app-server' in pattern or 'desktop-ssh-websocket' in pattern):
            raise RuntimeError('Refusing unrelated process cleanup')
        # The legacy socket cleanup never refers to this installation's new socket.
        return 1 if 'desktop-ssh-websocket' in pattern else stop()
    if action != 'codex':
        raise RuntimeError('Unknown compatibility command')
    if 'app-server' in args:
        index = args.index('app-server'); options, command = args[:index], args[index + 1:]
        if command == ['proxy']:
            start(options)
            return subprocess.call([str(native_cli()), *options, 'app-server', 'proxy',
                '--sock', str(SOCKET)], env=environment())
        if command == ['--listen', 'unix://']:
            start(options)
            return 0
    return subprocess.call([str(native_cli()), *args], env=environment())


if __name__ == '__main__':
    try:
        raise SystemExit(main(sys.argv[1:]))
    except Exception as error:
        print('Windows SSH compatibility: ' + str(error), file=sys.stderr)
        raise SystemExit(1)
