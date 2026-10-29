FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock && useradd --create-home app
COPY --chown=app:app backend ./backend
COPY --chown=app:app secure_mail ./secure_mail
COPY --chown=app:app scripts ./scripts
COPY --chown=app:app manage.py pyproject.toml ./
RUN mkdir /app/.runtime && chown app:app /app/.runtime
USER app
CMD ["gunicorn", "backend.config.wsgi:application", "--bind", "127.0.0.1:8000", "--workers", "2", "--timeout", "90", "--error-logfile", "-"]
