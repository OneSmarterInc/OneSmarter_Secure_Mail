"""Sealed, transactional local key store. Run one service process per store.

SQLite serializes durable changes; the process lock serializes sealing and use.
Root/private secrets are never exposed by public return values. Audit chaining
detects changes relative to an independently retained checkpoint, not host root.
"""

import hashlib
import json
import os
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import closing, contextmanager
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from . import protocol as p


class SealedError(ValueError):
    pass


class ConflictError(ValueError):
    pass


def protect(root: bytes, value: bytes, aad: bytes) -> str:
    nonce = secrets.token_bytes(12)
    return p.encode(nonce + AESGCM(root).encrypt(nonce, value, aad))


def recover(root: bytes, value: str, size: int, aad: bytes) -> bytes:
    raw = p.decode(value, 12 + size + 16)
    return AESGCM(root).decrypt(raw[:12], raw[12:], aad)


def key_aad(org: str, ident: str) -> bytes:
    return p.canonical(
        {"purpose": "private-version", "organization": org, "id": ident, "suite": p.SUITE}
    )


class KeyStore:
    def __init__(self, path: Path, backup_directory: Path | None = None):
        if not path.is_file():
            raise ValueError("Initialize the key store before starting it.")
        self.path = path
        self.backup_directory = backup_directory or path.parent / (path.stem + "-backups")
        self.lock = threading.RLock()
        self.root: bytes | None = None
        self.root_id: str | None = None
        self.seal_epoch: str | None = None
        self.audit_integrity = "unchecked"

    @classmethod
    def initialize(cls, path: Path, unlock_secret: bytes) -> "KeyStore":
        if len(unlock_secret) != 32:
            raise ValueError("Use a random 32-byte unlock secret.")
        path.parent.mkdir(parents=True, exist_ok=True)
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb"):
            pass
        path.chmod(0o600)
        root_id = str(uuid.uuid4())
        with sqlite3.connect(path) as db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                PRAGMA synchronous=FULL;
                CREATE TABLE meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE versions (
                    id TEXT PRIMARY KEY, org TEXT NOT NULL, state TEXT NOT NULL
                    CHECK(state IN ('active','decrypt_only')), private TEXT NOT NULL);
                CREATE UNIQUE INDEX active_org ON versions(org) WHERE state='active';
                CREATE TABLE requests (id TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL);
                CREATE TABLE audit (seq INTEGER PRIMARY KEY, body TEXT NOT NULL, digest TEXT NOT NULL);
                CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit BEGIN
                    SELECT RAISE(ABORT, 'append-only audit'); END;
                CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN
                    SELECT RAISE(ABORT, 'append-only audit'); END;
            """)
            db.executemany(
                "INSERT INTO meta VALUES (?,?)",
                [
                    ("format", "1"),
                    ("root_id", root_id),
                    (
                        "wrapped_root",
                        protect(unlock_secret, secrets.token_bytes(32), root_id.encode()),
                    ),
                ],
            )
        return cls(path)

    @contextmanager
    def transaction(self):
        with self.lock:
            db = sqlite3.connect(self.path, timeout=10)
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA synchronous=FULL")
            db.execute("PRAGMA secure_delete=ON")
            try:
                db.execute("BEGIN IMMEDIATE")
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise
            finally:
                db.close()

    def _refresh_seal(self, db):
        current = db.execute("SELECT value FROM meta WHERE name='root_id'").fetchone()[0]
        epoch = db.execute("SELECT value FROM meta WHERE name='seal_epoch'").fetchone()
        epoch = epoch[0] if epoch else "0"
        if self.root_id != current or self.seal_epoch != epoch:
            self.root = None
            self.root_id = None
            self.seal_epoch = None

    def _ready(self, db):
        self._refresh_seal(db)
        if self.root is None:
            raise SealedError("Key store is sealed.")

    @staticmethod
    def verify_audit(db):
        """Check local consistency; external checkpoints are required for rollback detection."""
        previous = "0" * 64
        expected_seq = 1
        for row in db.execute("SELECT seq,body,digest FROM audit ORDER BY seq"):
            body = p.parse_object(row["body"])
            if (
                row["seq"] != expected_seq
                or body.get("previous") != previous
                or hashlib.sha256(row["body"].encode()).hexdigest() != row["digest"]
            ):
                raise ValueError("Key-store audit integrity verification failed.")
            previous = row["digest"]
            expected_seq += 1

    @staticmethod
    def _audit(db, actor: str, operation: str, org: str = "", ident: str = ""):
        previous = db.execute("SELECT digest FROM audit ORDER BY seq DESC LIMIT 1").fetchone()
        body = p.canonical(
            {
                "at": time.time_ns(),
                "actor": actor,
                "operation": operation,
                "organization": org,
                "key_id": ident,
                "previous": previous[0] if previous else "0" * 64,
            }
        ).decode()
        db.execute(
            "INSERT INTO audit(body,digest) VALUES (?,?)",
            (body, hashlib.sha256(body.encode()).hexdigest()),
        )

    def record_event(self, actor: str, operation: str):
        """Call only with server-selected event names and provisioned actor names."""
        with self.transaction() as db:
            self._audit(db, actor, operation)

    def unseal(self, secret: bytes, actor: str):
        with self.lock:
            with self.transaction() as db:
                try:
                    self.verify_audit(db)
                except (ValueError, TypeError):
                    self.root = self.root_id = self.seal_epoch = None
                    self.audit_integrity = "failed"
                    raise
                meta = dict(db.execute("SELECT name,value FROM meta"))
                if meta["format"] != "1":
                    raise ValueError("Unsupported store format.")
                root = recover(secret, meta["wrapped_root"], 32, meta["root_id"].encode())
                # Verify every stored private record before admitting use.
                for row in db.execute("SELECT * FROM versions"):
                    p.private_keys(
                        recover(root, row["private"], 96, key_aad(row["org"], row["id"]))
                    )
                self._audit(db, actor, "unseal")
            with self.lock:
                self.root, self.root_id = root, meta["root_id"]
                self.seal_epoch = meta.get("seal_epoch", "0")
                self.audit_integrity = "verified_at_unseal"

    def seal(self, actor: str):
        # Clear first, even when recording the event fails.
        with self.lock:
            self.root = self.root_id = self.seal_epoch = None
            with self.transaction() as db:
                db.execute(
                    "INSERT INTO meta(name,value) VALUES ('seal_epoch',?) "
                    "ON CONFLICT(name) DO UPDATE SET value=excluded.value",
                    (str(uuid.uuid4()),),
                )
                self._audit(db, actor, "seal")

    def status(self) -> dict:
        with self.transaction() as db:
            self._refresh_seal(db)
            head = db.execute("SELECT seq,digest FROM audit ORDER BY seq DESC LIMIT 1").fetchone()
            return {
                "sealed": self.root is None,
                "suite": p.SUITE,
                "audit_checkpoint": dict(head) if head else None,
                "audit_integrity": self.audit_integrity,
            }

    def _private(self, row) -> bytes:
        return recover(self.root, row["private"], 96, key_aad(row["org"], row["id"]))

    def _metadata(self, row) -> dict:
        return {
            "id": row["id"],
            "organization": row["org"],
            "state": row["state"],
            "suite": p.SUITE,
            **p.public(self._private(row)),
        }

    def list_versions(self, org: str, *, active: bool = False, after: str = "") -> list:
        if type(active) is not bool or not isinstance(after, str):
            raise ValueError("Invalid version query.")
        if after and (active or str(uuid.UUID(after)) != after):
            raise ValueError("Invalid version cursor.")
        with self.transaction() as db:
            self._ready(db)
            return [
                self._metadata(row)
                for row in db.execute(
                    "SELECT * FROM versions WHERE org=? AND id>? "
                    "AND (?=0 OR state='active') ORDER BY id LIMIT 100",
                    (org, after, int(active)),
                )
            ]

    def rotate(self, org: str, expected: str | None, request_id: str, actor: str) -> dict:
        org, request_id = str(uuid.UUID(org)), str(uuid.UUID(request_id))
        digest = hashlib.sha256(
            p.canonical({"org": org, "expected": expected, "actor": actor})
        ).hexdigest()
        with self.transaction() as db:
            self._ready(db)
            previous = db.execute("SELECT * FROM requests WHERE id=?", (request_id,)).fetchone()
            if previous:
                if previous["digest"] != digest:
                    raise ConflictError("Request identifier was already used.")
                original = json.loads(previous["result"])
                # A later rotation may have retired this operation's key. Replay
                # must never publish stale "active" metadata to the application.
                return self._metadata(
                    db.execute(
                        "SELECT * FROM versions WHERE id=? AND org=?", (original["id"], org)
                    ).fetchone()
                )
            active = db.execute(
                "SELECT id FROM versions WHERE org=? AND state='active'", (org,)
            ).fetchone()
            if (active[0] if active else None) != expected:
                raise ConflictError("Active version changed; refresh before rotating.")
            ident, raw = str(uuid.uuid4()), p.generate()
            encrypted = protect(self.root, raw, key_aad(org, ident))
            if recover(self.root, encrypted, 96, key_aad(org, ident)) != raw:
                raise ValueError("Private record verification failed.")
            db.execute(
                "UPDATE versions SET state='decrypt_only' WHERE org=? AND state='active'", (org,)
            )
            db.execute("INSERT INTO versions VALUES (?,?,?,?)", (ident, org, "active", encrypted))
            result = self._metadata(
                db.execute("SELECT * FROM versions WHERE id=?", (ident,)).fetchone()
            )
            self._audit(db, actor, "rotate", org, ident)
            db.execute(
                "INSERT INTO requests VALUES (?,?,?)",
                (request_id, digest, p.canonical(result).decode()),
            )
            self._checkpoint(db)
            return result

    def import_version(self, org: str, ident: str, raw: bytes, actor: str) -> dict:
        """Explicit custodian migration only; imports are never automatically activated."""
        org, ident = str(uuid.UUID(org)), str(uuid.UUID(ident))
        p.private_keys(raw)
        with self.transaction() as db:
            self._ready(db)
            existing = db.execute("SELECT * FROM versions WHERE id=?", (ident,)).fetchone()
            if existing:
                if existing["org"] != org or not secrets.compare_digest(
                    self._private(existing), raw
                ):
                    raise ConflictError("Conflicting import.")
                return self._metadata(existing)
            db.execute(
                "INSERT INTO versions VALUES (?,?,?,?)",
                (ident, org, "decrypt_only", protect(self.root, raw, key_aad(org, ident))),
            )
            self._audit(db, actor, "import", org, ident)
            self._checkpoint(db)
            return self._metadata(
                db.execute("SELECT * FROM versions WHERE id=?", (ident,)).fetchone()
            )

    def wrap(self, org: str, context: str, dek: bytes, expected: str, actor: str) -> dict:
        with self.transaction() as db:
            self._ready(db)
            if p.organization(context) != org:
                raise ValueError("Wrong context scope.")
            row = db.execute(
                "SELECT * FROM versions WHERE org=? AND state='active'", (org,)
            ).fetchone()
            if row is None or row["id"] != expected:
                raise ConflictError("Active version changed.")
            result = p.wrap(dek, context, row["id"], self._private(row))
            self._audit(db, actor, "wrap", org, row["id"])
            return result

    def _unwrap(self, db, org: str, context: str, wrapper: dict) -> bytes:
        if p.organization(context) != org:
            raise ValueError("Wrong context scope.")
        p.validate(wrapper)
        row = db.execute(
            "SELECT * FROM versions WHERE id=? AND org=?", (wrapper["key_id"], org)
        ).fetchone()
        if row is None:
            raise ValueError("Unknown version.")
        return p.unwrap(wrapper, context, self._private(row))

    def unwrap(self, org: str, context: str, wrapper: dict, actor: str) -> bytes:
        with self.transaction() as db:
            self._ready(db)
            dek = self._unwrap(db, org, context, wrapper)
            self._audit(db, actor, "unwrap", org, wrapper["key_id"])
            return dek

    def rewrap(self, org: str, context: str, wrapper: dict, expected: str, actor: str) -> dict:
        with self.transaction() as db:
            self._ready(db)
            dek = self._unwrap(db, org, context, wrapper)
            row = db.execute(
                "SELECT * FROM versions WHERE org=? AND state='active'", (org,)
            ).fetchone()
            if row is None or row["id"] != expected:
                raise ConflictError("Active version changed.")
            result = p.wrap(dek, context, row["id"], self._private(row))
            self._audit(db, actor, "rewrap", org, row["id"])
            return result

    def rotate_root(self, new_secret: bytes, expected: str, actor: str) -> dict:
        """Atomic root rotation: interruption rolls back all ciphertext and header changes."""
        if len(new_secret) != 32:
            raise ValueError("Invalid unlock secret.")
        with self.lock:
            with self.transaction() as db:
                self._ready(db)
                if self.root_id != expected:
                    raise ConflictError("Root changed; verify status before rotating.")
                root, ident = secrets.token_bytes(32), str(uuid.uuid4())
                rows = db.execute("SELECT * FROM versions").fetchall()
                for row in rows:
                    raw = self._private(row)
                    p.private_keys(raw)
                    encrypted = protect(root, raw, key_aad(row["org"], row["id"]))
                    if recover(root, encrypted, 96, key_aad(row["org"], row["id"])) != raw:
                        raise ValueError("Root migration verification failed.")
                    db.execute("UPDATE versions SET private=? WHERE id=?", (encrypted, row["id"]))
                db.execute("UPDATE meta SET value=? WHERE name='root_id'", (ident,))
                db.execute(
                    "UPDATE meta SET value=? WHERE name='wrapped_root'",
                    (protect(new_secret, root, ident.encode()),),
                )
                self._audit(db, actor, "rotate_root", ident=ident)
                self._checkpoint(db)
            self.root, self.root_id = root, ident
            # Rotation is committed. Report cleanup independently; never imply rollback.
            sanitized = False
            try:
                with closing(sqlite3.connect(self.path, timeout=10, isolation_level=None)) as clean:
                    clean.execute("PRAGMA secure_delete=ON")
                    checkpoint = clean.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
                    if checkpoint[0] == 0:
                        clean.execute("VACUUM")
                        sanitized = (
                            clean.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()[0] == 0
                        )
            except sqlite3.Error:
                pass
            return {"root_id": ident, "storage_cleanup_complete": sanitized}

    def custody_status(self) -> dict:
        with self.transaction() as db:
            self._refresh_seal(db)
            return {
                "root_id": db.execute("SELECT value FROM meta WHERE name='root_id'").fetchone()[0],
                "sealed": self.root is None,
                "suite": p.SUITE,
            }

    def _checkpoint(self, db):
        """Durable snapshot of pending keys BEFORE the live transaction can commit."""
        self.backup_directory.mkdir(parents=True, exist_ok=True)
        destination = self.backup_directory / f"{time.time_ns()}-{uuid.uuid4()}.sqlite3"
        with os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb"):
            pass
        destination.chmod(0o600)
        try:
            with closing(sqlite3.connect(destination)) as target:
                target.execute("PRAGMA synchronous=FULL")
                # Dump from this transaction sees its uncommitted rotation. Opening
                # another source connection would silently omit the pending key.
                target.executescript("\n".join(db.iterdump()))
                if target.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("Backup verification failed")
            with destination.open("r+b") as stream:
                os.fsync(stream.fileno())
            if os.name != "nt":
                fd = os.open(self.backup_directory, os.O_RDONLY)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
        except BaseException:
            destination.unlink(missing_ok=True)
            raise

    @classmethod
    def restore(cls, source: Path, destination: Path, secret: bytes):
        """Restore only to a new path, verifying custody and every private record."""
        if not source.is_file() or destination.exists():
            raise ValueError("Backup must exist and restore destination must be new")
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".restore-{uuid.uuid4()}.sqlite3")
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb"):
            pass
        temporary.chmod(0o600)
        try:
            with (
                closing(sqlite3.connect(source)) as original,
                closing(sqlite3.connect(temporary)) as target,
            ):
                if original.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                    raise ValueError("Backup integrity failed")
                original.backup(target)
            recovered = cls(temporary)
            recovered.unseal(secret, "offline-restore-verification")
            recovered.seal("offline-restore-complete")
            # Atomic non-overwriting publication on the same filesystem.
            if os.name == "nt":
                os.rename(temporary, destination)  # Windows refuses an existing destination.
            else:
                os.link(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
        return cls(destination)

    def backup(self, destination: Path):
        """Offline CLI operation; backup is encrypted and never returned over runtime API."""
        with self.lock:
            with os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb"):
                pass
            destination.chmod(0o600)
            with (
                closing(sqlite3.connect(self.path)) as source,
                closing(sqlite3.connect(destination)) as target,
            ):
                source.backup(target)
