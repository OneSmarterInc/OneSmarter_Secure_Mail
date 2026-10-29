from unittest.mock import Mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from backend.apps.core import document_service, storage
from backend.apps.core.mail import process_job
from backend.apps.core.models import Attachment, Conversation, DeliveryJob, Message
from backend.keyservice.protocol import SUITE
from backend.tests.test_flows import compose, post, recipient_access

pytestmark = pytest.mark.django_db
READY = {"sealed": False, "suite": SUITE}


@pytest.mark.parametrize(
    "status",
    [
        None,
        {},
        {"sealed": True, "suite": SUITE},
        {"sealed": 0, "suite": SUITE},
        {"sealed": False, "suite": "unknown"},
        {**READY, "audit_integrity": "failed"},
    ],
)
def test_disabled_service_blocks_compose_without_writes(staff_client, monkeypatch, status):
    monkeypatch.setattr(document_service, "read_status", lambda: status)
    response = compose(staff_client)
    assert response.status_code == 503
    assert response.json()["error"] == {
        "code": "service_disabled",
        "message": "Service is disabled.",
    }
    assert not Conversation.objects.exists()
    assert not DeliveryJob.objects.exists()


def test_unreachable_service_fails_closed(staff_client, monkeypatch):
    monkeypatch.setattr(
        document_service, "read_status", Mock(side_effect=ValueError("unreachable"))
    )
    assert compose(staff_client).status_code == 503
    response = staff_client.get("/api/document-service")
    assert response.json() == {"ready": False, "message": "Service is disabled."}
    assert response["Cache-Control"] == "no-store"


def test_seal_during_compose_rolls_back(staff_client, monkeypatch):
    monkeypatch.setattr(
        document_service, "read_status", Mock(side_effect=[READY, {"sealed": True}])
    )
    assert compose(staff_client).status_code == 503
    assert not Conversation.objects.exists()
    assert not Message.objects.exists()
    assert not DeliveryJob.objects.exists()


def test_disabled_uploads_and_replies_for_staff_and_recipient(staff_client, monkeypatch):
    visitor, conversation, _, _ = recipient_access(staff_client)
    initial_messages = Message.objects.count()
    monkeypatch.setattr(document_service, "read_status", lambda: {"sealed": True})
    scan = Mock(side_effect=AssertionError("Do not process documents while sealed"))
    monkeypatch.setattr(storage, "scan", scan)
    for client, route in (
        (staff_client, "/api/attachments"),
        (visitor, "/api/recipient/attachments"),
    ):
        response = client.post(route, {"file": SimpleUploadedFile("test.txt", b"Synthetic")})
        assert response.status_code == 503
    assert (
        post(
            staff_client, f"/conversations/{conversation.pk}/messages", {"body": "test"}
        ).status_code
        == 503
    )
    assert post(visitor, "/recipient/conversation", {"body": "test"}).status_code == 503
    assert Message.objects.count() == initial_messages
    assert not Attachment.objects.exists()
    scan.assert_not_called()


def test_queued_delivery_waits_and_resumes(staff_client, monkeypatch):
    assert compose(staff_client).status_code == 201
    job = DeliveryJob.objects.get()
    monkeypatch.setattr(document_service, "read_status", lambda: {"sealed": True})
    process_job(job.pk)
    job.refresh_from_db()
    assert job.state == "queued" and job.attempts == 0
    assert job.error_code == "service_disabled"
    monkeypatch.setattr(document_service, "read_status", lambda: READY)
    DeliveryJob.objects.filter(pk=job.pk).update(next_attempt=timezone.now())
    process_job(job.pk)
    job.refresh_from_db()
    assert job.state == "development_delivered"


def test_sealing_before_smtp_defers_without_sending(staff_client, monkeypatch, settings):
    from backend.apps.core import mail

    assert compose(staff_client).status_code == 201
    job = DeliveryJob.objects.get()
    monkeypatch.setattr(
        document_service, "read_status", Mock(side_effect=[READY, READY, {"sealed": True}])
    )
    transport = Mock()
    monkeypatch.setattr(mail, "EmailMultiAlternatives", transport)
    settings.MAIL_PROVIDER = "smtp"
    settings.EMAIL_HOST_USER = "synthetic@example.test"
    settings.EMAIL_HOST_PASSWORD = "synthetic-test-only"
    process_job(job.pk)
    transport.return_value.send.assert_not_called()
    job.refresh_from_db()
    assert job.state == "retry" and job.error_code == "service_disabled"
