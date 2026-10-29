import pytest
from dotenv import dotenv_values

from backend.config.environment import load_environment
from scripts.init_compose import initialize


def test_env_loading_preserves_override_and_literal_secrets(tmp_path, monkeypatch):
    monkeypatch.delenv("DJANGO_READ_DOT_ENV", raising=False)
    monkeypatch.setenv("EXAMPLE_EXISTING", "process-value")
    monkeypatch.delenv("EXAMPLE_SECRET", raising=False)
    (tmp_path / ".env").write_text(
        'EXAMPLE_EXISTING=file-value\nEXAMPLE_SECRET="literal-${HOME}-#-value"\n'
    )
    load_environment(tmp_path)
    import os

    assert os.environ["EXAMPLE_EXISTING"] == "process-value"
    assert os.environ["EXAMPLE_SECRET"] == "literal-${HOME}-#-value"
    monkeypatch.delenv("EXAMPLE_SECRET")


def test_env_loading_can_be_disabled(tmp_path, monkeypatch):
    monkeypatch.setenv("DJANGO_READ_DOT_ENV", "false")
    monkeypatch.delenv("EXAMPLE_DISABLED", raising=False)
    (tmp_path / ".env").write_text("EXAMPLE_DISABLED=value\n")
    load_environment(tmp_path)
    import os

    assert "EXAMPLE_DISABLED" not in os.environ


@pytest.mark.parametrize("initial", ["", "POSTGRES_PASSWORD=\nOTHER=keep\n"])
def test_compose_init_fills_placeholder_once(tmp_path, initial):
    path = tmp_path / ".env"
    path.write_text(initial)
    assert initialize(path)
    first = path.read_bytes()
    assert len(dotenv_values(path)["POSTGRES_PASSWORD"]) >= 48
    assert not initialize(path)
    assert path.read_bytes() == first
    if initial:
        assert dotenv_values(path)["OTHER"] == "keep"
