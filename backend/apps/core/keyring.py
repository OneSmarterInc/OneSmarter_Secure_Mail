"""Application-owned key lifecycle using established library primitives.

The candidate envelope protocol requires independent review before production.
These operations are not ordinary portal-administrator endpoints.
"""

import base64
import json
import secrets
import uuid

from cryptography.hazmat.primitives.asymmetric.mlkem import MLKEM768PrivateKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from django.conf import settings
from django.db import transaction

from backend.keyservice import protocol
from backend.keyservice.client import Client

from .models import WrappingKeyVersion

SUITE = "OSM-v2-MLKEM768-X25519-HKDFSHA256-AES256GCM"


def encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def decode(data: str) -> bytes:
    return base64.b64decode(data, validate=True)


def root_context(key: WrappingKeyVersion) -> dict[str, str]:
    return {
        "application": "onesmarter-secure-mail",
        "purpose": "wrapping-private-key",
        "organization": str(key.organization_id),
        "version": str(key.pk),
        "suite": SUITE,
    }


def protect_private(data: bytes, key: WrappingKeyVersion) -> str:
    context = root_context(key)
    if settings.KEY_PROTECTOR != "local-development" or not settings.SYNTHETIC_MODE:
        raise ValueError("Approved key protector is unavailable.")
    from .crypto import _local_key

    nonce = secrets.token_bytes(12)
    encrypted = AESGCM(_local_key()).encrypt(
        nonce, data, json.dumps(context, sort_keys=True).encode()
    )
    return json.dumps(
        {
            "provider": "local-development",
            "key_id": "local-v1",
            "nonce": encode(nonce),
            "data": encode(encrypted),
        }
    )


def private_keys(key: WrappingKeyVersion) -> tuple[MLKEM768PrivateKey, X25519PrivateKey]:
    envelope = json.loads(key.private_ciphertext)
    context = root_context(key)
    if (
        envelope["provider"] == "local-development"
        and envelope["key_id"] == "local-v1"
        and settings.KEY_PROTECTOR == "local-development"
        and settings.SYNTHETIC_MODE
    ):
        from .crypto import _local_key

        raw = AESGCM(_local_key()).decrypt(
            decode(envelope["nonce"]),
            decode(envelope["data"]),
            json.dumps(context, sort_keys=True).encode(),
        )
    else:
        raise ValueError("Unsupported key protector.")
    if len(raw) != 96:
        raise ValueError("Invalid private-key material.")
    pq = MLKEM768PrivateKey.from_seed_bytes(raw[:64])
    classical = X25519PrivateKey.from_private_bytes(raw[64:])
    if (
        encode(pq.public_key().public_bytes_raw()) != key.pq_public
        or encode(classical.public_key().public_bytes_raw()) != key.classical_public
    ):
        raise ValueError("Key metadata does not match protected material.")
    return pq, classical


@transaction.atomic
def rotate(org, *, actor=None, reason: str = "Initial key provisioning") -> WrappingKeyVersion:
    from .services import audit, lock_organization

    organization = lock_organization(org)
    if settings.KEY_PROTECTOR == "key-service":
        current = active_remote(organization.pk, required=False)
        result = service().call(
            "rotate",
            organization=str(organization.pk),
            expected=str(current.pk) if current else None,
            request_id=str(uuid.uuid4()),
        )
        key = synchronize(result)
        audit(
            organization,
            actor,
            "key.version_activated",
            "wrapping_key",
            key.pk,
            metadata={"suite": SUITE, "reason": reason[:300]},
        )
        return key
    pq, classical = MLKEM768PrivateKey.generate(), X25519PrivateKey.generate()
    key = WrappingKeyVersion(
        organization=organization,
        suite=SUITE,
        pq_public=encode(pq.public_key().public_bytes_raw()),
        classical_public=encode(classical.public_key().public_bytes_raw()),
    )
    key.private_ciphertext = protect_private(
        pq.private_bytes_raw() + classical.private_bytes_raw(), key
    )
    private_keys(key)
    WrappingKeyVersion.objects.filter(organization=organization, state="active").update(
        state="decrypt_only"
    )
    key.save()
    audit(
        organization,
        actor,
        "key.version_activated",
        "wrapping_key",
        key.pk,
        metadata={"suite": SUITE, "reason": reason[:300]},
    )
    return key


def active_key(org) -> WrappingKeyVersion:
    if settings.KEY_PROTECTOR == "key-service":
        return active_remote(org)
    key = WrappingKeyVersion.objects.filter(organization_id=org, state="active").first()
    if key is None and settings.SYNTHETIC_MODE:
        from .services import lock_organization

        with transaction.atomic():
            lock_organization(org)
            key = WrappingKeyVersion.objects.filter(organization_id=org, state="active").first()
            if key is None:
                key = rotate(org)
    if key is None:
        raise ValueError("No active wrapping-key version is provisioned.")
    return key


def get_key(org, ident) -> WrappingKeyVersion:
    return WrappingKeyVersion.objects.get(
        pk=uuid.UUID(ident), organization_id=org, suite=SUITE, state__in=["active", "decrypt_only"]
    )


def service() -> Client:
    return Client(
        settings.KEY_SERVICE_URL,
        settings.KEY_SERVICE_CA,
        settings.KEY_SERVICE_CERT,
        settings.KEY_SERVICE_KEY,
        require_pq=settings.PQ_TRANSPORT_REQUIRED,
    )


@transaction.atomic
def synchronize(metadata: dict) -> WrappingKeyVersion:
    from .services import lock_organization

    if metadata["suite"] != SUITE or metadata["state"] not in {"active", "decrypt_only"}:
        raise ValueError("Unsupported remote key metadata.")
    protocol.decode(metadata["pq_public"], 1184)
    protocol.decode(metadata["classical_public"], 32)
    org = lock_organization(metadata["organization"])
    existing = WrappingKeyVersion.objects.filter(pk=metadata["id"]).first()
    if existing and (
        existing.organization_id != org.pk
        or existing.pq_public != metadata["pq_public"]
        or existing.classical_public != metadata["classical_public"]
    ):
        raise ValueError("Remote key identity mismatch.")
    if metadata["state"] == "active":
        WrappingKeyVersion.objects.filter(organization=org, state="active").exclude(
            pk=metadata["id"]
        ).update(state="decrypt_only")
    key, _ = WrappingKeyVersion.objects.update_or_create(
        pk=metadata["id"],
        defaults={
            "organization": org,
            "suite": SUITE,
            "state": metadata["state"],
            "pq_public": metadata["pq_public"],
            "classical_public": metadata["classical_public"],
            "private_ciphertext": json.dumps({"provider": "key-service", "id": metadata["id"]}),
        },
    )
    return key


def active_remote(org, *, required=True):
    versions = service().call("versions", organization=str(getattr(org, "pk", org)), active=True)[
        "versions"
    ]
    active = [item for item in versions if item["state"] == "active"]
    if len(active) > 1 or (required and not active):
        raise ValueError("No unique active service key is provisioned.")
    if active:
        if active[0]["organization"] != str(getattr(org, "pk", org)):
            raise ValueError("Wrong key scope.")
        return synchronize(active[0])
    return None
