"""Bounded UDP receipt service. No forwarding, downloads, or client telemetry."""

import asyncio
from collections import deque
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import secrets
import ssl
import struct
import time

MAGIC = b"PP01"
HEADER = 32
PACKET_SIZE = 1000
MAX_PACKETS = 2200
SESSION_SECONDS = 12
DAILY_SESSIONS = 256


@dataclass
class Session:
    token: bytes
    expires: float
    peer: tuple | None = None
    seen: set = field(default_factory=set)
    recent: deque = field(default_factory=deque)


class Budget:
    def __init__(self, clock=time.monotonic, day=lambda: int(time.time() // 86400), state=None):
        self.clock = clock
        self.day = day
        self.current_day = day()
        self.issued_today = 0
        self.recent = deque()
        self.session = None
        self.state = Path(state) if state else None
        if self.state and self.state.exists():
            saved = json.loads(self.state.read_text())
            if saved["day"] == self.current_day:
                self.issued_today = int(saved["count"])

    def issue(self):
        now = self.clock()
        if self.session and self.session.expires > now:
            return None
        while self.recent and self.recent[0] <= now - 60:
            self.recent.popleft()
        if self.day() != self.current_day:
            self.current_day = self.day()
            self.issued_today = 0
        if len(self.recent) >= 12 or self.issued_today >= DAILY_SESSIONS:
            return None
        self.issued_today += 1
        if self.state:
            temporary = self.state.with_suffix(".tmp")
            with temporary.open("w") as output:
                json.dump({"day": self.current_day, "count": self.issued_today}, output)
                output.flush()
                os.fsync(output.fileno())
            temporary.replace(self.state)
        self.recent.append(now)
        self.session = Session(secrets.token_bytes(24), now + SESSION_SECONDS)
        return self.session

    def receipt(self, data, peer):
        session = self.session
        now = self.clock()
        if not session or session.expires <= now or len(data) != PACKET_SIZE:
            return None
        if data[:4] != MAGIC or not secrets.compare_digest(data[4:28], session.token):
            return None
        seq = struct.unpack("!I", data[28:32])[0]
        if seq >= MAX_PACKETS or seq in session.seen:
            return None
        if session.peer is not None and session.peer != peer:
            return None
        while session.recent and session.recent[0] <= now - 1:
            session.recent.popleft()
        if len(session.recent) >= 1000:
            return None
        session.peer = peer
        session.recent.append(now)
        session.seen.add(seq)
        # A 1000-byte request gets at most one 32-byte response to its sender.
        return data[:HEADER]

    def finish(self, token):
        if self.session and secrets.compare_digest(self.session.token.hex(), token):
            self.session = None


class Receipts(asyncio.DatagramProtocol):
    def __init__(self, budget):
        self.budget = budget
        self.transport = None

    def connection_made(self, transport):
        self.transport = transport

    def datagram_received(self, data, addr):
        response = self.budget.receipt(data, addr)
        if response is not None:
            self.transport.sendto(response, addr)


async def serve(cert, key, host="0.0.0.0", https_port=18443, udp_port=18444, state=None):
    budget = Budget(state=state)
    clients = 0

    async def request(reader, writer):
        nonlocal clients
        clients += 1
        try:
            if clients > 8:
                return
            raw = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 3)
            if len(raw) > 2048:
                return
            first = raw.split(b"\r\n", 1)[0].decode("ascii")
            status, result = "404 Not Found", {"error": "not-found"}
            if first == "POST /session HTTP/1.1":
                try:
                    session = budget.issue()
                except OSError:
                    session = None
                status = "200 OK" if session else "429 Too Many Requests"
                result = {"token": session.token.hex()} if session else {"error": "busy"}
            elif first.startswith("POST /finish/") and first.endswith(" HTTP/1.1"):
                token = first.split(" ")[1].removeprefix("/finish/")
                if len(token) == 48 and all(c in "0123456789abcdef" for c in token):
                    budget.finish(token)
                    status, result = "200 OK", {"ok": True}
            elif first == "GET /health HTTP/1.1":
                status, result = "200 OK", {"protocol": 1}
            body = json.dumps(result, separators=(",", ":")).encode()
            writer.write((f"HTTP/1.1 {status}\r\nContent-Type: application/json\r\n"
                          f"Content-Length: {len(body)}\r\nConnection: close\r\n"
                          "Cache-Control: no-store\r\n\r\n").encode() + body)
            await asyncio.wait_for(writer.drain(), 2)
        except (ValueError, UnicodeError, asyncio.IncompleteReadError,
                asyncio.LimitOverrunError, TimeoutError, ConnectionError):
            pass
        finally:
            clients -= 1
            writer.close()

    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.minimum_version = ssl.TLSVersion.TLSv1_2
    tls.load_cert_chain(cert, key)
    loop = asyncio.get_running_loop()
    transport, _ = await loop.create_datagram_endpoint(lambda: Receipts(budget), local_addr=(host, udp_port))
    server = await asyncio.start_server(request, host, https_port, ssl=tls,
                                        ssl_handshake_timeout=3, limit=2048, backlog=8)
    print("PewPew route probe ready; bounded receipts only", flush=True)
    try:
        async with server:
            await server.serve_forever()
    finally:
        transport.close()


if __name__ == "__main__":
    credential_dir = Path(os.environ.get("CREDENTIALS_DIRECTORY", "/etc/pewpew-probe"))
    asyncio.run(serve("/etc/pewpew-probe/server.crt", credential_dir / "tls.key",
                      state="/var/lib/pewpew-probe/budget.json"))
