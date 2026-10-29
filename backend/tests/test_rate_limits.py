from datetime import timedelta

import pytest
from django.test import RequestFactory
from django.utils import timezone

from backend.apps.core.client_ip import client_ip
from backend.apps.core.http import Problem
from backend.apps.core.models import RateBucket
from backend.apps.core.services import rate_limit


def request(peer="127.0.0.1", forwarded="198.51.100.1"):
    return RequestFactory().get("/", REMOTE_ADDR=peer, HTTP_X_REAL_IP=forwarded)


@pytest.mark.parametrize("peer", ["203.0.113.1", "127.0.0.1"])
def test_untrusted_forwarding_is_ignored(settings, peer):
    settings.TRUSTED_PROXY_IPS = set()
    assert client_ip(request(peer)) == peer


def test_trusted_proxy_and_unix_boundary(settings):
    settings.TRUSTED_PROXY_IPS = {"127.0.0.1"}
    assert client_ip(request()) == "198.51.100.1"
    settings.TRUSTED_PROXY_UNIX_SOCKET = True
    assert client_ip(request("")) == "198.51.100.1"
    # Socket opt-in does not authorize any TCP peer.
    assert client_ip(request("203.0.113.1")) == "203.0.113.1"
    assert client_ip(request(forwarded="::ffff:198.51.100.1")) == "198.51.100.1"


@pytest.mark.parametrize("value", ["", "unknown", "1.2.3.4, 5.6.7.8", "1.2.3.4:80", "fe80::1%eth0"])
def test_malformed_trusted_header_rejected(settings, value):
    settings.TRUSTED_PROXY_IPS = {"127.0.0.1"}
    with pytest.raises(Problem) as error:
        client_ip(request(forwarded=value))
    assert error.value.status_code == 400


@pytest.mark.django_db
def test_bucket_refill_cap_and_clock_rollback(monkeypatch):
    now = timezone.now()
    monkeypatch.setattr("backend.apps.core.services.timezone.now", lambda: now)
    req = request()
    for _ in range(10):
        rate_limit(req, "login", "a@example.test")
    for advance in [0, 29]:
        now += timedelta(seconds=advance)
        with pytest.raises(Problem) as error:
            rate_limit(req, "login", "a@example.test")
        assert error.value.status_code == 429
    now += timedelta(seconds=1)
    rate_limit(req, "login", "a@example.test")
    now -= timedelta(seconds=60)
    with pytest.raises(Problem):
        rate_limit(req, "login", "a@example.test")
    now += timedelta(days=1)
    for _ in range(10):
        rate_limit(req, "login", "a@example.test")
    with pytest.raises(Problem):
        rate_limit(req, "login", "a@example.test")
    assert RateBucket.objects.count() == 2


@pytest.mark.django_db
def test_identity_and_proxy_ip_isolation(settings):
    settings.TRUSTED_PROXY_IPS = {"127.0.0.1"}
    a, b = request(), request(forwarded="198.51.100.2")
    rate_limit(a, "login", "alice@example.test", maximum=1)
    rate_limit(a, "login", "bob@example.test", maximum=1)
    # Changing source does not bypass the account-wide limit.
    with pytest.raises(Problem):
        rate_limit(b, "login", "ALICE@example.test", maximum=1)
    rate_limit(a, "landing", maximum=1)
    with pytest.raises(Problem):
        rate_limit(a, "landing", maximum=1)
    rate_limit(b, "landing", maximum=1)


@pytest.mark.django_db
def test_login_api_other_account_survives(settings, client, monkeypatch):
    settings.TRUSTED_PROXY_IPS = {"127.0.0.1"}
    monkeypatch.setattr("backend.apps.core.auth.authenticate", lambda *a, **kw: None)

    def login(email):
        return client.post(
            "/api/auth/login",
            {"email": email, "password": "invalid-test-only"},
            content_type="application/json",
            HTTP_X_REAL_IP="198.51.100.1",
        )

    for _ in range(10):
        assert login("a@onesmarter.com").status_code == 401
    assert login("a@onesmarter.com").status_code == 429
    assert login("b@onesmarter.com").status_code == 401
