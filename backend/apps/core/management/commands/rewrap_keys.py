from django.core.management.base import BaseCommand, CommandError

from backend.apps.core.key_migration import migrate
from backend.apps.core.models import Organization


class Command(BaseCommand):
    help = (
        "Rewrap existing records in bounded resumable batches. Dry run unless --apply is supplied."
    )

    def add_arguments(self, parser):
        parser.add_argument("--organization", required=True)
        parser.add_argument("--limit", type=int, default=100)
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        if not 1 <= options["limit"] <= 1000:
            raise CommandError("Choose a batch limit between 1 and 1000.")
        try:
            org = Organization.objects.get(pk=options["organization"])
            result = migrate(org, apply=options["apply"], limit=options["limit"])
        except Exception as exc:
            raise CommandError(
                "Rewrap stopped. Completed records remain valid; the failed record was not replaced. Check keys/storage and rerun."
            ) from exc
        self.stdout.write(
            f"Candidates: {result['candidates']}; updated: {result['updated']}. Repeat until candidates is zero. Old key versions are retained."
        )
