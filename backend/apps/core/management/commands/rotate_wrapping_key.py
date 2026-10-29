from django.core.management.base import BaseCommand, CommandError

from backend.apps.core.keyring import rotate
from backend.apps.core.models import Organization


class Command(BaseCommand):
    help = (
        "Provision a new active OneSmarter key version; retain old versions for reads and backups."
    )

    def add_arguments(self, parser):
        parser.add_argument("--organization", required=True)
        parser.add_argument("--reason", required=True)

    def handle(self, *args, **options):
        try:
            org = Organization.objects.get(pk=options["organization"])
            key = rotate(org, reason=options["reason"])
        except Exception as exc:
            raise CommandError(
                "Key rotation could not be confirmed. Inspect service versions before retrying; "
                "a remote activation may have committed before the response failed."
            ) from exc
        self.stdout.write(
            f"Activated wrapping-key version {key.pk}. Old keys remain available. No document was re-encrypted."
        )
