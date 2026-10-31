"""Explicit synthetic development configuration; production requires reviewed providers."""

import os
from ipaddress import ip_address
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

from .environment import load_environment

BASE_DIR = Path(__file__).resolve().parents[2]
load_environment(BASE_DIR)
RUNTIME_DIR = Path(os.environ.get("APP_RUNTIME_DIR", str(BASE_DIR / ".runtime")))
ENVIRONMENT = os.environ.get("APP_ENV", "development")
SYNTHETIC_MODE = ENVIRONMENT in {"development", "test"}
PQ_TRANSPORT_REQUIRED = (
    not SYNTHETIC_MODE or os.environ.get("PQ_TRANSPORT_REQUIRED", "false") == "true"
)
DEBUG = False
ALLOWED_HOSTS = os.environ.get(
    "ALLOWED_HOSTS", "localhost,127.0.0.1" + (",testserver" if ENVIRONMENT == "test" else "")
).split(",")
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    secret_path = RUNTIME_DIR / "django.secret"
    if not secret_path.exists():
        raise ImproperlyConfigured(
            "Run python scripts/init_local.py before starting the application."
        )
    SECRET_KEY = secret_path.read_text().strip()
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://localhost:5173").rstrip("/")
RECIPIENT_PUBLIC_URL = os.environ.get("RECIPIENT_PUBLIC_URL", PUBLIC_URL + "/recipient").rstrip("/")
ENABLE_DEV_TOOLS = SYNTHETIC_MODE and os.environ.get("ENABLE_DEV_TOOLS", "false") == "true"
ENABLE_LEGACY_RECIPIENT_API = (
    SYNTHETIC_MODE and os.environ.get("ENABLE_LEGACY_RECIPIENT_API", "false") == "true"
)
# Trust exact immediate proxy peers only; never arbitrary forwarded chains.
TRUSTED_PROXY_IPS = frozenset(
    str(ip_address(value.strip()))
    for value in os.environ.get("TRUSTED_PROXY_IPS", "").split(",")
    if value.strip()
)
# Only for an exclusively Unix-socket-bound backend with restricted socket ownership.
TRUSTED_PROXY_UNIX_SOCKET = os.environ.get("TRUSTED_PROXY_UNIX_SOCKET", "false") == "true"
COMPANY_DOMAIN = "onesmarter.com"
COMPANY_EMAIL_ALLOWLIST = frozenset(
    value.strip().lower()
    for value in os.environ.get("COMPANY_EMAIL_ALLOWLIST", "").split(",")
    if value.strip()
)
INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.staticfiles",
    "rest_framework",
    "backend.apps.core",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "backend.apps.core.middleware.PortalSessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "backend.apps.core.middleware.SecurityContextMiddleware",
]
ROOT_URLCONF = "backend.config.urls"
WSGI_APPLICATION = "backend.config.wsgi.application"
AUTH_USER_MODEL = "core.StaffUser"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = "UTC"
if os.environ.get("POSTGRES_HOST"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "HOST": os.environ["POSTGRES_HOST"],
            "PORT": os.environ.get("POSTGRES_PORT", "5432"),
            "NAME": os.environ.get("POSTGRES_DB", "secure_mail"),
            "USER": os.environ.get("POSTGRES_USER", "secure_mail"),
            "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""),
            "CONN_MAX_AGE": 60,
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": RUNTIME_DIR / "dev.sqlite3",
            "OPTIONS": {"timeout": 30, "transaction_mode": "IMMEDIATE"},
        }
    }
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 12},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not SYNTHETIC_MODE
CSRF_COOKIE_SECURE = not SYNTHETIC_MODE
CSRF_TRUSTED_ORIGINS = os.environ.get(
    "CSRF_TRUSTED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")
SESSION_COOKIE_AGE = 60 * 60 * 8
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "no-referrer"
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": [],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "EXCEPTION_HANDLER": "backend.apps.core.http.exception_handler",
}
DATA_UPLOAD_MAX_MEMORY_SIZE = 27 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = DATA_UPLOAD_MAX_MEMORY_SIZE
FILE_UPLOAD_HANDLERS = ["backend.apps.core.upload_handlers.BoundedMemoryUploadHandler"]
SETUP_TOKEN_SHA256 = os.environ.get("SETUP_TOKEN_SHA256", "")
DEV_INBOX_TOKEN_SHA256 = os.environ.get("DEV_INBOX_TOKEN_SHA256", "")
STAGED_UPLOAD_QUOTA_BYTES = int(os.environ.get("STAGED_UPLOAD_QUOTA_BYTES", str(100 * 1024 * 1024)))

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_FILES = 10
CRYPTO_PROVIDER = "onesmarter-hybrid-v2"
KEY_PROTECTOR = os.environ.get(
    "KEY_PROTECTOR", "local-development" if SYNTHETIC_MODE else "key-service"
)
ALLOW_LEGACY_SYNTHETIC_READS = (
    SYNTHETIC_MODE and os.environ.get("ALLOW_LEGACY_SYNTHETIC_READS", "true") == "true"
)
LOCAL_KEY_FILE = RUNTIME_DIR / "wrapping.key"
STORAGE_PROVIDER = os.environ.get("STORAGE_PROVIDER", "local")
S3_BUCKET = os.environ.get("S3_BUCKET", "")
AWS_REGION = os.environ.get("AWS_REGION", "")
KEY_SERVICE_URL = os.environ.get("KEY_SERVICE_URL", "")
KEY_SERVICE_CA = os.environ.get("KEY_SERVICE_CA", "")
KEY_SERVICE_CERT = os.environ.get("KEY_SERVICE_CERT", "")
KEY_SERVICE_KEY = os.environ.get("KEY_SERVICE_KEY", "")
KEY_SERVICE_REQUIRE_PQ = (
    PQ_TRANSPORT_REQUIRED or os.environ.get("KEY_SERVICE_REQUIRE_PQ", "false") == "true"
)
KEY_STATUS_URL = os.environ.get("KEY_STATUS_URL") or KEY_SERVICE_URL
KEY_STATUS_CA = os.environ.get("KEY_STATUS_CA") or KEY_SERVICE_CA
KEY_STATUS_CERT = os.environ.get("KEY_STATUS_CERT") or KEY_SERVICE_CERT
KEY_STATUS_KEY = os.environ.get("KEY_STATUS_KEY") or KEY_SERVICE_KEY
KEY_STATUS_REQUIRE_PQ = (
    PQ_TRANSPORT_REQUIRED or os.environ.get("KEY_STATUS_REQUIRE_PQ", "false") == "true"
)
if KEY_PROTECTOR not in {"local-development", "key-service"}:
    raise ImproperlyConfigured("Unsupported key protector; managed KMS is not supported.")
AUDIT_BUCKET = os.environ.get("AUDIT_BUCKET", "")
AUDIT_RETENTION_DAYS = int(os.environ.get("AUDIT_RETENTION_DAYS", "0"))
SCAN_PROVIDER = os.environ.get("SCAN_PROVIDER", "clamav")
CLAMAV_HOST = os.environ.get("CLAMAV_HOST", "127.0.0.1")
CLAMAV_PORT = int(os.environ.get("CLAMAV_PORT", "3310"))
CLAMAV_TIMEOUT_SECONDS = float(os.environ.get("CLAMAV_TIMEOUT_SECONDS", "20"))
CLAMAV_MAX_SIGNATURE_AGE_HOURS = int(os.environ.get("CLAMAV_MAX_SIGNATURE_AGE_HOURS", "48"))
if CLAMAV_TIMEOUT_SECONDS <= 0 or CLAMAV_MAX_SIGNATURE_AGE_HOURS <= 0:
    raise ValueError("ClamAV timeout and signature-age limit must be positive")
CLAMAV_TRANSPORT = os.environ.get("CLAMAV_TRANSPORT", "tcp")
CLAMAV_SOCKET = os.environ.get("CLAMAV_SOCKET", "")
CLAMAV_CA = os.environ.get("CLAMAV_CA", "")
CLAMAV_CERT = os.environ.get("CLAMAV_CERT", "")
CLAMAV_KEY = os.environ.get("CLAMAV_KEY", "")
if PQ_TRANSPORT_REQUIRED:
    import ssl

    from backend.transport.tls import configure

    configure(ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT), required=True)
    if KEY_PROTECTOR != "key-service" or SCAN_PROVIDER != "clamav":
        raise ImproperlyConfigured("PQ mode requires the isolated key service and real scanner.")
    if CLAMAV_TRANSPORT not in {"tls", "unix"} or not PUBLIC_URL.startswith("https://"):
        raise ImproperlyConfigured("PQ mode requires HTTPS and TLS/local-socket scanning.")
    SESSION_COOKIE_SECURE = CSRF_COOKIE_SECURE = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
MAIL_PROVIDER = os.environ.get("MAIL_PROVIDER", "development" if SYNTHETIC_MODE else "smtp")
SMTP_SENDER_PROFILES_FILE = os.environ.get("SMTP_SENDER_PROFILES_FILE", "")
EMAIL_HOST = os.environ.get("EMAIL_HOST", "mail.privateemail.com")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")
if os.environ.get("EMAIL_HOST_PASSWORD_FILE"):
    raise ImproperlyConfigured(
        "EMAIL_HOST_PASSWORD_FILE is no longer supported. Configure EMAIL_HOST_PASSWORD "
        "through the process environment or the private root .env file."
    )
EMAIL_USE_TLS = True
EMAIL_USE_SSL = False
EMAIL_TIMEOUT = 20
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", "secure@onesmarter.com")
CELERY_BROKER_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CELERY_TASK_IGNORE_RESULT = True
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_BEAT_SCHEDULE = {
    "transient-cleanup": {"task": "securemail.cleanup_transient", "schedule": 900.0},
    "outbox": {"task": "securemail.process_pending", "schedule": 10.0, "options": {"expires": 10}},
    "audit-archive": {"task": "securemail.archive_audit", "schedule": 10.0},
}
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {"securemail": {"handlers": ["console"], "level": "INFO", "propagate": False}},
}

# Never make a boolean environment flag substitute for a reviewed PQ implementation.
if not SYNTHETIC_MODE:
    raise ImproperlyConfigured(
        "Production is blocked: the OneSmarter cryptographic review, PQ coverage, retention/region and "
        "deployment evidence require security approval. See RELEASE_GATES.md."
    )

# Evidence preservation is explicitly local; deployment never switches it to AWS.
EVIDENCE_DIRECTORY = Path(os.environ.get("EVIDENCE_DIRECTORY", str(RUNTIME_DIR / "evidence")))
EVIDENCE_TSA_URL = os.environ.get("EVIDENCE_TSA_URL", "")
EVIDENCE_TSA_CA_FILE = os.environ.get("EVIDENCE_TSA_CA_FILE", "")
EVIDENCE_OPENSSL = os.environ.get("EVIDENCE_OPENSSL", "openssl")

# Dedicated stable secret in deployment; changing it requires rebuilding the word index.
SEARCH_INDEX_KEY = os.environ.get("SEARCH_INDEX_KEY", SECRET_KEY if SYNTHETIC_MODE else "")

AUDIT_ARCHIVE_BATCH_SIZE = min(
    1000, max(1, int(os.environ.get("AUDIT_ARCHIVE_BATCH_SIZE", "1000")))
)
AUDIT_ARCHIVE_MAX_BATCHES = max(1, int(os.environ.get("AUDIT_ARCHIVE_MAX_BATCHES", "20")))
AUDIT_ARCHIVE_MAX_LAG_SECONDS = int(os.environ.get("AUDIT_ARCHIVE_MAX_LAG_SECONDS", "900"))
STAFF_IDLE_SECONDS = max(60, int(os.environ.get("STAFF_IDLE_SECONDS", "900")))
STAFF_ABSOLUTE_SECONDS = 8 * 60 * 60

# Only needed until legacy recovery codes are replaced. Supply OLD keys before rotation.
RECOVERY_LEGACY_KEYS = [key for key in os.environ.get("RECOVERY_LEGACY_KEYS", "").split(",") if key]
DOCUMENT_INTEGRITY_KEY = os.environ.get(
    "DOCUMENT_INTEGRITY_KEY",
    "synthetic-test-integrity-key-not-for-production" if ENVIRONMENT == "test" else "",
)

SECRET_KEY_FALLBACKS = [
    key for key in os.environ.get("DJANGO_SECRET_KEY_FALLBACKS", "").split(",") if key
]
