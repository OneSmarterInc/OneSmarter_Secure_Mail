import json

import pytest
from django.test import Client

from backend.apps.core.mail import payload
from backend.apps.core.models import Conversation, DeliveryJob, StaffUser
from backend.tests.test_flows import compose

pytestmark = pytest.mark.django_db


def send(client, path, body):
    return client.post(path, json.dumps(body), content_type="application/json")


def test_staff_and_recipient_sessions_are_independent(staff_client, settings):
    settings.RECIPIENT_PUBLIC_URL = "https://secure.example.test/recipient"
    created = compose(staff_client, to=["sara@gmail.com"])
    conversation = Conversation.objects.get(pk=created.json()["id"])
    job = DeliveryJob.objects.get(conversation=conversation)
    link = payload(job)["link"]
    assert link.startswith(settings.RECIPIENT_PUBLIC_URL + "/#/invite/")
    token = link.rsplit("/", 1)[-1]
    staff_cookie = staff_client.cookies["sessionid"].value
    assert staff_client.get("/recipient-api/auth/session").json()["user"] is None
    assert staff_client.get("/recipient-api/admin/accounts").status_code == 404
    assert send(staff_client, "/recipient-api/recipient/code", {"token": token}).status_code == 200
    code_job = DeliveryJob.objects.filter(conversation=conversation).exclude(pk=job.pk).get()
    code = payload(code_job)["body"].split(" is ")[1][:6]
    assert (
        send(
            staff_client, "/recipient-api/recipient/verify", {"token": token, "code": code}
        ).status_code
        == 200
    )
    assert staff_client.cookies["sessionid"].value == staff_cookie
    assert staff_client.cookies["recipient_sessionid"]["path"] == "/recipient-api/"
    assert staff_client.get("/api/auth/session").json()["user"] is not None
    assert staff_client.get("/recipient-api/recipient/conversation").status_code == 200
    assert send(staff_client, "/recipient-api/recipient/logout", {}).status_code == 200
    assert staff_client.get("/api/auth/session").json()["user"] is not None
    assert staff_client.get("/recipient-api/recipient/conversation").status_code == 401


def test_recipient_cookie_cannot_authenticate_staff_api(staff_client):
    client = Client()
    client.cookies["recipient_sessionid"] = staff_client.cookies["sessionid"].value
    assert client.get("/api/conversations").status_code == 401
    assert client.get("/api/admin/accounts").status_code == 401


@pytest.mark.parametrize(
    "email", ["external@gmail.com", "spoof@onesmarter.com.evil.test", "staff@sub.onesmarter.com"]
)
def test_account_creation_requires_exact_company_domain(admin_client, email):
    response = send(admin_client, "/api/admin/accounts", {"name": "Test", "email": email})
    assert response.status_code == 400
    assert not StaffUser.objects.filter(email=email).exists()


def test_mailbox_requires_explicit_operator_opt_in(settings):
    settings.ENABLE_DEV_TOOLS = False
    assert Client().get("/api/dev/inbox").status_code == 404


def test_legacy_recipient_api_disabled_by_default(settings):
    settings.ENABLE_LEGACY_RECIPIENT_API = False
    assert Client().post("/api/recipient/code", {}).status_code == 404
    assert Client().get("/recipient-api/auth/session").status_code == 200
