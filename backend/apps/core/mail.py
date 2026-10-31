import json
import smtplib
import time
from datetime import timedelta
from email.utils import formataddr

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.utils import timezone

from . import crypto, document_service, senders, smtp_settings, storage
from .email_templates import notification_html
from .models import (
    Attachment,
    DeliveryJob,
    OrganizationSMTP,
    OTPChallenge,
    RecipientInvitationToken,
    StaffInvitation,
)
from .outbox_lock import outbox_lock
from .services import audit, digest


def payload(job):
    return json.loads(
        crypto.decrypt(
            job.payload_ciphertext, crypto.context(job.organization_id, "delivery", job.pk)
        )
    )


def process_job(job_id, *, service_ready=None):
    if service_ready is None:
        has_conversation = DeliveryJob.objects.filter(
            pk=job_id, conversation__isnull=False
        ).exists()
        service_ready = document_service.ready() if has_conversation else True
    with transaction.atomic():
        job = (
            DeliveryJob.objects.select_for_update(of=("self",))
            .select_related("actor", "conversation", "grant", "organization")
            .get(pk=job_id)
        )
        if job.state not in {"queued", "retry"} or job.next_attempt > timezone.now():
            return
        if job.conversation_id and not service_ready:
            job.error_code = "service_disabled"
            job.next_attempt = timezone.now() + timedelta(seconds=15)
            job.save(update_fields=["error_code", "next_attempt", "updated_at"])
            return
        if (job.actor and job.actor.status != "active") or (
            job.conversation and job.conversation.owner.status != "active"
        ):
            # Invitations created by an administrator must also stop if authority is withdrawn.
            job.state = "cancelled"
            job.error_code = "actor_unavailable"
            job.save()
            return
        if job.conversation and (
            job.conversation.revoked_at
            or job.conversation.expires_at <= timezone.now()
            and job.conversation.protected
        ):
            job.state = "cancelled"
            job.save()
            return
        if job.grant and job.grant.revoked_at:
            job.state = "cancelled"
            job.save()
            return
        data = payload(job)
        if (
            job.grant
            and "/#/invite/" in data.get("link", "")
            and digest(data["link"].rsplit("/", 1)[-1]) != job.grant.token_hash
            and not RecipientInvitationToken.objects.filter(
                grant=job.grant, token_hash=digest(data["link"].rsplit("/", 1)[-1])
            ).exists()
        ):
            job.state, job.error_code = "cancelled", "invitation_superseded"
            job.payload_ciphertext = ""
            job.save()
            return
        if (
            data.get("challenge_id")
            and not OTPChallenge.objects.filter(
                pk=data["challenge_id"], consumed_at=None, expires_at__gt=timezone.now()
            ).exists()
        ):
            job.state, job.error_code = "cancelled", "code_superseded"
            job.payload_ciphertext = ""
            job.save()
            return
        if data.get("invitation_id") and (
            not job.actor
            or job.actor.role != "admin"
            or not StaffInvitation.objects.filter(
                pk=data["invitation_id"],
                consumed_at=None,
                expires_at__gt=timezone.now(),
                user__status__in=["invited", "active"],
            ).exists()
        ):
            job.state, job.error_code = "cancelled", "invitation_superseded"
            job.payload_ciphertext = ""
            job.save()
            return
        if (
            job.conversation
            and not job.conversation.protected
            and (
                job.conversation.routing_reason != "explicit_nophi_override"
                or job.conversation.mode != "ordinary"
            )
        ):
            job.state = "cancelled"
            job.error_code = "route_policy_changed"
            job.save()
            return
        if (
            job.conversation
            and not job.conversation.protected
            and job.conversation.routing_reason == "explicit_nophi_override"
            and (not job.actor or not job.actor.can_nophi)
        ):
            job.state = "cancelled"
            job.error_code = "permission_revoked"
            job.save()
            return
        job.state = "sending"
        job.attempts += 1
        job.save()
    submission_started = False
    smtp_connection = None
    try:
        if settings.MAIL_PROVIDER == "development" and settings.SYNTHETIC_MODE:
            state = "development_delivered"
        else:
            ordinary = bool(job.conversation and not job.conversation.protected)
            owner = job.conversation.owner if job.conversation else job.actor
            if owner is None or owner.organization_id != job.organization_id:
                raise senders.SenderUnavailable("No authorized staff SMTP identity")
            sender, smtp_connection = (
                smtp_settings.otp_connection(owner)
                if data.get("challenge_id")
                else smtp_settings.connection(owner)
            )
            if ordinary and (
                not job.actor
                or sender != job.conversation.sender
                or sender not in job.actor.sender_addresses
                or job.actor.organization_id != job.organization_id
            ):
                raise senders.SenderUnavailable("Sender authority was withdrawn")
            text = data["body"] + ("\n\n" + data["link"] if data.get("link") else "")
            if job.conversation and job.conversation.protected:
                text += "\n\nDo not reply. Please respond through the secure portal."
            message = EmailMultiAlternatives(
                subject=data["subject"],
                body=text,
                from_email=formataddr(
                    (
                        OrganizationSMTP.objects.get(
                            organization_id=owner.organization_id
                        ).sender_name,
                        sender,
                    )
                ),
                reply_to=[smtp_connection.username if data.get("challenge_id") else sender],
                connection=smtp_connection,
                to=[data["to"]],
                headers={"Message-ID": f"<{job.pk}@{settings.COMPANY_DOMAIN}>"},
            )
            # Ordinary email retains its existing text/attachment behavior.
            if not job.conversation or job.conversation.protected:
                message.attach_alternative(
                    notification_html(
                        data, protected=bool(job.conversation and job.conversation.protected)
                    ),
                    "text/html",
                )
            for ident in data.get("attachments", []):
                attachment = Attachment.objects.get(
                    pk=ident, organization_id=job.organization_id, state="available"
                )
                from .conversations import attachment_context

                document = crypto.decrypt(
                    storage.get(attachment.object_key).decode(), attachment_context(attachment)
                )
                name = crypto.decrypt(
                    attachment.name_ciphertext,
                    crypto.context(attachment.organization_id, "filename", attachment.pk),
                ).decode()
                message.attach(name, document, attachment.media_type)
            smtp_connection.open()  # Connect, TLS and authenticate before submission.
            submission_started = True
            if message.send(fail_silently=False) != 1:
                raise smtplib.SMTPException("No acceptance confirmation")
            state = "provider_accepted"
        error = ""
    except document_service.ServiceDisabled:
        state, error = "retry", "service_disabled"
    except senders.SenderUnavailable:
        state, error = "failed", "sender_not_configured"
    except smtplib.SMTPAuthenticationError:
        state, error = "failed", "mail_authentication_failed"
    except smtplib.SMTPRecipientsRefused:
        state, error = "failed", "mail_recipients_refused"
    except (OSError, smtplib.SMTPException):
        # A disconnect can follow acceptance. Do not blindly retry an ambiguous SMTP send.
        if submission_started:
            state, error = "uncertain", "delivery_outcome_unknown"
        else:
            state = "retry" if job.attempts < 5 else "failed"
            error = "mail_connection_failed"
    except Exception:
        state, error = "failed", "delivery_failed"
    finally:
        if smtp_connection is not None:
            try:
                smtp_connection.close()
            except (OSError, smtplib.SMTPException):
                pass  # QUIT failure cannot undo a confirmed DATA acceptance.
    with transaction.atomic():
        job = DeliveryJob.objects.select_for_update().get(pk=job_id)
        job.state, job.error_code = state, error
        if error == "mail_connection_failed" and state == "retry":
            job.next_attempt = timezone.now() + timedelta(seconds=min(900, 15 * 2**job.attempts))
        if error == "service_disabled":
            job.next_attempt = timezone.now() + timedelta(seconds=15)
        if state == "provider_accepted":
            job.payload_ciphertext = ""  # Do not retain delivered codes/tokens indefinitely.
        job.save()
        audit(
            job.organization_id,
            None,
            "delivery." + state,
            "delivery",
            job.pk,
            outcome="success"
            if state in {"provider_accepted", "development_delivered"}
            else "failure",
        )


def process_pending():
    with outbox_lock() as acquired:
        if not acquired:
            return
        _process_batch()


def _process_batch():
    # Recover jobs abandoned in 'sending' without risking blind duplicate delivery.
    DeliveryJob.objects.filter(
        state="sending", updated_at__lt=timezone.now() - timedelta(minutes=5)
    ).update(state="uncertain", error_code="worker_interrupted")
    jobs = list(
        DeliveryJob.objects.filter(state__in=["queued", "retry"], next_attempt__lte=timezone.now())
        .order_by("next_attempt", "created_at", "pk")
        .values_list("pk", "conversation_id")[:100]
    )
    ready = document_service.ready() if any(conversation for _, conversation in jobs) else True
    deadline = time.monotonic() + 30
    for ident, _ in jobs:
        if time.monotonic() >= deadline:
            break
        process_job(ident, service_ready=ready)
    DeliveryJob.objects.filter(created_at__lt=timezone.now() - timedelta(days=1)).exclude(
        payload_ciphertext=""
    ).exclude(state__in=["queued", "retry"]).update(payload_ciphertext="")
