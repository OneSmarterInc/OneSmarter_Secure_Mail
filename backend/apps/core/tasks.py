from celery import shared_task


@shared_task(name="securemail.process_pending", ignore_result=True)
def process_pending_task():
    from .mail import process_pending

    process_pending()


@shared_task(name="securemail.archive_audit", ignore_result=True)
def archive_audit_task():
    from .audit import archive_pending

    archive_pending()
