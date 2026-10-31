import json

from django.core.management.base import BaseCommand, CommandError

from backend.apps.core.storage import scanner_health


class Command(BaseCommand):
    help = "Verify ClamAV connectivity and loaded signature freshness."

    def handle(self, *args, **options):
        try:
            result = scanner_health()
        except (OSError, ValueError) as exc:
            raise CommandError(f"ClamAV readiness failed: {exc}") from exc
        self.stdout.write(json.dumps(result))
