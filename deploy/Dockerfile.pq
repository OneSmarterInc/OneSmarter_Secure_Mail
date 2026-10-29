# Candidate only: build and attest the resulting image before deployment.
FROM python:3.15-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock && useradd --create-home app
COPY --chown=app:app backend ./backend
COPY --chown=app:app secure_mail ./secure_mail
COPY --chown=app:app scripts ./scripts
COPY --chown=app:app manage.py pyproject.toml ./
RUN python -c "import ssl; from backend.transport.tls import configure; configure(ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT), required=True)"
USER app
# Provision this directory for app+gateway only. Do not publish an HTTP backend port.
CMD ["gunicorn", "backend.config.wsgi:application", "--bind", "unix:/run/onesmarter/app.sock", "--umask", "007", "--workers", "2", "--timeout", "90", "--error-logfile", "-"]
