from celery import shared_task


@shared_task(name="securemail.process_pending", ignore_result=True)
def process_pending_task():
    from .mail import process_pending

    process_pending()


@shared_task(name="securemail.archive_audit", ignore_result=True)
def archive_audit_task():
    from .audit import archive_pending

    if archive_pending():
        archive_audit_task.delay()


@shared_task(name="securemail.cleanup_transient", ignore_result=True)
def cleanup_transient_task():
    """Bounded cleanup of abandoned uploads and fully-refilled rate buckets."""
    from datetime import timedelta

    from django.db.models import Q
    from django.utils import timezone

    from .models import RateBucket
    from .operations import clean_staged

    # All current bucket refill periods are <= one day. Two idle days is safe.
    expired = list(
        RateBucket.objects.filter(
            Q(refilled_at__lt=timezone.now() - timedelta(days=2)) | Q(refilled_at=None)
        ).values_list("pk", flat=True)[:1000]
    )
    RateBucket.objects.filter(pk__in=expired).filter(
        Q(refilled_at__lt=timezone.now() - timedelta(days=2)) | Q(refilled_at=None)
    ).delete()
    result = clean_staged(older_than_hours=24, limit=100, apply=True)
    if result["failed"]:
        import logging

        logging.getLogger("securemail").warning("staged_cleanup_failed count=%s", result["failed"])
