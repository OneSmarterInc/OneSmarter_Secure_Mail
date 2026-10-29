"""PQ/mTLS ClamAV gateway; backend stays on a local Unix socket or loopback."""

import argparse
import socket
import ssl
import struct
import threading
from socketserver import BaseRequestHandler, ThreadingTCPServer

from . import tls

MAX_BYTES = 25 * 1024 * 1024


def exact(stream, size):
    value = bytearray()
    while len(value) < size:
        chunk = stream.recv(size - len(value))
        if not chunk:
            raise OSError("Incomplete scanner stream")
        value.extend(chunk)
    return bytes(value)


class Handler(BaseRequestHandler):
    def handle(self):
        try:
            self.request.settimeout(20)
            with self.server.context.wrap_socket(self.request, server_side=True) as remote:
                tls.verify(remote, required=True)
                command = bytearray()
                while len(command) < 10 and not command.endswith(b"\0"):
                    command.extend(exact(remote, 1))
                command = bytes(command)
                if command not in {b"zINSTREAM\0", b"zVERSION\0"}:
                    raise ValueError("Unsupported scanner command")
                with self.server.local_connection() as local:
                    local.sendall(command)
                    total = 0
                    while command == b"zINSTREAM\0":
                        size_bytes = exact(remote, 4)
                        size = struct.unpack("!I", size_bytes)[0]
                        total += size
                        if size > 65536 or total > MAX_BYTES:
                            raise ValueError("Scanner stream limit")
                        local.sendall(size_bytes)
                        if size == 0:
                            break
                        local.sendall(exact(remote, size))
                    result = bytearray()
                    while not result.endswith(b"\0") and len(result) < 4096:
                        result.extend(exact(local, 1))
                    if not result.endswith(b"\0"):
                        raise ValueError("Invalid scanner reply")
                    remote.sendall(result)
        except (OSError, ValueError):
            # No plaintext, certificate material or request bodies in logs.
            return


class Gateway(ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = False

    def __init__(self, address, context, backend):
        tls.configure(context, required=True)
        if context.verify_mode != ssl.CERT_REQUIRED:
            raise ValueError("Scanner gateway requires client certificate authentication.")
        if isinstance(backend, tuple) and backend[0] != "127.0.0.1":
            raise ValueError("Scanner backend TCP must stay on loopback.")
        self.context, self.backend = context, backend
        self.slots = threading.BoundedSemaphore(16)
        super().__init__(address, Handler)

    def local_connection(self):
        if isinstance(self.backend, tuple):
            return socket.create_connection(self.backend, timeout=20)
        local = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            local.settimeout(20)
            local.connect(self.backend)
            return local
        except BaseException:
            local.close()
            raise

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3311)
    for name in ("cert", "key", "ca"):
        parser.add_argument("--" + name, required=True)
    backend = parser.add_mutually_exclusive_group(required=True)
    backend.add_argument("--socket")
    backend.add_argument("--local-port", type=int)
    args = parser.parse_args()
    context = tls.configure(ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER), required=True)
    context.load_cert_chain(args.cert, args.key)
    context.load_verify_locations(args.ca)
    context.verify_mode = ssl.CERT_REQUIRED
    with Gateway(
        (args.host, args.port), context, args.socket or ("127.0.0.1", args.local_port)
    ) as server:
        server.serve_forever()


if __name__ == "__main__":
    main()
