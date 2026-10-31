import base64
import json
import secrets
import time

import pytest
from django.test import Client

from backend.apps.core import crypto, document_service
from backend.apps.core.models import Organization, StaffUser
from backend.keyservice.protocol import SUITE


@pytest.fixture(autouse=True)
def isolated_storage(settings, tmp_path, monkeypatch):
    # Unit flows use a ready service fixture; admission tests override this response.
    monkeypatch.setattr(document_service, "read_status", lambda: {"sealed": False, "suite": SUITE})
    settings.TRUSTED_PROXY_IPS = set()
    settings.TRUSTED_PROXY_UNIX_SOCKET = False
    settings.RUNTIME_DIR = tmp_path
    settings.EVIDENCE_DIRECTORY = tmp_path / "evidence"
    settings.EVIDENCE_TSA_URL = ""
    settings.EVIDENCE_TSA_CA_FILE = ""
    settings.LOCAL_KEY_FILE = tmp_path / "key"
    settings.LOCAL_KEY_FILE.write_text(base64.b64encode(secrets.token_bytes(32)).decode())
    settings.MAIL_PROVIDER = "development"
    settings.SMTP_SENDER_PROFILES_FILE = ""
    settings.SCAN_PROVIDER = "synthetic"
    settings.ENABLE_DEV_TOOLS = True
    settings.ENABLE_LEGACY_RECIPIENT_API = True
    crypto._local_key.cache_clear()
    yield
    crypto._local_key.cache_clear()


@pytest.fixture
def org(db):
    return Organization.objects.create(name="OneSmarter", domain="onesmarter.com")


@pytest.fixture
def admin(org):
    return StaffUser.objects.create_user(
        username="admin@onesmarter.com",
        email="admin@onesmarter.com",
        password="A-strong-test-only-password!",
        organization=org,
        display_name="Administrator",
        role="admin",
        status="active",
        mfa_confirmed=True,
        can_manage_privileges=True,
        can_export_audit=True,
        sender_addresses=["admin@onesmarter.com"],
    )


@pytest.fixture
def staff(org):
    return StaffUser.objects.create_user(
        username="staff@onesmarter.com",
        email="staff@onesmarter.com",
        password="A-strong-test-only-password!",
        organization=org,
        display_name="Staff",
        role="staff",
        status="active",
        mfa_confirmed=True,
        sender_addresses=["staff@onesmarter.com"],
    )


def authenticated(user):
    client = Client()
    client.force_login(user)
    session = client.session
    session["staff_version"] = user.session_version
    session["mfa_at"] = time.time()
    session.save()
    return client


@pytest.fixture
def admin_client(admin):
    return authenticated(admin)


@pytest.fixture
def staff_client(staff):
    return authenticated(staff)


@pytest.fixture
def sender_profile(settings, tmp_path, monkeypatch, staff):
    settings.MAIL_PROVIDER = "smtp"
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    settings.DEFAULT_FROM_EMAIL = "secure@onesmarter.com"
    settings.SMTP_SENDER_PROFILES_FILE = str(tmp_path / "senders.json")
    monkeypatch.setenv("SMTP_PASSWORD_TEST", "synthetic-test-only")
    profiles = {
        address: {
            "host": "smtp.example.test",
            "port": 587,
            "username": address,
            "password_env": "SMTP_PASSWORD_TEST",
            "security": "starttls",
        }
        for address in ["secure@onesmarter.com", "staff@onesmarter.com"]
    }
    (tmp_path / "senders.json").write_text(json.dumps(profiles))
    from django.core.mail import get_connection

    from backend.apps.core import smtp_settings
    from backend.apps.core.models import OrganizationSMTP, StaffSMTP

    OrganizationSMTP.objects.create(
        organization=staff.organization,
        host="smtp.example.test",
        otp_transport_revision=1,
        otp_password_ciphertext=crypto.encrypt(
            b"synthetic-support-only",
            crypto.context(staff.organization_id, "otp-smtp", staff.organization_id),
        ),
    )
    StaffSMTP.objects.create(
        user=staff,
        organization=staff.organization,
        email=staff.email,
        transport_revision=1,
        password_ciphertext=crypto.encrypt(
            b"synthetic-test-only", smtp_settings.secret_context(staff)
        ),
    )
    monkeypatch.setattr(smtp_settings, "SMTPBackend", lambda **kw: get_connection(**kw))
    return profiles
