import hashlib
import hmac
import json
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from . import crypto
from .http import Problem
from .models import AuditEvent, DeliveryJob, IdempotencyRecord, Organization, RateBucket


def lock_organization(org):
    """Acquire first in multi-resource transactions for consistent lock ordering."""
    return Organization.objects.select_for_update().get(pk=getattr(org, "pk", org))


def current_staff(request):
    from .models import StaffUser

    user = StaffUser.objects.select_for_update().get(pk=request.user.pk)
    if (
        user.status != "active"
        or not user.is_active
        or user.session_version != request.session.get("staff_version")
    ):
        raise Problem("Your session ended. Please sign in again.", "session_expired", 401)
    return user


def digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def keyed(value: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), value.encode(), hashlib.sha256).hexdigest()


@transaction.atomic
def audit(
    org, actor, action: str, target_type: str, target_id, *, outcome="success", metadata=None
):
    organization = lock_organization(org)
    organization.audit_sequence += 1
    organization.save(update_fields=["audit_sequence"])
    return AuditEvent.objects.create(
        organization=organization,
        sequence=organization.audit_sequence,
        actor_id=str(getattr(actor, "pk", actor or "system")),
        actor_label=getattr(actor, "display_name", "Recipient" if actor else "System"),
        actor_role=getattr(actor, "role", "recipient" if actor else "system"),
        action=action,
        target_type=target_type,
        target_id=str(target_id),
        outcome=outcome,
        metadata=metadata or {},
    )


def rate_limit(request, scope: str, identity: str = "", *, maximum=10, seconds=300):
    # Never trust arbitrary forwarded IP headers. Proxy trust must be configured separately.
    identities = [f"ip:{request.META.get('REMOTE_ADDR', 'unknown')}"]
    if identity:
        identities.append(f"identity:{identity.lower()}")
    now = timezone.now()
    rejected = False
    with transaction.atomic():
        for identity_value in identities:
            key = keyed(f"rate:{scope}:{identity_value}")
            bucket, _ = RateBucket.objects.get_or_create(
                key=key, defaults={"expires_at": now + timedelta(seconds=seconds)}
            )
            bucket = RateBucket.objects.select_for_update().get(pk=bucket.pk)
            if bucket.expires_at <= now:
                bucket.count = 0
                bucket.expires_at = now + timedelta(seconds=seconds)
            bucket.count += 1
            rejected |= bucket.count > maximum
            bucket.save(update_fields=["count", "expires_at"])
    if rejected:
        raise Problem("Too many attempts. Please try again later.", "rate_limited", 429)


def queue_mail(org, payload: dict, *, actor=None, conversation=None, grant=None):
    job = DeliveryJob(organization=org, actor=actor, conversation=conversation, grant=grant)
    job.payload_ciphertext = crypto.encrypt(
        json.dumps(payload).encode(), crypto.context(org.pk, "delivery", job.pk)
    )
    job.save()
    return job


def idempotency(request, org, actor: str, operation: str, payload: dict):
    key = request.headers.get("Idempotency-Key", "")
    if not key or len(key) > 100:
        raise Problem(
            "An Idempotency-Key of at most 100 characters is required.", "idempotency_required"
        )
    Organization.objects.select_for_update().get(pk=org.pk)
    fingerprint = keyed(json.dumps(payload, sort_keys=True, default=str, separators=(",", ":")))
    existing = IdempotencyRecord.objects.filter(
        organization=org, actor=actor, operation=operation, key=key
    ).first()
    if existing and not secrets.compare_digest(existing.fingerprint, fingerprint):
        raise Problem(
            "This submission key was already used with different data.", "idempotency_conflict", 409
        )
    return existing, {
        "organization": org,
        "actor": actor,
        "operation": operation,
        "key": key,
        "fingerprint": fingerprint,
    }


def paginate(query, request, *, ordering: dict, default: str):
    order = request.query_params.get("sort", default)
    direction = "-" if order.startswith("-") else ""
    field = ordering.get(order.lstrip("-"))
    if field is None:
        raise Problem("Unsupported sort field.", "invalid_sort")
    try:
        size = int(request.query_params.get("page_size", 25))
        page = int(request.query_params.get("page", 1))
    except ValueError as exc:
        raise Problem("Invalid pagination.") from exc
    if size not in {25, 50, 100} or page < 1 or page > 10000:
        raise Problem("Invalid pagination.")
    from django.db.models import F

    order_expression = (
        F(field).desc(nulls_last=True) if direction else F(field).asc(nulls_last=True)
    )
    query = query.order_by(order_expression, "pk")
    total = query.count()
    return list(query[(page - 1) * size : page * size]), {
        "count": total,
        "page": page,
        "page_size": size,
    }
