import pytest
from django.test import Client

from backend.apps.core import storage
from backend.apps.core.models import DeliveryJob
from backend.tests.test_flows import compose

pytestmark = pytest.mark.django_db


def test_settings_scope_and_secret_redaction(staff_client, admin_client, settings):
    compose(staff_client)
    compose(admin_client, sender="admin@onesmarter.com")
    settings.EMAIL_HOST_PASSWORD = "do-not-return-secret"
    settings.EMAIL_HOST_USER = "private-smtp-login"
    response = staff_client.get("/api/settings")
    assert response.status_code == 200
    data = response.json()
    assert data["delivery_counts"]["queued"] == 1
    assert data["can_manage_senders"] is False
    assert data["sender_addresses"] == ["staff@onesmarter.com"]
    assert b"do-not-return-secret" not in response.content
    assert b"private-smtp-login" not in response.content
    assert admin_client.get("/api/settings").json()["can_manage_senders"] is True


def test_checks_fail_closed_without_sending_email(staff_client, monkeypatch):
    def unavailable():
        raise OSError("private internal scanner address")

    monkeypatch.setattr(storage, "scanner_health", unavailable)
    response = staff_client.post("/api/settings/checks")
    assert response.status_code == 200
    assert response.json()["scanner"]["status"] == "unavailable"
    assert b"private internal scanner address" not in response.content
    assert not DeliveryJob.objects.exists()


def test_checks_report_actual_probe_and_require_login(staff_client, monkeypatch):
    monkeypatch.setattr(
        storage, "scanner_health", lambda: {"engine": "ClamAV test", "signature_age_seconds": 30}
    )
    assert Client().post("/api/settings/checks").status_code == 401
    assert Client().get("/api/settings").status_code == 401
    response = staff_client.post("/api/settings/checks")
    assert response.json()["scanner"]["status"] == "healthy"
    assert response.json()["scanner"]["signature_age_seconds"] == 30
