"""Small mTLS client with bounded responses, no redirects or environment proxies."""

import http.client
from urllib.parse import urlsplit

from backend.transport import tls

from .protocol import canonical, parse_object


class ServiceUnavailable(ValueError):
    pass


class Client:
    def __init__(
        self,
        url: str,
        ca: str,
        cert: str,
        key: str,
        *,
        require_pq: bool = False,
        timeout: float = 10,
    ):
        parsed = urlsplit(url)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.path not in {"", "/"}
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Use an HTTPS key-service origin.")
        self.host, self.port = parsed.hostname, parsed.port or 443
        self.require_pq = require_pq
        self.timeout = timeout
        self.tls = tls.client_context(ca, cert, key, required=require_pq)

    def call(self, operation: str, **data) -> dict:
        if not operation.isascii() or not operation.replace("-", "").isalpha():
            raise ValueError("Invalid operation.")
        conn = http.client.HTTPSConnection(
            self.host, self.port, context=self.tls, timeout=self.timeout
        )
        try:
            conn.connect()
            tls.verify(conn.sock, required=self.require_pq)
            conn.request(
                "POST",
                "/v1/" + operation,
                body=canonical(data),
                headers={"Content-Type": "application/json"},
            )
            response = conn.getresponse()
            body = response.read(1024 * 1024 + 1)
            if response.status != 200 or len(body) > 1024 * 1024:
                raise ServiceUnavailable("Key service refused the operation or is unavailable.")
            value = parse_object(body)
            if not isinstance(value, dict):
                raise ServiceUnavailable("Invalid key-service response.")
            return value
        except (OSError, http.client.HTTPException, ValueError) as exc:
            raise ServiceUnavailable(
                "Key service operation failed; no fallback is permitted."
            ) from exc
        finally:
            conn.close()
