from pathlib import Path

import pytest

from waveapps_gateway.config import DEFAULT_UPSTREAM, REQUIRED, ConfigError, load


def test_a_complete_environment_loads_with_defaults(env):
    config = load(env)
    assert config.base_url == "https://gateway.example"
    assert config.allowed_emails == frozenset({"owner@example.com", "second@example.com"})
    assert (config.google_client_secret, config.jwt_signing_key, config.upstream_token) == (
        "TEST_client_secret",
        "TEST_jwt_signing_key",
        "TEST_upstream_token",
    )
    assert (config.upstream_url, config.host, config.port) == (DEFAULT_UPSTREAM, "127.0.0.1", 8000)
    assert config.state_dir == Path("~/.local/state/waveapps-mcp-gateway").expanduser()


def test_overrides_apply(env, tmp_path):
    config = load(
        {
            **env,
            "WAVE_GATEWAY_UPSTREAM_URL": "http://127.0.0.1:9999/mcp",
            "WAVE_GATEWAY_HOST": "127.0.0.2",
            "WAVE_GATEWAY_PORT": "8100",
            "WAVE_GATEWAY_STATE_DIR": str(tmp_path / "state"),
        }
    )
    assert (config.upstream_url, config.host, config.port, config.state_dir) == (
        "http://127.0.0.1:9999/mcp",
        "127.0.0.2",
        8100,
        tmp_path / "state",
    )


def test_every_missing_variable_is_reported_at_once():
    with pytest.raises(ConfigError) as err:
        load({})
    for name in REQUIRED:
        assert name in str(err.value)


def test_an_allowlist_naming_nobody_is_refused(env):
    with pytest.raises(ConfigError, match="names nobody"):
        load({**env, "ALLOWED_EMAILS": " , "})


def test_unreadable_and_empty_secret_files_name_the_path(env, tmp_path):
    missing = str(tmp_path / "missing")
    empty = tmp_path / "empty"
    empty.write_text("\n", encoding="utf-8")
    with pytest.raises(ConfigError) as err:
        load({**env, "JWT_SIGNING_KEY_FILE": missing, "WAVE_MCP_HTTP_TOKEN_FILE": str(empty)})
    assert f"JWT_SIGNING_KEY_FILE ({missing}) cannot be read" in str(err.value)
    assert f"WAVE_MCP_HTTP_TOKEN_FILE ({empty}) is empty" in str(err.value)


@pytest.mark.parametrize("port", ["eighty", "0", "70000"])
def test_a_bad_port_is_refused(env, port):
    with pytest.raises(ConfigError, match="WAVE_GATEWAY_PORT"):
        load({**env, "WAVE_GATEWAY_PORT": port})


def test_secrets_stay_out_of_repr(env):
    text = repr(load(env))
    for secret in ("TEST_client_secret", "TEST_jwt_signing_key", "TEST_upstream_token"):
        assert secret not in text
