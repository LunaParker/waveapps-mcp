from pathlib import Path

import pytest

from waveapps_gateway.config import GatewayConfig, load


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
def env(tmp_path: Path) -> dict[str, str]:
    """A complete gateway environment whose secrets are files under tmp_path; no state dir, so defaults show."""
    files = {"client-secret": "TEST_client_secret\n", "jwt": "TEST_jwt_signing_key\n", "token": "TEST_upstream_token\n"}
    for name, value in files.items():
        (tmp_path / name).write_text(value, encoding="utf-8")
    return {
        "BASE_URL": "https://gateway.example/",
        "ALLOWED_EMAILS": "Owner@Example.com, second@example.com",
        "GOOGLE_OAUTH_CLIENT_ID": "TEST_client_id",
        "GOOGLE_OAUTH_CLIENT_SECRET_FILE": str(tmp_path / "client-secret"),
        "JWT_SIGNING_KEY_FILE": str(tmp_path / "jwt"),
        "WAVE_MCP_HTTP_TOKEN_FILE": str(tmp_path / "token"),
    }


@pytest.fixture
def config(env: dict[str, str], tmp_path: Path) -> GatewayConfig:
    return load({**env, "WAVE_GATEWAY_STATE_DIR": str(tmp_path / "state")})
