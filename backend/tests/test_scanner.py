import os
from datetime import datetime, timedelta, timezone

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile

from backend.apps.core import storage
from backend.apps.core.http import Problem
from backend.apps.core.models import Attachment
from backend.tests.test_readiness import ScannerSocket


def version_response(age_hours):
    stamp = datetime.now(timezone.utc) - timedelta(hours=age_hours)
    return f"ClamAV 1.4.3/28167/{stamp:%a %b %d %H:%M:%S %Y}\0".encode()


@pytest.mark.parametrize("age,accepted", [(1, True), (49, False), (-1, False)])
def test_loaded_signatures_freshness(settings, monkeypatch, age, accepted):
    settings.SCAN_PROVIDER = "clamav"
    sock = ScannerSocket(version_response(age))
    monkeypatch.setattr(storage, "scanner_connection", lambda: sock)
    if accepted:
        assert storage.scanner_health()["database_version"] == 28167
    else:
        with pytest.raises(ValueError):
            storage.scanner_health()
    assert sock.sent == b"zVERSION\0"


@pytest.mark.parametrize(
    "response", [b"ClamAV 1.4.3\0", b"PONG\0", b"ClamAV 1.4.3/x/date\0", b"bad", b"bad\0extra\0"]
)
def test_bad_health_response_rejected(settings, monkeypatch, response):
    settings.SCAN_PROVIDER = "clamav"
    monkeypatch.setattr(storage, "scanner_connection", lambda: ScannerSocket(response))
    with pytest.raises(ValueError):
        storage.scanner_health()


@pytest.mark.django_db
def test_stale_scanner_never_receives_or_stores_upload(staff_client, settings, monkeypatch):
    settings.SCAN_PROVIDER = "clamav"
    sock = ScannerSocket(version_response(72))
    monkeypatch.setattr(storage, "scanner_connection", lambda: sock)
    response = staff_client.post(
        "/api/attachments", {"file": SimpleUploadedFile("sample.txt", b"sample")}
    )
    assert response.status_code == 503
    assert sock.sent == b"zVERSION\0"
    assert not Attachment.objects.exists()
    assert not (settings.RUNTIME_DIR / "objects").exists()


def test_scan_deadline(settings, monkeypatch):
    settings.SCAN_PROVIDER = "clamav"
    monkeypatch.setattr(storage, "scanner_health", lambda: {})
    monkeypatch.setattr(storage, "scanner_connection", lambda: ScannerSocket(b"stream: OK\0"))
    ticks = iter([0, 21])
    monkeypatch.setattr(storage.time, "monotonic", lambda: next(ticks))
    with pytest.raises(Problem):
        storage.scan(b"sample")


def test_unencrypted_tcp_forbidden_outside_synthetic(settings):
    settings.SYNTHETIC_MODE = False
    settings.CLAMAV_TRANSPORT = "tcp"
    with pytest.raises(ValueError):
        storage.scanner_connection()


@pytest.mark.skipif(os.environ.get("RUN_CLAMAV_INTEGRATION") != "1", reason="Requires real ClamAV")
@pytest.mark.django_db
def test_real_scanner_upload_boundary(staff_client, settings):
    settings.SCAN_PROVIDER = "clamav"
    clean = staff_client.post(
        "/api/attachments", {"file": SimpleUploadedFile("clean.txt", b"Harmless synthetic text")}
    )
    assert clean.status_code == 201
    count = Attachment.objects.count()
    sample = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
    rejected = staff_client.post(
        "/api/attachments", {"file": SimpleUploadedFile("eicar.txt", sample)}
    )
    assert rejected.status_code == 400
    assert Attachment.objects.count() == count
    settings.CLAMAV_TRANSPORT = "tcp"
    settings.CLAMAV_HOST = "127.0.0.1"
    settings.CLAMAV_PORT = 1
    unavailable = staff_client.post(
        "/api/attachments", {"file": SimpleUploadedFile("clean.txt", b"Harmless text")}
    )
    assert unavailable.status_code == 503
    assert Attachment.objects.count() == count


@pytest.mark.skipif(os.environ.get("RUN_CLAMAV_INTEGRATION") != "1", reason="Requires real ClamAV")
def test_real_scanner_stream_limit(settings):
    settings.SCAN_PROVIDER = "clamav"
    # Deliberately exceed clamd's 26 MiB stream cap, bypassing the application's
    # smaller 25 MiB cap only inside this test.
    settings.MAX_UPLOAD_BYTES = 28 * 1024 * 1024
    with pytest.raises(Problem):
        storage.scan(b"a" * (27 * 1024 * 1024))
