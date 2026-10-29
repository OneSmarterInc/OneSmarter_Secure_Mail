"""Resumable per-record rewrapping with atomic database pointers and retained old versions."""

import json
import uuid

from django.db import transaction

from . import crypto, keyring, storage
from .conversations import attachment_context, message_context, subject_context
from .models import Attachment, Conversation, DeliveryJob, Message, StaffUser
from .services import audit, lock_organization


def needs_rewrap(value, key_id):
    if not value:
        return False
    envelope = json.loads(value)
    return (
        envelope.get("v") != 2
        or envelope.get("auth_v") != 1
        or "auth" not in envelope
        or envelope.get("key_id") != str(key_id)
    )


def migrate(org, *, apply=False, limit=100):
    active = keyring.active_key(org.pk)
    totals = {"candidates": 0, "updated": 0}
    specs = [
        (Conversation, "organization", [("subject_ciphertext", subject_context)]),
        (Message, "conversation__organization", [("body_ciphertext", message_context)]),
        (
            StaffUser,
            "organization",
            [("mfa_secret", lambda x: crypto.context(org.pk, "mfa", x.pk))],
        ),
        (
            DeliveryJob,
            "organization",
            [("payload_ciphertext", lambda x: crypto.context(org.pk, "delivery", x.pk))],
        ),
        (
            Attachment,
            "organization",
            [("name_ciphertext", lambda x: crypto.context(org.pk, "filename", x.pk))],
        ),
    ]
    for model, org_field, fields in specs:
        for ident in (
            model.objects.filter(**{org_field: org})
            .order_by("pk")
            .values_list("pk", flat=True)
            .iterator(chunk_size=100)
        ):
            with transaction.atomic():
                lock_organization(org)
                current = keyring.active_key(org.pk)
                if current.pk != active.pk:
                    raise ValueError(
                        "A key rotated during migration. Restart against the current active version."
                    )
                obj = model.objects.select_for_update().get(pk=ident)
                updates = {}
                for field, context_fn in fields:
                    original = getattr(obj, field)
                    if needs_rewrap(original, active.pk):
                        updates[field] = (
                            crypto.rewrap(original, context_fn(obj)) if apply else original
                        )
                if model is Attachment:
                    original_file = storage.get(obj.object_key).decode()
                    if needs_rewrap(original_file, active.pk):
                        if apply:
                            envelope = crypto.rewrap(
                                original_file, attachment_context(obj)
                            ).encode()
                            new_key = f"{org.pk}/rewrapped/{obj.pk}/{uuid.uuid4()}"
                            storage.put(new_key, envelope)
                            # Retain old object copies until approved cleanup/backup policy permits deletion.
                            updates.update(object_key=new_key, stored_size=len(envelope))
                        else:
                            updates["object_key"] = obj.object_key
                if updates:
                    totals["candidates"] += 1
                    if apply:
                        for field, value in updates.items():
                            setattr(obj, field, value)
                        obj.save(update_fields=list(updates))
                        audit(
                            org,
                            None,
                            "key.envelope_rewrapped",
                            model._meta.model_name,
                            obj.pk,
                            metadata={"destination_key": str(active.pk)},
                        )
                        totals["updated"] += 1
                    if totals["candidates"] >= limit:
                        return totals
    return totals
