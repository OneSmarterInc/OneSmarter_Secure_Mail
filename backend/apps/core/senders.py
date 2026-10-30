"""Operator-approved exact sender-to-SMTP mappings; no global credential fallback."""

import json
import os
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.mail import get_connection
from django.core.validators import validate_email

from .company_identity import is_company_address


class SenderUnavailable(ValueError):
    pass


def address(value: str) -> str:
    if not isinstance(value, str) or value != value.strip() or "\n" in value or "\r" in value:
        raise SenderUnavailable("Sender address is invalid")
    try:
        validate_email(value)
    except ValidationError as exc:
        raise SenderUnavailable("Sender address is invalid") from exc
    value = value.lower()
    if not is_company_address(value):
        raise SenderUnavailable("Sender must belong to the company domain")
    return value


def profile(sender: str) -> dict:
    sender = address(sender)
    try:
        path = Path(settings.SMTP_SENDER_PROFILES_FILE)
        if not path.is_absolute():
            path = settings.BASE_DIR / path
        with path.open(encoding="utf-8") as stream:
            raw = stream.read(65537)
        if len(raw) > 65536:
            raise ValueError("Oversized configuration")
        profiles = json.loads(raw)
        item = profiles[sender]
        if not isinstance(item, dict) or set(item) != {
            "host",
            "port",
            "username",
            "password_env",
            "security",
        }:
            raise ValueError("Invalid profile schema")
        if item["security"] not in {"starttls", "tls"}:
            raise ValueError("Encrypted SMTP is mandatory")
        if type(item["port"]) is not int or item["port"] not in {465, 587}:
            raise ValueError("Invalid SMTP port")
        for key in ("host", "username", "password_env"):
            if (
                not isinstance(item[key], str)
                or not item[key]
                or any(c.isspace() for c in item[key])
            ):
                raise ValueError("Invalid SMTP configuration")
        if not item["password_env"].startswith("SMTP_PASSWORD_"):
            raise ValueError("Use a dedicated credential variable")
        password = os.environ.get(item["password_env"], "")
        if not password:
            raise ValueError("Credential unavailable")
        return {**item, "password": password}
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise SenderUnavailable("Sender SMTP configuration is unavailable") from exc


def configured(sender: str) -> bool:
    try:
        profile(sender)
        return True
    except SenderUnavailable:
        return False


def connection(sender: str):
    item = profile(sender)
    return get_connection(
        host=item["host"],
        port=item["port"],
        username=item["username"],
        password=item["password"],
        use_tls=item["security"] == "starttls",
        use_ssl=item["security"] == "tls",
        timeout=20,
        fail_silently=False,
    )
