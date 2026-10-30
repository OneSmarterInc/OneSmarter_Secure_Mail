"""Bounded single-process HTTPS/mTLS service and independent custodian portal.

TLS negotiation and deployment review remain production gates. No HTTP mode.
Certificate allowlists are reread per request so revocation needs no restart.
"""

import hashlib
import logging
import secrets
import ssl
import threading
import time
import uuid
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn
from urllib.parse import urlsplit

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from cryptography.exceptions import InvalidTag

from backend.transport import tls as transport_tls

from . import protocol as p
from .ownership import StoreOwnership
from .store import ConflictError, KeyStore, SealedError

logger = logging.getLogger(__name__)

MAX_BODY = 131072
ROOT_OPERATIONS = {"unseal", "seal", "custody-status", "rotate-root"}
FIELDS = {
    "versions": {"organization"},
    "rotate": {"organization", "expected", "request_id"},
    "import": {"organization", "key_id", "private"},
    "wrap": {"organization", "context", "dek", "expected"},
    "unwrap": {"organization", "context", "wrapper"},
    "unwrap-batch": {"organization", "items"},
    "rewrap": {"organization", "context", "wrapper", "expected"},
    "unseal": {"secret"},
    "seal": set(),
    "custody-status": set(),
    "rotate-root": {"secret", "expected"},
    "status": set(),
}


def strict_json(raw: bytes) -> dict:
    return p.parse_object(raw)


class Service:
    def __init__(self, store: KeyStore, policy: Path, origin: str, *, allow_http_loopback=False):
        parsed = urlsplit(origin)
        self.local_http = (
            allow_http_loopback
            and parsed.scheme == "http"
            and parsed.hostname in {"localhost", "127.0.0.1"}
            and not parsed.username
            and not parsed.password
            and not parsed.path
            and not parsed.query
            and not parsed.fragment
        )
        secure_origin = (
            parsed.scheme == "https"
            and parsed.hostname
            and parsed.username is None
            and parsed.password is None
            and not parsed.path
            and not parsed.query
            and not parsed.fragment
        )
        if not secure_origin and not self.local_http:
            raise ValueError("Configure the exact HTTPS portal origin without a trailing slash.")
        self.store, self.policy, self.origin = store, policy, origin
        self.lock = threading.RLock()
        self.sessions: dict[str, dict] = {}
        self.rates: dict[str, tuple[float, int]] = {}
        self.denial_window = 0.0
        self.denial_count = 0
        self.denials: dict[tuple[str, str], int] = {}

    def flush_denials(self, *, force=False):
        with self.lock:
            now = time.monotonic()
            if not self.denials or (not force and now - self.denial_window < 60):
                return
            # Keep counters until their durable write succeeds.
            for (actor, event), count in list(self.denials.items()):
                try:
                    self.store.record_event(actor, f"denial_batch:{event}:count={count}")
                except Exception:
                    logger.error("key_service_denial_audit_unavailable")
                    return
                del self.denials[(actor, event)]
            self.denial_count = 0
            self.denial_window = now

    def identity(self, fingerprint: str) -> dict:
        policy = strict_json(self.policy.read_bytes())
        identity = policy.get("identities", {}).get(fingerprint)
        if not isinstance(identity, dict) or identity.get("expires_at", 0) <= time.time():
            raise PermissionError("Identity unavailable.")
        if not isinstance(identity.get("name"), str):
            raise PermissionError("Identity unavailable.")
        return identity

    def throttle(self, key: str, limit: int):
        with self.lock:
            now = time.monotonic()
            # Bound memory even with repeated attempts; peers require an accepted certificate.
            self.rates = {k: v for k, v in self.rates.items() if now - v[0] < 60}
            start, count = self.rates.get(key, (now, 0))
            if count >= limit:
                raise PermissionError("Rate limit exceeded.")
            self.rates[key] = (start, count + 1)

    def login(self, fp: str, identity: dict, body: dict) -> dict:
        self.throttle("login:" + fp, 5)
        if set(body) != {"username", "password"} or identity.get("role") != "custodian":
            raise PermissionError("Login failed.")
        if not isinstance(body["password"], str) or len(body["password"]) > 256:
            raise PermissionError("Login failed.")
        try:
            if body["username"] != identity["name"]:
                raise PermissionError("Login failed.")
            PasswordHasher().verify(identity["password_hash"], body["password"])
        except (VerificationError, KeyError) as exc:
            raise PermissionError("Login failed.") from exc
        with self.lock:
            self.sessions = {
                k: v
                for k, v in self.sessions.items()
                if v["expires"] > time.time() and v["fp"] != fp
            }
            token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
            self.sessions[token] = {
                "fp": fp,
                "csrf": csrf,
                "expires": time.time() + 300,
                "policy_digest": hashlib.sha256(p.canonical(identity)).hexdigest(),
            }
        return {"token": token, "csrf": csrf}

    def authenticate_session(self, fp: str, identity: dict, cookie: str, csrf: str):
        cookies = SimpleCookie()
        cookies.load(cookie)
        token = cookies.get("osm_custodian")
        with self.lock:
            session = self.sessions.get(token.value if token else "")
            if (
                identity.get("role") != "custodian"
                or not session
                or session["fp"] != fp
                or session["expires"] <= time.time()
                or session["policy_digest"] != hashlib.sha256(p.canonical(identity)).hexdigest()
                or not secrets.compare_digest(session["csrf"], csrf)
            ):
                raise PermissionError("Sign in again.")

    def dispatch(self, op: str, data: dict, identity: dict) -> dict:
        optional = {"active", "after"} if op == "versions" else set()
        if op not in FIELDS or not FIELDS[op] <= set(data) or set(data) - FIELDS[op] - optional:
            raise ValueError("Unsupported operation or fields.")
        permission = "unwrap" if op == "unwrap-batch" else op
        if permission not in identity.get("operations", []):
            raise PermissionError("Operation denied.")
        if op in ROOT_OPERATIONS and identity.get("role") != "custodian":
            raise PermissionError("Custodian required.")
        if op in {"rotate", "import"} and identity.get("role") != "maintenance":
            raise PermissionError("Maintenance identity required.")
        org = data.get("organization")
        if org is not None:
            if not isinstance(org, str) or str(uuid.UUID(org)) != org:
                raise ValueError("Invalid organization.")
            if org not in identity.get("organizations", []):
                raise PermissionError("Organization denied.")
        actor = identity["name"]
        if op == "status":
            return self.store.status()
        if op == "custody-status":
            return self.store.custody_status()
        if op == "unseal":
            self.store.unseal(p.decode(data["secret"], 32), actor)
            return self.store.status()
        if op == "seal":
            self.store.seal(actor)
            return self.store.status()
        if op == "rotate-root":
            return self.store.rotate_root(p.decode(data["secret"], 32), data["expected"], actor)
        if op == "versions":
            versions = self.store.list_versions(
                org, active=data.get("active", False), after=data.get("after", "")
            )
            return {
                "versions": versions,
                "next_cursor": versions[-1]["id"] if len(versions) == 100 else None,
            }
        if op == "rotate":
            return self.store.rotate(org, data["expected"], data["request_id"], actor)
        if op == "import":
            return self.store.import_version(
                org, data["key_id"], p.decode(data["private"], 96), actor
            )
        if op == "wrap":
            return self.store.wrap(
                org, data["context"], p.decode(data["dek"], 32), data["expected"], actor
            )
        if op == "unwrap-batch":
            return {
                "deks": [
                    p.encode(value) for value in self.store.unwrap_batch(org, data["items"], actor)
                ]
            }
        if op == "unwrap":
            return {
                "dek": p.encode(self.store.unwrap(org, data["context"], data["wrapper"], actor))
            }
        return self.store.rewrap(org, data["context"], data["wrapper"], data["expected"], actor)


class Handler(BaseHTTPRequestHandler):
    server_version = "OneSmarterKeyService"
    sys_version = ""

    def log_message(self, *args):
        # No access log containing URLs, cookies, request bodies, or secrets.
        pass

    def response(self, status: int, value, *, content_type="application/json", cookie=None):
        payload = p.canonical(value) if content_type == "application/json" else value
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        )
        self.send_header("Strict-Transport-Security", "max-age=31536000")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(payload)

    def peer(self):
        cert = self.connection.getpeercert(binary_form=True)
        if not cert:
            raise PermissionError("Client certificate required.")
        fp = hashlib.sha256(cert).hexdigest()
        self.peer_fingerprint = fp
        service = self.server.service
        # Revoked/unlisted identities must never consume authorized workloads' budget.
        identity = service.identity(fp)
        # Bulk search/list traffic has its own budget and cannot exhaust unwrap,
        # login or custodial operations through the shared workload certificate.
        if self.path == "/v1/unwrap-batch":
            service.throttle("bulk:" + fp, 120)
        else:
            service.throttle("all-peers", 3000)
            service.throttle("peer:" + fp, 600)
        return fp, identity

    def do_GET(self):
        try:
            _, identity = self.peer()
            if identity.get("role") != "custodian":
                raise PermissionError("Custodian access required.")
            files = {
                "/": ("portal.html", "text/html; charset=utf-8"),
                "/portal.js": ("portal.js", "text/javascript; charset=utf-8"),
                "/portal.css": ("portal.css", "text/css; charset=utf-8"),
            }
            if self.path not in files:
                self.response(404, {"error": "not_found"})
                return
            name, mime = files[self.path]
            self.response(200, (Path(__file__).parent / name).read_bytes(), content_type=mime)
        except (PermissionError, ValueError, OSError):
            self.response(403, {"error": "access_denied"})

    def do_POST(self):
        service = self.server.service
        op, identity = "invalid", None
        try:
            fp, identity = self.peer()
            if (
                self.headers.get("Transfer-Encoding")
                or len(self.headers.get_all("Content-Length", [])) != 1
            ):
                raise ValueError("Invalid framing.")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY or self.headers.get("Content-Type") != "application/json":
                raise ValueError("Invalid request.")
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError("Incomplete request.")
            data = strict_json(raw)
            if self.path == "/login":
                op = "login"
                if self.headers.get("Origin") != service.origin:
                    raise PermissionError("Origin denied.")
                login = service.login(fp, identity, data)
                service.store.record_event(identity["name"], "login_success")
                self.response(
                    200,
                    {"csrf": login["csrf"]},
                    cookie=f"osm_custodian={login['token']}; Path=/; {'Secure; ' if not service.local_http else ''}HttpOnly; SameSite=Strict; Max-Age=300",
                )
                return
            if not self.path.startswith("/v1/"):
                raise ValueError("Unknown route.")
            op = self.path[4:]
            if op in ROOT_OPERATIONS or op == "logout":
                if self.headers.get("Origin") != service.origin:
                    raise PermissionError("Origin denied.")
                service.authenticate_session(
                    fp,
                    identity,
                    self.headers.get("Cookie", ""),
                    self.headers.get("X-CSRFToken", ""),
                )
            if op == "logout":
                if data:
                    raise ValueError("Unexpected fields.")
                with service.lock:
                    service.sessions = {k: v for k, v in service.sessions.items() if v["fp"] != fp}
                self.response(
                    200,
                    {"logged_out": True},
                    cookie=f"osm_custodian=; Path=/; {'Secure; ' if not service.local_http else ''}HttpOnly; SameSite=Strict; Max-Age=0",
                )
                return
            if op in {"unseal", "rotate-root"}:
                service.throttle("custody:" + fp, 5)
            result = service.dispatch(op, data, identity)
            self.response(200, result)
        except SealedError:
            self.response(503, {"error": "sealed"})
        except ConflictError:
            self.response(409, {"error": "conflict"})
        except PermissionError:
            self.audit_failure(identity, "access_denied")
            self.response(403, {"error": "access_denied"})
        except (ValueError, TypeError, KeyError, InvalidTag):
            self.audit_failure(identity, "invalid_request_or_material")
            self.response(400, {"error": "invalid_request_or_material"})
        except Exception as exc:
            # No exception text/traceback, request body, certificate or key material.
            incident = str(uuid.uuid4())
            logger.error(
                "key_service_unexpected incident=%s exception_type=%s", incident, type(exc).__name__
            )
            self.response(503, {"error": "service_unavailable", "incident_id": incident})

    def audit_failure(self, identity, event):
        service = self.server.service
        actor = (
            identity["name"]
            if identity
            else "certificate:" + getattr(self, "peer_fingerprint", "unknown")
        )
        with service.lock:
            key = (actor, event)
            if key not in service.denials and len(service.denials) >= 128:
                key = ("overflow-unlisted-identities", "access_denied")
            service.denials[key] = service.denials.get(key, 0) + 1
            service.denial_count += 1
        service.flush_denials()


class Server(ThreadingMixIn, HTTPServer):
    daemon_threads = False
    request_queue_size = 32

    def __init__(self, address, service: Service, tls: ssl.SSLContext, *, require_pq=False):
        self.service, self.tls = service, tls
        self.require_pq = require_pq
        transport_tls.configure(tls, required=require_pq)
        self.slots = threading.BoundedSemaphore(16)
        self.ownership = StoreOwnership(service.store.path)
        try:
            super().__init__(address, Handler)
        except BaseException:
            self.ownership.close()
            raise

    def service_actions(self):
        self.service.flush_denials()

    def server_close(self):
        try:
            # Wait for request threads before allowing another service owner.
            super().server_close()
            self.service.flush_denials(force=True)
        finally:
            self.ownership.close()

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        super().process_request(request, client_address)

    def process_request_thread(self, request, client_address):
        try:
            request.settimeout(10)
            request = self.tls.wrap_socket(request, server_side=True)
            transport_tls.verify(request, required=self.require_pq)
            super().process_request_thread(request, client_address)
        except (OSError, ssl.SSLError):
            request.close()
        finally:
            self.slots.release()


def tls_context(cert: str, key: str, ca: str) -> ssl.SSLContext:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    context.load_cert_chain(cert, key)
    context.load_verify_locations(ca)
    context.verify_mode = ssl.CERT_REQUIRED
    return context
