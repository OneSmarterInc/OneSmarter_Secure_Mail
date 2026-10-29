"""Live, fail-closed admission control for document submissions and delivery."""

from django.conf import settings

from backend.keyservice.client import Client
from backend.keyservice.protocol import SUITE


class ServiceDisabled(Exception):
    """Internal signal to defer an outbox job before contacting the mail provider."""


def read_status() -> dict:
    return Client(
        settings.KEY_STATUS_URL,
        settings.KEY_STATUS_CA,
        settings.KEY_STATUS_CERT,
        settings.KEY_STATUS_KEY,
        require_pq=settings.KEY_STATUS_REQUIRE_PQ,
        timeout=3,
    ).call("status")


def ready() -> bool:
    try:
        status = read_status()
        return (
            isinstance(status, dict)
            and status.get("sealed") is False
            and status.get("suite") == SUITE
            and status.get("audit_integrity") != "failed"
        )
    except (OSError, ValueError, TypeError, KeyError):
        return False


def require_ready() -> None:
    from .http import Problem

    if not ready():
        raise Problem("Service is disabled.", "service_disabled", 503)
