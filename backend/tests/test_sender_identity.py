import pytest
from django.core import mail

from backend.apps.core import senders
from backend.apps.core.mail import process_job
from backend.apps.core.models import DeliveryJob
from backend.tests.test_flows import compose


def test_sender_connection_selects_exact_credential(sender_profile, monkeypatch):
    calls = []
    monkeypatch.setattr(senders, "get_connection", lambda **kwargs: calls.append(kwargs))
    senders.connection("staff@onesmarter.com")
    assert calls[0]["username"] == "staff@onesmarter.com"
    assert calls[0]["use_tls"] is True
    assert calls[0]["use_ssl"] is False
    with pytest.raises(senders.SenderUnavailable):
        senders.connection("other@onesmarter.com")
    assert len(calls) == 1


@pytest.mark.parametrize(
    "sender", ["info@kormic.ai", "x@sub.onesmarter.com", "a@onesmarter.com\r\nBcc:x@y.com"]
)
def test_foreign_or_malformed_sender_denied(sender_profile, sender):
    with pytest.raises(senders.SenderUnavailable):
        senders.connection(sender)


def test_missing_credential_has_no_global_fallback(sender_profile, settings, monkeypatch):
    settings.EMAIL_HOST_USER = "global"
    settings.EMAIL_HOST_PASSWORD = "global-test-only"
    monkeypatch.delenv("SMTP_PASSWORD_TEST")
    assert not senders.configured("secure@onesmarter.com")


@pytest.mark.django_db
def test_foreign_notification_sender_never_reaches_transport(
    staff_client, sender_profile, settings, monkeypatch
):
    compose(staff_client)
    settings.DEFAULT_FROM_EMAIL = "info@kormic.ai"
    calls = []
    monkeypatch.setattr(senders, "get_connection", lambda **kw: calls.append(kw))
    job = DeliveryJob.objects.get()
    process_job(job.pk)
    job.refresh_from_db()
    assert job.state == "failed" and job.error_code == "sender_not_configured"
    assert not calls


@pytest.mark.django_db
def test_normal_sender_authority_rechecked(staff_client, staff, sender_profile):
    staff.can_nophi = True
    staff.save(update_fields=["can_nophi"])
    assert (
        compose(
            staff_client,
            mode="ordinary",
            body="Synthetic test",
            to=["colleague@onesmarter.com"],
            nophi_override=True,
            nophi_acknowledged=True,
        ).status_code
        == 201
    )
    staff.sender_addresses = []
    staff.save(update_fields=["sender_addresses"])
    job = DeliveryJob.objects.get()
    process_job(job.pk)
    job.refresh_from_db()
    assert job.error_code == "sender_not_configured"
    assert not mail.outbox


@pytest.mark.django_db
def test_normal_mail_uses_approved_sender(staff_client, staff, sender_profile):
    staff.can_nophi = True
    staff.save(update_fields=["can_nophi"])
    assert (
        compose(
            staff_client,
            mode="ordinary",
            body="Synthetic test",
            to=["colleague@onesmarter.com"],
            nophi_override=True,
            nophi_acknowledged=True,
        ).status_code
        == 201
    )
    job = DeliveryJob.objects.get()
    process_job(job.pk)
    job.refresh_from_db()
    assert job.state == "provider_accepted"
    assert mail.outbox[0].from_email == "staff@onesmarter.com"
