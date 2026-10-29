import base64
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
    settings.RUNTIME_DIR = tmp_path
    settings.LOCAL_KEY_FILE = tmp_path / "key"
    settings.LOCAL_KEY_FILE.write_text(base64.b64encode(secrets.token_bytes(32)).decode())
    settings.MAIL_PROVIDER = "development"
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
