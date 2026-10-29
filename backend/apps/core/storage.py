import hashlib
import os
import socket
import struct
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import boto3
from django.conf import settings

from backend.transport import tls

from .http import Problem


def put(key: str, value: bytes):
    if settings.STORAGE_PROVIDER == "s3":
        boto3.client("s3", region_name=settings.AWS_REGION).put_object(
            Bucket=settings.S3_BUCKET,
            Key=key,
            Body=value,
            ServerSideEncryption="AES256",
            ContentType="application/octet-stream",
        )
    elif settings.STORAGE_PROVIDER == "local":
        path = settings.RUNTIME_DIR / "objects" / hashlib.sha256(key.encode()).hexdigest()
        path.parent.mkdir(parents=True, exist_ok=True)
        # Never expose a partially written ciphertext after a failed write.
        descriptor, temporary = tempfile.mkstemp(prefix=".upload-", dir=path.parent)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(value)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            Path(temporary).unlink(missing_ok=True)
    else:
        raise Problem("Private storage is unavailable.", "storage_unavailable", 503)


def get(key: str) -> bytes:
    # Object keys are generated internally, never accepted from API callers.
    if settings.STORAGE_PROVIDER == "s3":
        return (
            boto3.client("s3", region_name=settings.AWS_REGION)
            .get_object(Bucket=settings.S3_BUCKET, Key=key)["Body"]
            .read()
        )
    if settings.STORAGE_PROVIDER == "local":
        return (
            settings.RUNTIME_DIR / "objects" / hashlib.sha256(key.encode()).hexdigest()
        ).read_bytes()
    raise Problem("Private storage is unavailable.", "storage_unavailable", 503)


def remove(key: str):
    if settings.STORAGE_PROVIDER == "s3":
        boto3.client("s3", region_name=settings.AWS_REGION).delete_object(
            Bucket=settings.S3_BUCKET, Key=key
        )
    elif settings.STORAGE_PROVIDER == "local":
        (settings.RUNTIME_DIR / "objects" / hashlib.sha256(key.encode()).hexdigest()).unlink(
            missing_ok=True
        )


def validate_file(name: str, data: bytes) -> tuple[str, str]:
    clean = Path(name.replace("\\", "/")).name
    if not clean or len(clean) > 180 or any(ord(c) < 32 for c in clean):
        raise Problem("Choose a file with a valid filename.")
    suffix = Path(clean).suffix.lower()
    expected = {
        ".pdf": (b"%PDF-", "application/pdf"),
        ".png": (b"\x89PNG\r\n\x1a\n", "image/png"),
        ".jpg": (b"\xff\xd8\xff", "image/jpeg"),
        ".jpeg": (b"\xff\xd8\xff", "image/jpeg"),
    }
    if suffix == ".txt":
        try:
            data.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise Problem("Text files must use UTF-8.") from exc
        if b"\x00" in data:
            raise Problem("Invalid text file.")
        return clean, "text/plain"
    if suffix not in expected or not data.startswith(expected[suffix][0]):
        raise Problem(
            "Supported files: PDF, PNG, JPEG and UTF-8 text with matching content.",
            "file_type_rejected",
        )
    return clean, expected[suffix][1]


def scan(data: bytes) -> tuple[bool, str]:
    if not data or len(data) > settings.MAX_UPLOAD_BYTES:
        raise Problem("File size limit exceeded.", "file_size_rejected")
    if settings.SCAN_PROVIDER == "synthetic" and settings.SYNTHETIC_MODE:
        return b"EICAR-STANDARD-ANTIVIRUS-TEST-FILE" not in data, "synthetic-validation-only"
    if settings.SCAN_PROVIDER != "clamav":
        raise Problem("The file scanner is unavailable.", "scanner_unavailable", 503)
    try:
        deadline = time.monotonic() + settings.CLAMAV_TIMEOUT_SECONDS
        scanner_health()
        with scanner_connection() as client:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Scanner deadline exceeded")
            client.settimeout(remaining)
            client.sendall(b"zINSTREAM\0")
            for start in range(0, len(data), 65536):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("Scanner deadline exceeded")
                client.settimeout(remaining)
                chunk = data[start : start + 65536]
                client.sendall(struct.pack("!I", len(chunk)) + chunk)
            client.sendall(struct.pack("!I", 0))
            result = b""
            while b"\0" not in result and len(result) < 4096:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("Scanner deadline exceeded")
                client.settimeout(remaining)
                chunk = client.recv(1024)
                if not chunk:
                    break
                result += chunk
            if not result.endswith(b"\0") or result.count(b"\0") != 1:
                raise OSError("Incomplete or ambiguous scanner response")
            if result == b"stream: OK\0":
                return True, "clamav"
            if result.startswith(b"stream: ") and result.endswith(b" FOUND\0"):
                return False, "clamav"
            raise OSError("Unexpected scanner response")
    except (OSError, ValueError) as exc:
        raise Problem(
            "The file scanner is unavailable. Please retry later.", "scanner_unavailable", 503
        ) from exc


def scanner_health() -> dict:
    """Check the daemon's loaded daily database, not merely TCP availability.

    Daemon timezone must be UTC: ClamAV's VERSION timestamp carries no offset.
    A recent database is not a guarantee that every new threat is detectable.
    """
    if settings.SCAN_PROVIDER != "clamav":
        raise ValueError("Real scanner is not configured")
    deadline = time.monotonic() + settings.CLAMAV_TIMEOUT_SECONDS
    with scanner_connection() as client:
        client.sendall(b"zVERSION\0")
        result = b""
        while b"\0" not in result and len(result) < 4096:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("Scanner health deadline exceeded")
            client.settimeout(remaining)
            chunk = client.recv(1024)
            if not chunk:
                break
            result += chunk
    if not result.endswith(b"\0") or result.count(b"\0") != 1:
        raise ValueError("Invalid scanner version response")
    engine, version, timestamp = result[:-1].decode("ascii").split("/", 2)
    if not engine.startswith("ClamAV ") or not version.isdigit():
        raise ValueError("Invalid scanner database version")
    updated = datetime.strptime(timestamp, "%a %b %d %H:%M:%S %Y").replace(tzinfo=timezone.utc)
    age = (datetime.now(timezone.utc) - updated).total_seconds()
    if age < -300 or age > settings.CLAMAV_MAX_SIGNATURE_AGE_HOURS * 3600:
        raise ValueError("Scanner signatures are stale or clock is incorrect")
    return {"engine": engine, "database_version": int(version), "signature_age_seconds": int(age)}


def scanner_connection():
    mode = settings.CLAMAV_TRANSPORT
    if mode == "unix":
        if not settings.CLAMAV_SOCKET or not hasattr(socket, "AF_UNIX"):
            raise ValueError("Scanner socket is required.")
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            client.settimeout(settings.CLAMAV_TIMEOUT_SECONDS)
            client.connect(settings.CLAMAV_SOCKET)
            return client
        except BaseException:
            client.close()
            raise
    if mode not in {"tcp", "tls"} or (settings.PQ_TRANSPORT_REQUIRED and mode != "tls"):
        raise ValueError("Unprotected scanner transport is forbidden.")
    context = None
    if mode == "tls":
        context = tls.client_context(
            settings.CLAMAV_CA,
            settings.CLAMAV_CERT,
            settings.CLAMAV_KEY,
            required=settings.PQ_TRANSPORT_REQUIRED,
        )
    if mode == "tcp" and not settings.SYNTHETIC_MODE:
        raise ValueError("Plain scanner TCP is restricted to synthetic environments")
    client = socket.create_connection(
        (settings.CLAMAV_HOST, settings.CLAMAV_PORT), timeout=settings.CLAMAV_TIMEOUT_SECONDS
    )
    try:
        if context:
            client = context.wrap_socket(client, server_hostname=settings.CLAMAV_HOST)
            tls.verify(client, required=settings.PQ_TRANSPORT_REQUIRED)
        return client
    except BaseException:
        client.close()
        raise
