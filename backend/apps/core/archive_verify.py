"""Version-specific archive verification and independent searchable projection.

Trust requires a separately protected manifest. Hashes alone do not authenticate
an attacker-controlled manifest. Never alter canonical application audit events.
"""

import hashlib
import json
import sqlite3
from contextlib import closing
from pathlib import Path

from django.utils.dateparse import parse_datetime
from django.utils.timezone import is_naive

from backend.keyservice.protocol import parse_object

MAX_EVENT_BYTES = 1024 * 1024


def read_verified(client, bucket: str, entry: dict) -> dict:
    until = parse_datetime(entry["retain_until"])
    if until is None or is_naive(until):
        raise ValueError("Invalid retention timestamp.")
    args = {"Bucket": bucket, "Key": entry["object_key"], "VersionId": entry["version_id"]}
    retention = client.get_object_retention(**args)["Retention"]
    if retention.get("Mode") != "COMPLIANCE" or retention.get("RetainUntilDate") < until:
        raise ValueError("Archive retention mismatch.")
    result = client.get_object(**args)
    stream = result["Body"]
    try:
        raw = stream.read(MAX_EVENT_BYTES + 1)
    finally:
        stream.close()
    if len(raw) > MAX_EVENT_BYTES or hashlib.sha256(raw).hexdigest() != entry["digest"]:
        raise ValueError("Archive digest mismatch.")
    value = parse_object(raw)
    event = value.get("event", {})
    if (
        value.get("schema") != 1
        or value.get("organization") != entry["organization"]
        or event.get("id") != entry["event_id"]
        or event.get("sequence") != entry["sequence"]
    ):
        raise ValueError("Archive identity mismatch or unsupported legacy format.")
    return value


def rebuild_projection(client, bucket: str, entries: list[dict], destination: Path) -> int:
    """Create a new queryable projection atomically; never overwrite existing evidence."""
    with destination.open("xb"):
        pass
    destination.chmod(0o600)
    try:
        with closing(sqlite3.connect(destination)) as db, db:
            db.execute(
                "CREATE TABLE events (id TEXT PRIMARY KEY, organization TEXT NOT NULL, "
                "sequence INTEGER NOT NULL, action TEXT NOT NULL, body TEXT NOT NULL)"
            )
            db.execute("CREATE UNIQUE INDEX event_order ON events(organization, sequence)")
            for entry in entries:
                value = read_verified(client, bucket, entry)
                event = value["event"]
                db.execute(
                    "INSERT INTO events VALUES (?,?,?,?,?)",
                    (
                        event["id"],
                        value["organization"],
                        event["sequence"],
                        event["action"],
                        json.dumps(event, sort_keys=True),
                    ),
                )
        return len(entries)
    except BaseException:
        destination.unlink(missing_ok=True)
        raise
