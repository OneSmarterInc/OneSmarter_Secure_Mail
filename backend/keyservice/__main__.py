"""Offline initialization/backup and sealed service startup. No secret CLI arguments."""

import argparse
import getpass
import hashlib
import json
import secrets
import time
from pathlib import Path

from argon2 import PasswordHasher
from cryptography import x509
from cryptography.hazmat.primitives.serialization import Encoding

from . import protocol as p
from .server import Server, Service, tls_context
from .store import KeyStore


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init")
    init.add_argument("--store", type=Path, required=True)
    init.add_argument("--recovery-file", type=Path, required=True)
    backup = commands.add_parser("backup")
    backup.add_argument("--store", type=Path, required=True)
    backup.add_argument("--destination", type=Path, required=True)
    identity = commands.add_parser("identity")
    identity.add_argument("--policy", type=Path, required=True)
    identity.add_argument("--cert", type=Path, required=True)
    identity.add_argument("--name", required=True)
    identity.add_argument("--role", choices=["custodian", "workload", "maintenance"], required=True)
    identity.add_argument("--organization", action="append", default=[])
    identity.add_argument("--days", type=int, default=30)
    serve = commands.add_parser("serve")
    serve.add_argument("--store", type=Path, required=True)
    serve.add_argument("--policy", type=Path, required=True)
    serve.add_argument("--cert", required=True)
    serve.add_argument("--key", required=True)
    serve.add_argument("--ca", required=True)
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8443)
    serve.add_argument("--origin", required=True)
    serve.add_argument("--synthetic-only", action="store_true", required=True)
    serve.add_argument("--allow-classical-synthetic", action="store_true")
    serve.add_argument("--allow-http-loopback-origin", action="store_true")
    args = parser.parse_args()
    if args.command == "init":
        store, recovery = args.store.resolve(), args.recovery_file.resolve()
        if recovery.is_relative_to(store.parent):
            parser.error("Keep the recovery file outside the key-store directory.")
        if store.exists() or recovery.exists():
            parser.error("Refusing to overwrite a store or recovery secret.")
        secret = secrets.token_bytes(32)
        recovery.parent.mkdir(parents=True, exist_ok=True)
        with recovery.open("x", encoding="ascii") as stream:
            stream.write(p.encode(secret))
        recovery.chmod(0o600)
        KeyStore.initialize(store, secret)
        print(
            "Initialized sealed store. Secure the separate recovery file; its value was not printed."
        )
    elif args.command == "backup":
        KeyStore(args.store).backup(args.destination)
        print("Created encrypted SQLite backup. Retain its matching recovery secret separately.")
    elif args.command == "identity":
        if not 1 <= args.days <= 90:
            parser.error("Identity validity must be between 1 and 90 days.")
        cert = x509.load_pem_x509_certificate(args.cert.read_bytes())
        fp = hashlib.sha256(cert.public_bytes(Encoding.DER)).hexdigest()
        policy = json.loads(args.policy.read_text()) if args.policy.exists() else {"identities": {}}
        if fp in policy["identities"]:
            parser.error("Identity already exists; review policy changes explicitly.")
        operations = {
            "custodian": ["custody-status", "unseal", "seal", "rotate-root"],
            "workload": ["status", "versions", "wrap", "unwrap", "rewrap"],
            "maintenance": ["status", "versions", "rotate", "import"],
        }[args.role]
        entry = {
            "name": args.name,
            "role": args.role,
            "operations": operations,
            "organizations": args.organization,
            "expires_at": time.time() + args.days * 86400,
        }
        if args.role == "custodian":
            password = getpass.getpass("New custodian password (at least 16 characters): ")
            confirmation = getpass.getpass("Confirm password: ")
            if len(password) < 16 or password != confirmation:
                parser.error("Password length or confirmation failed.")
            entry["password_hash"] = PasswordHasher().hash(password)
        policy["identities"][fp] = entry
        args.policy.parent.mkdir(parents=True, exist_ok=True)
        # Policy changes are offline operations; do not run concurrent policy writers.
        tmp = args.policy.with_suffix(".new")
        with tmp.open("x", encoding="utf-8") as stream:
            json.dump(policy, stream, indent=2)
        tmp.chmod(0o600)
        tmp.replace(args.policy)
        print("Identity registered. Policy is reloaded on every service request.")
    else:
        store = KeyStore(args.store)
        if args.allow_http_loopback_origin and args.host not in {"127.0.0.1", "localhost"}:
            parser.error("HTTP development origins require a loopback-only service bind.")
        service = Service(
            store, args.policy, args.origin, allow_http_loopback=args.allow_http_loopback_origin
        )
        with Server(
            (args.host, args.port),
            service,
            tls_context(args.cert, args.key, args.ca),
            require_pq=not args.allow_classical_synthetic,
        ) as server:
            print(
                "Synthetic key service started SEALED. Independent review/PQ deployment approval pending."
            )
            try:
                server.serve_forever()
            finally:
                store.seal("shutdown")


if __name__ == "__main__":
    main()
